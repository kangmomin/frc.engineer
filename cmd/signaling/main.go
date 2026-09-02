package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"frc.engineer/internal/bandb"
	"frc.engineer/internal/realtimesfu"
	"frc.engineer/internal/signaling"
	"frc.engineer/internal/turncredentials"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10 // 54s
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// App-level context, cancelled on shutdown so background goroutines exit.
	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()

	// Railway/Render/Fly set PORT; allow override via SIGNALING_PORT.
	port := os.Getenv("PORT")
	if port == "" {
		port = os.Getenv("SIGNALING_PORT")
	}
	if port == "" {
		port = "9090"
	}
	// IP/nickname ban store (Postgres). Gracefully disabled if DATABASE_URL unset.
	// BAN_DB_SCHEMA overrides the Postgres schema holding the ban tables
	// (default "pitwall"); point it at an existing schema to skip CREATE.
	var banCache *bandb.Cache
	var banStore bandb.Store
	if dsn := strings.TrimSpace(os.Getenv("DATABASE_URL")); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		db, err := bandb.Open(ctx, dsn, strings.TrimSpace(os.Getenv("BAN_DB_SCHEMA")))
		cancel()
		if err != nil {
			logger.Error("ban DB connect failed; ban features disabled", "error", err)
		} else {
			schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 10*time.Second)
			err = db.EnsureSchema(schemaCtx)
			schemaCancel()
			if err != nil {
				logger.Error("ban DB schema failed; ban features disabled", "error", err)
				db.Close() // close immediately; don't leave a zombie connection
			} else {
				defer db.Close()
				banStore = db
				banCache = bandb.NewCache()
				logger.Info("ban DB connected")
			}
		}
	} else {
		logger.Warn("DATABASE_URL not set; ban features disabled")
	}

	// TRUSTED_PROXY_CIDRS: X-Forwarded-For/X-Real-IP를 신뢰할 프록시 CIDR 집합.
	// 미설정(기본)이면 forwarded 헤더를 신뢰하지 않고 RemoteAddr만 사용한다(H8).
	// 이때 clientIP는 실제 클라가 아니라 공유 엣지 프록시 IP이므로 IP 자동 밴도
	// 비활성화한다(len==0). 그렇지 않으면 밴된 닉 접속 시 공유 프록시 IP가 밴 목록에
	// 올라가 /ws 게이트에서 전원이 차단된다. 신뢰 프록시가 설정된 경우에만 활성화.
	trustedProxies := bandb.ParseTrustedProxies(os.Getenv("TRUSTED_PROXY_CIDRS"))

	roomManager := signaling.NewRoomManager(logger, banCache, banStore, len(trustedProxies) > 0)
	defer roomManager.Stop()
	turnConfig, turnConfigErr := turncredentials.LoadConfigFromEnv()
	switch {
	case turnConfigErr != nil:
		// Fail open. Do not include configuration errors in logs: this process
		// owns the long-lived token and logs must never become a secret channel.
		logger.Warn("TURN credential provider disabled; using static/default ICE fallback")
	case !turnConfig.Enabled:
		logger.Info("TURN credential provider not configured; using static/default ICE fallback")
	default:
		provider, err := turncredentials.NewCloudflareProvider(turnConfig)
		if err != nil {
			logger.Warn("TURN credential provider disabled; using static/default ICE fallback")
		} else {
			roomManager.SetTurnCredentialsProvider(provider)
			logger.Info("TURN credential provider enabled")
		}
	}
	sfuConfig, sfuConfigErr := realtimesfu.LoadConfigFromEnv()
	switch {
	case sfuConfigErr != nil:
		// Never log configuration values or detailed errors: this process owns
		// the long-lived Realtime App Secret.
		logger.Warn("Realtime SFU provider disabled; intercom presence remains available")
	case !sfuConfig.Enabled:
		logger.Info("Realtime SFU provider not configured; intercom media disabled")
	default:
		provider, err := realtimesfu.NewCloudflareProvider(sfuConfig)
		if err != nil {
			logger.Warn("Realtime SFU provider disabled; intercom presence remains available")
		} else {
			roomManager.SetRealtimeSFUProvider(provider)
			logger.Info("Realtime SFU provider enabled")
		}
	}

	// Periodically refresh the ban cache from the DB (also reflects manual edits
	// such as DELETE). Hot paths read only the cache, never the DB.
	if banCache != nil && banStore != nil {
		go func() {
			refresh := func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				if ips, err := banStore.ListIPs(ctx); err != nil {
					logger.Warn("ban refresh: list ips failed", "error", err)
				} else {
					banCache.ReplaceIPs(ips)
				}
				if nicks, err := banStore.ListNicknames(ctx); err != nil {
					logger.Warn("ban refresh: list nicknames failed", "error", err)
				} else {
					banCache.ReplaceNicks(nicks)
				}
			}
			refresh()
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-appCtx.Done():
					return
				case <-ticker.C:
					refresh()
				}
			}
		}()
	}

	// ALLOWED_ORIGINS (콤마 구분) 설정 시에만 Origin 검사.
	// Go sender는 Origin 헤더를 보내지 않으므로 "헤더 없음 = 허용"이 필수.
	allowedOrigins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))

	upgrader := websocket.Upgrader{
		// SDP offer/answer는 2~4KB라 1KB 버퍼는 매 메시지 다중 read를 유발한다.
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			if len(allowedOrigins) == 0 {
				return true
			}
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			_, ok := allowedOrigins[strings.ToLower(origin)]
			return ok
		},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(roomManager.ListRooms())
	})

	mux.HandleFunc("/api/banned-nicknames", handleBannedNicknames(banCache))

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// IP ban gate: reject banned IPs before the WebSocket handshake (applies
		// to both drivers and engineers — /ws is the shared entry point).
		clientIP := bandb.ClientIP(r, trustedProxies)
		if banCache != nil && banCache.HasIP(clientIP) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Error("websocket upgrade failed", "error", err)
			return
		}
		defer conn.Close()

		// Intercom SDP 포함 frozen signaling envelope 상한. Telemetry payload는
		// 별도 DataChannel을 사용하며 이 WebSocket 상한과 섞이지 않는다.
		conn.SetReadLimit(96 * 1024)

		// Set up read deadline and pong handler for keepalive.
		conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(pongWait))
			return nil
		})

		// Shared write mutex for this connection — serializes ping writes
		// with application-level writes (sendJSON, sendErrorRaw).
		writeMu := &sync.Mutex{}

		// Start ping goroutine.
		pingDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingPeriod)
			defer ticker.Stop()
			for {
				select {
				case <-pingDone:
					return
				case <-ticker.C:
					writeMu.Lock()
					conn.SetWriteDeadline(time.Now().Add(writeWait))
					err := conn.WriteMessage(websocket.PingMessage, nil)
					writeMu.Unlock()
					if err != nil {
						return
					}
				}
			}
		}()

		var currentPeer *signaling.ExportedPeer

		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				close(pingDone)
				if currentPeer != nil {
					roomManager.RemoveExportedPeer(currentPeer)
				}
				return
			}
			currentPeer = roomManager.HandleMessageExported(conn, raw, currentPeer, writeMu, clientIP)
		}
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok"}`)
	})

	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		logger.Info("signaling server started", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	logger.Info("shutting down signaling server")
}

func parseAllowedOrigins(raw string) map[string]struct{} {
	origins := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.ToLower(strings.TrimSpace(part))
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return origins
}

// handleBannedNicknames serves the banned-nickname list (from the DB-backed
// cache) for senders to poll. Mirrors the /api/rooms CORS shape. A nil cache
// (ban features disabled) returns an empty list.
func handleBannedNicknames(cache *bandb.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		list := []string{}
		if cache != nil {
			list = append(list, cache.Nicknames()...)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Nicknames []string `json:"nicknames"`
		}{Nicknames: list})
	}
}
