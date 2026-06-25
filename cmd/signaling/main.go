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
	"frc.engineer/internal/signaling"
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
	var banCache *bandb.Cache
	var banStore bandb.Store
	if dsn := strings.TrimSpace(os.Getenv("DATABASE_URL")); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		db, err := bandb.Open(ctx, dsn)
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

	roomManager := signaling.NewRoomManager(logger, banCache, banStore)
	defer roomManager.Stop()

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
		clientIP := bandb.ClientIP(r)
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

		// 정상 페이로드 최대치(SDP ~8KB)의 8배 마진. 대형 프레임으로 인한 메모리 폭주 차단.
		conn.SetReadLimit(64 * 1024)

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
