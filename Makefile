.PHONY: build run clean build-sender build-signaling build-remote

# === Local mode (existing) ===
build:
	cd web && npm ci && npm run build
	go build -o frc-engineer ./cmd/server

run: build
	./frc-engineer

# === Remote mode binaries ===
build-sender:
	go build -o frc-sender ./cmd/sender

build-signaling:
	go build -o frc-signaling ./cmd/signaling

# === Remote mode frontend (standalone static site) ===
# Usage: make build-remote SIGNALING_URL=wss://my-signal.fly.dev/ws
build-remote:
	cd web && npm ci && VITE_SIGNALING_URL=$(SIGNALING_URL) npm run build:remote

clean:
	rm -f frc-engineer frc-sender frc-signaling
	rm -rf web/dist
