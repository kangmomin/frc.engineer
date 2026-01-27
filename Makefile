.PHONY: build run clean

build:
	cd web && npm ci && npm run build
	go build -o frc-engineer ./cmd/server

run: build
	./frc-engineer

clean:
	rm -f frc-engineer
	rm -rf web/dist
