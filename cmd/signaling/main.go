package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

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

	// Railway/Render/Fly set PORT; allow override via SIGNALING_PORT.
	port := os.Getenv("PORT")
	if port == "" {
		port = os.Getenv("SIGNALING_PORT")
	}
	if port == "" {
		port = "9090"
	}
	settingsPassword := strings.TrimSpace(os.Getenv("SIGNALING_SETTINGS_PASSWORD"))
	permissionCodesDatabaseURL := strings.TrimSpace(os.Getenv("SIGNALING_PERMISSION_CODES_DATABASE_URL"))
	if permissionCodesDatabaseURL == "" {
		permissionCodesDatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}

	permissionCodesPath := os.Getenv("SIGNALING_PERMISSION_CODES_FILE")
	if permissionCodesPath == "" {
		permissionCodesPath = filepath.Join("data", "signaling", "permission-codes.json")
	}
	permissionStore, err := signaling.OpenPermissionCodeStore(permissionCodesDatabaseURL, permissionCodesPath, logger)
	if err != nil {
		logger.Error("failed to load permission codes", "error", err, "backend", permissionStoreBackend(permissionCodesDatabaseURL), "location", permissionStoreLocation(permissionCodesDatabaseURL, permissionCodesPath))
		os.Exit(1)
	}
	defer func() {
		if err := permissionStore.Close(); err != nil {
			logger.Warn("failed to close permission code store", "error", err)
		}
	}()
	permissionCodes, err := permissionStore.List()
	if err != nil {
		logger.Error("failed to list permission codes", "error", err, "backend", permissionStore.Backend(), "location", permissionStore.Location())
		os.Exit(1)
	}
	logger.Info("permission codes loaded", "backend", permissionStore.Backend(), "location", permissionStore.Location(), "count", len(permissionCodes))
	if settingsPassword == "" {
		logger.Warn("SIGNALING_SETTINGS_PASSWORD not set; permission code admin endpoints accept any provided password")
	}

	roomManager := signaling.NewRoomManager(logger, permissionStore)
	defer roomManager.Stop()

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}

	mux := http.NewServeMux()

	writeCORS := func(w http.ResponseWriter, methods string) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", methods)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Settings-Password")
	}

	authorizePermissionAdmin := func(w http.ResponseWriter, r *http.Request) bool {
		provided := strings.TrimSpace(r.Header.Get("X-Settings-Password"))
		if provided == "" {
			http.Error(w, "settings password required", http.StatusUnauthorized)
			return false
		}
		if settingsPassword != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(settingsPassword)) != 1 {
			http.Error(w, "invalid settings password", http.StatusUnauthorized)
			return false
		}
		return true
	}

	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		writeCORS(w, "GET, OPTIONS")
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

	mux.HandleFunc("/api/permission-codes", func(w http.ResponseWriter, r *http.Request) {
		writeCORS(w, "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !authorizePermissionAdmin(w, r) {
			return
		}
		codes, err := permissionStore.List()
		if err != nil {
			http.Error(w, "failed to load permission codes", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(codes)
	})

	mux.HandleFunc("/api/permission-codes/", func(w http.ResponseWriter, r *http.Request) {
		writeCORS(w, "PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		code := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/permission-codes/"))
		if code == "" || strings.Contains(code, "/") {
			http.Error(w, "permission code is required", http.StatusBadRequest)
			return
		}
		if !authorizePermissionAdmin(w, r) {
			return
		}

		switch r.Method {
		case http.MethodPut:
			var body struct {
				Label       string                `json:"label"`
				Permissions signaling.Permissions `json:"permissions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			entry, err := permissionStore.Upsert(code, body.Label, body.Permissions)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(entry)

		case http.MethodDelete:
			deleted, err := permissionStore.Delete(code)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if !deleted {
				http.Error(w, "permission code not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Error("websocket upgrade failed", "error", err)
			return
		}
		defer conn.Close()

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
			currentPeer = roomManager.HandleMessageExported(conn, raw, currentPeer, writeMu)
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

func permissionStoreBackend(databaseURL string) string {
	if strings.TrimSpace(databaseURL) != "" {
		return "postgres"
	}
	return "file"
}

func permissionStoreLocation(databaseURL, path string) string {
	if strings.TrimSpace(databaseURL) != "" {
		return "signaling_permission_codes"
	}
	return path
}
