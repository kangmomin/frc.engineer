package udp

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"frc.engineer/internal/packets"
)

// packetIDName maps PacketID to a human-readable file name stem.
var packetIDName = map[packets.PacketID]string{
	packets.PacketIDMotion:         "motion",
	packets.PacketIDSession:        "session",
	packets.PacketIDLapData:        "lap_data",
	packets.PacketIDEvent:          "event",
	packets.PacketIDParticipants:   "participants",
	packets.PacketIDCarSetups:      "car_setups",
	packets.PacketIDCarTelemetry:   "telemetry",
	packets.PacketIDCarStatus:      "car_status",
	packets.PacketIDFinalClass:     "final_class",
	packets.PacketIDLobbyInfo:      "lobby_info",
	packets.PacketIDCarDamage:      "car_damage",
	packets.PacketIDSessionHistory: "session_history",
	packets.PacketIDTyreSets:       "tyre_sets",
	packets.PacketIDMotionEx:       "motion_ex",
	packets.PacketIDTimeTrial:      "time_trial",
}

// PacketLogEntry is a single JSONL record written to disk.
type PacketLogEntry struct {
	Timestamp   string      `json:"ts"`
	Frame       uint32      `json:"frame"`
	SessionTime float32     `json:"sessionTime"`
	PacketID    uint8       `json:"packetID"`
	Size        int         `json:"size"`
	Data        interface{} `json:"data"`
}

// PacketLogger writes parsed packets to per-type JSONL files.
type PacketLogger struct {
	baseDir      string
	logger       *slog.Logger
	mu           sync.Mutex
	sessionUID   uint64
	sessionDir   string
	files      map[string]*os.File
}

// NewPacketLogger creates a new PacketLogger that writes under baseDir.
func NewPacketLogger(baseDir string, logger *slog.Logger) *PacketLogger {
	return &PacketLogger{
		baseDir: baseDir,
		logger:  logger,
		files:   make(map[string]*os.File),
	}
}

// ensureSessionDir creates the session directory on the first packet of a session.
func (pl *PacketLogger) ensureSessionDir(sessionUID uint64) error {
	dirName := fmt.Sprintf("%d_%s", sessionUID, time.Now().Format("20060102_150405"))
	pl.sessionDir = filepath.Join(pl.baseDir, dirName)
	if err := os.MkdirAll(pl.sessionDir, 0o755); err != nil {
		return fmt.Errorf("create session dir: %w", err)
	}
	pl.logger.Info("packet logging session started", "dir", pl.sessionDir)
	return nil
}

// getFile returns (or opens) the JSONL file for the given stem.
func (pl *PacketLogger) getFile(stem string) (*os.File, error) {
	if f, ok := pl.files[stem]; ok {
		return f, nil
	}
	path := filepath.Join(pl.sessionDir, stem+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	pl.files[stem] = f
	return f, nil
}

// Log records a parsed packet. For unknown/unhandled packet types the raw bytes
// are stored as a hex string.
func (pl *PacketLogger) Log(header *packets.PacketHeader, parsed *ParsedData, raw []byte) {
	pl.mu.Lock()
	defer pl.mu.Unlock()

	// Create or rotate session directory when session UID changes.
	if pl.sessionDir == "" || pl.sessionUID != header.SessionUID {
		pl.closeFilesLocked()
		if err := pl.ensureSessionDir(header.SessionUID); err != nil {
			pl.logger.Error("packet logger: failed to create session dir", "error", err)
			return
		}
		pl.sessionUID = header.SessionUID
	}

	stem := packetIDName[header.PacketID]
	if stem == "" {
		stem = "unknown"
	}

	var data interface{}
	if parsed != nil {
		data = parsedPayload(parsed)
	}
	// For packets without a parsed payload, store raw hex.
	if data == nil {
		data = map[string]string{"rawHex": hex.EncodeToString(raw)}
	}

	entry := PacketLogEntry{
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		Frame:       header.FrameIdentifier,
		SessionTime: header.SessionTime,
		PacketID:    uint8(header.PacketID),
		Size:        len(raw),
		Data:        data,
	}

	f, err := pl.getFile(stem)
	if err != nil {
		pl.logger.Error("packet logger: open file", "stem", stem, "error", err)
		return
	}

	line, err := json.Marshal(entry)
	if err != nil {
		// NaN/Inf floats cause marshal failure; fall back to raw hex.
		entry.Data = map[string]string{"rawHex": hex.EncodeToString(raw)}
		line, err = json.Marshal(entry)
		if err != nil {
			pl.logger.Error("packet logger: marshal", "error", err)
			return
		}
	}
	line = append(line, '\n')
	if _, err := f.Write(line); err != nil {
		pl.logger.Error("packet logger: write", "error", err)
	}
}

// Close flushes and closes all open files.
func (pl *PacketLogger) Close() {
	pl.mu.Lock()
	defer pl.mu.Unlock()
	pl.closeFilesLocked()
}

// closeFilesLocked closes all open files. Caller must hold pl.mu.
func (pl *PacketLogger) closeFilesLocked() {
	for _, f := range pl.files {
		f.Close()
	}
	pl.files = make(map[string]*os.File)
	pl.sessionDir = ""
}

// parsedPayload extracts the non-nil payload from ParsedData.
func parsedPayload(p *ParsedData) interface{} {
	switch {
	case p.Telemetry != nil:
		return p.Telemetry
	case p.LapData != nil:
		return p.LapData
	case p.Motion != nil:
		return p.Motion
	case p.Session != nil:
		return p.Session
	case p.Participants != nil:
		return p.Participants
	case p.CarStatus != nil:
		return p.CarStatus
	case p.CarDamage != nil:
		return p.CarDamage
	case p.Event != nil:
		return p.Event
	default:
		return nil
	}
}
