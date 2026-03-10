package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	"github.com/gorilla/websocket"
)

// Dashboard matches the DTO from the server
type Dashboard struct {
	Speed             uint16  `json:"speed"`
	Gear              int8    `json:"gear"`
	RPM               uint16  `json:"rpm"`
	Throttle          float32 `json:"throttle"`
	Brake             float32 `json:"brake"`
	DeltaPersonalBest int32   `json:"deltaPersonalBest"`
	DeltaCarInFront   int32   `json:"deltaCarInFront"`
	DeltaRaceLeader   int32   `json:"deltaRaceLeader"`
	CurrentLap        uint8   `json:"currentLap"`
	CurrentLapTime    uint32  `json:"currentLapTime"`
	LastLapTime       uint32  `json:"lastLapTime"`
	BestLapTime       uint32  `json:"bestLapTime"`
	Position          uint8   `json:"position"`
	DRS               bool    `json:"drs"`
	RevLights         uint8   `json:"revLights"`
	Sector            uint8   `json:"sector"`
	LapInvalid        bool    `json:"lapInvalid"`
	Timestamp         int64   `json:"timestamp"`
}

func main() {
	addr := flag.String("addr", "ws://localhost:8080/ws", "WebSocket server address")
	count := flag.Int("count", 10, "Number of messages to receive (0 = unlimited)")
	flag.Parse()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)

	fmt.Printf("Connecting to %s...\n", *addr)

	c, _, err := websocket.DefaultDialer.Dial(*addr, nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer c.Close()

	fmt.Println("Connected! Receiving telemetry data...")

	received := 0
	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				log.Println("read:", err)
				return
			}

			var dash Dashboard
			if err := json.Unmarshal(message, &dash); err != nil {
				log.Printf("Failed to parse: %v", err)
				continue
			}

			// Format output
			deltaStr := formatDelta(dash.DeltaPersonalBest)
			lapTimeStr := formatLapTime(dash.CurrentLapTime)
			drsStr := " "
			if dash.DRS {
				drsStr = "DRS"
			}

			fmt.Printf("\r[Lap %d] %s | Spd: %3d | Gear: %d | RPM: %5d | Thr: %.0f%% | Brk: %.0f%% | Delta: %s | %s   ",
				dash.CurrentLap,
				lapTimeStr,
				dash.Speed,
				dash.Gear,
				dash.RPM,
				dash.Throttle*100,
				dash.Brake*100,
				deltaStr,
				drsStr,
			)

			received++
			if *count > 0 && received >= *count {
				return
			}
		}
	}()

	select {
	case <-done:
	case <-interrupt:
		fmt.Println("\nInterrupted")
	case <-time.After(30 * time.Second):
		fmt.Println("\nTimeout")
	}

	fmt.Printf("\n\nReceived %d messages\n", received)
}

func formatDelta(ms int32) string {
	if ms == 0 {
		return "  -.---"
	}
	sign := "+"
	if ms < 0 {
		sign = "-"
		ms = -ms
	}
	seconds := ms / 1000
	millis := ms % 1000
	return fmt.Sprintf("%s%d.%03d", sign, seconds, millis)
}

func formatLapTime(ms uint32) string {
	minutes := ms / 60000
	seconds := (ms % 60000) / 1000
	millis := ms % 1000
	return fmt.Sprintf("%d:%02d.%03d", minutes, seconds, millis)
}
