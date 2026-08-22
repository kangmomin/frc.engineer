package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/races"
)

// Sealed-ID upload lifecycle. The platform ingests each (account, sourceRaceId)
// exactly once (insert-once), so an uploaded ID's content must be immutable:
// BEFORE any upload attempt the ID is durably "sealed" via a sidecar file, and
// every later save of the same session mints a fresh ID instead of overwriting.
// A retry of a sealed ID therefore always sends byte-identical content, making
// the server's Duplicate response equivalent to "this exact content is stored".
//
// Sidecar: data/races/<id>.uploaded — ignored by races.FileStorage.List (it only
// reads *.json). Machine-global semantics: it does not distinguish the paired
// account, so re-pairing to another account will not re-upload old races.

// uploadSidecar is the durable per-race upload state.
type uploadSidecar struct {
	SealedAt       string `json:"sealedAt"`
	Trigger        string `json:"trigger,omitempty"`
	UploadedAt     string `json:"uploadedAt,omitempty"`
	PlatformRaceID string `json:"platformRaceId,omitempty"`
}

// isFinalClassTrigger reports whether a summary's finalize trigger means the
// session was definitively over at save time. Empty = legacy summary (pre-
// feature saves only happened on race-end events). Checkpoint-class triggers
// (CHQF/RCWN under checkpoint mode, idle-timeout, shutdown) are NOT final: the
// session may have continued, so those summaries are only uploaded by the boot
// sweep once the session is provably gone.
func isFinalClassTrigger(trigger string) bool {
	switch trigger {
	case "", packets.EventSessionEnded, "session-switch":
		return true
	default:
		return false
	}
}

const (
	sweepMaxPerRun      = 20
	sweepLegacyMaxAge   = 7 * 24 * time.Hour
	sweepCheckpointHold = 2 * time.Hour
	sweepGap            = 500 * time.Millisecond
)

var raceIDSessionSuffix = regexp.MustCompile(`_([0-9]{1,20})$`)

// uploadState coordinates the sealed-ID lifecycle between the save callback
// (processor goroutine), the boot/pairing sweep, and the manual upload API.
// mu guards ONLY local map/file operations — never network I/O, so a stalled
// upload can never block the processor's save path (session switch, shutdown
// flush stay bounded by local disk I/O).
type uploadState struct {
	mu     sync.Mutex
	dir    string
	logger *slog.Logger
	// bootIDs: sessionUID → newest pre-existing summary ID (from the boot scan);
	// adopting one triggers a merge with its persisted data (sender restart
	// mid-session). thisRun: sessionUID → ID saved during this process lifetime.
	bootIDs  map[uint64]string
	thisRun  map[uint64]string
	sweeping atomic.Bool
}

// newUploadState scans the races directory once (filenames only — no JSON
// loads, safe at boot) and indexes existing summary IDs by session UID.
func newUploadState(dir string, logger *slog.Logger) *uploadState {
	u := &uploadState{
		dir:     dir,
		logger:  logger,
		bootIDs: make(map[uint64]string),
		thisRun: make(map[uint64]string),
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return u // directory may not exist yet (saving disabled) — fine
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || filepath.Ext(name) != ".json" || strings.HasSuffix(name, ".meta.json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		m := raceIDSessionSuffix.FindStringSubmatch(id)
		if m == nil {
			continue
		}
		uid, err := strconv.ParseUint(m[1], 10, 64)
		if err != nil || uid == 0 {
			continue
		}
		if id > u.bootIDs[uid] { // lexicographic max = newest (timestamp prefix)
			u.bootIDs[uid] = id
		}
	}
	return u
}

func (u *uploadState) sidecarPath(id string) string {
	return filepath.Join(u.dir, id+".uploaded")
}

// readSidecar returns nil, nil when no sidecar exists.
func (u *uploadState) readSidecar(id string) (*uploadSidecar, error) {
	data, err := os.ReadFile(u.sidecarPath(id))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var sc uploadSidecar
	if err := json.Unmarshal(data, &sc); err != nil {
		return nil, err
	}
	return &sc, nil
}

// writeSidecarDurable persists the sidecar with write+fsync+rename so a seal
// survives a process crash before the upload result lands.
func (u *uploadState) writeSidecarDurable(id string, sc *uploadSidecar) error {
	data, err := json.Marshal(sc)
	if err != nil {
		return err
	}
	path := u.sidecarPath(id)
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// saveWithStableID persists the summary under this session's stable local ID:
// repeat saves of one session overwrite one file, EXCEPT when that ID is sealed
// (uploaded content is immutable) — then a fresh ID is minted. Every reuse
// merges the on-disk file first so pre-restart dynamics/events/capture data
// survive later overwrites. Returns the saved ID ("" on failure).
func (u *uploadState) saveWithStableID(rs *races.FileStorage, sessionUID uint64, summary *races.RaceSummary) (string, error) {
	u.mu.Lock()
	defer u.mu.Unlock()

	if sessionUID != 0 {
		id := u.thisRun[sessionUID]
		if id == "" {
			id = u.bootIDs[sessionUID]
		}
		if id != "" {
			sc, err := u.readSidecar(id)
			if err != nil {
				u.logger.Warn("upload sidecar unreadable — minting fresh race id", "id", id, "error", err)
			}
			if err == nil && sc == nil {
				summary.ID = id
				// ID를 재사용하는 모든 저장에서 기존 파일과 병합한다 — 채택 첫 저장만
				// 병합하면 이후 재저장이 병합분(재시작 이전 dynamics)을 덮어 유실한다.
				// 같은 실행 내 재저장에는 멱등(파일 ⊆ 메모리 → union 무변화).
				if prev, err := rs.Load(id); err == nil {
					races.MergeAdoptedSummary(prev, summary)
				} else {
					u.logger.Warn("failed to load race summary for merge", "id", id, "error", err)
				}
			} else {
				// sealed (or unreadable sidecar) — mint a fresh ID. The default
				// (second-resolution) stamp could regenerate the sealed ID within the
				// same second and overwrite frozen content, so probe until unsealed
				// (bounded; on a broken FS fall back to Save's own minting).
				t := time.Now()
				for i := 0; i < 60; i++ {
					cand := races.DefaultSummaryID(summary, t)
					if candSC, candErr := u.readSidecar(cand); candErr == nil && candSC == nil {
						summary.ID = cand
						break
					}
					t = t.Add(time.Second)
				}
			}
		}
	}

	savedID, err := rs.Save(summary)
	if err != nil {
		return "", err
	}
	if sessionUID != 0 {
		u.thisRun[sessionUID] = savedID
	}
	return savedID, nil
}

// uploadSealed runs the seal → upload → record protocol for one race ID.
// Lock is held only around the local sidecar transitions; the network call runs
// unlocked (safe: the seal freezes the content, concurrent uploaders of the
// same ID send identical bytes and converge via the server's Duplicate).
func (u *uploadState) uploadSealed(ctx context.Context, baseURL, token, id, trigger string, req *uploadRequest) (*uploadResult, int, error) {
	u.mu.Lock()
	sc, err := u.readSidecar(id)
	if err != nil {
		u.mu.Unlock()
		return nil, 0, fmt.Errorf("upload sidecar unreadable: %w", err)
	}
	if sc != nil && sc.UploadedAt != "" {
		u.mu.Unlock()
		return &uploadResult{RaceID: sc.PlatformRaceID, Duplicate: true}, 0, nil
	}
	if sc == nil {
		sc = &uploadSidecar{SealedAt: time.Now().Format(time.RFC3339), Trigger: trigger}
		if err := u.writeSidecarDurable(id, sc); err != nil {
			u.mu.Unlock()
			return nil, 0, fmt.Errorf("seal write failed: %w", err)
		}
	}
	u.mu.Unlock()

	result, status, err := uploadRace(ctx, baseURL, token, req)
	if err != nil {
		return nil, status, err
	}

	u.mu.Lock()
	sc.UploadedAt = time.Now().Format(time.RFC3339)
	sc.PlatformRaceID = result.RaceID
	if err := u.writeSidecarDurable(id, sc); err != nil {
		// 다음 sweep이 동일 바이트를 재전송하고 Duplicate로 수렴하므로 로그만.
		u.logger.Warn("failed to record uploadedAt", "id", id, "error", err)
	}
	u.mu.Unlock()
	return result, status, nil
}

// sweep uploads pending (un-uploaded) summaries: newest first, capped per run,
// with per-request deadlines. Legacy files (no finalizeTrigger) older than 7
// days are skipped (pre-feature history); fresh checkpoint-class files get a 2h
// hold (the session might still be alive right after a sender restart — the
// sealed-ID rule keeps even that safe, this only avoids duplicate-row noise).
// Aborts on network errors, 5xx and auth/rate statuses; other 4xx skip the file.
func (u *uploadState) sweep(ctx context.Context, baseURL, token string, load func(id string) (*races.RaceSummary, error)) {
	if !u.sweeping.CompareAndSwap(false, true) {
		return
	}
	defer u.sweeping.Store(false)

	entries, err := os.ReadDir(u.dir)
	if err != nil {
		return
	}
	type candidate struct {
		id  string
		age time.Duration
	}
	var candidates []candidate
	now := time.Now()
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || filepath.Ext(name) != ".json" || strings.HasSuffix(name, ".meta.json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		u.mu.Lock()
		sc, scErr := u.readSidecar(id)
		u.mu.Unlock()
		if scErr != nil || (sc != nil && sc.UploadedAt != "") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		candidates = append(candidates, candidate{id: id, age: now.Sub(info.ModTime())})
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].id > candidates[j].id })

	attempted, uploaded := 0, 0
	for _, c := range candidates {
		if attempted >= sweepMaxPerRun {
			u.logger.Info("upload sweep cap reached — remainder next run", "pending", len(candidates)-attempted)
			break
		}
		if ctx.Err() != nil {
			return
		}
		summary, err := load(c.id)
		if err != nil {
			u.logger.Warn("upload sweep: summary unreadable", "id", c.id, "error", err)
			continue
		}
		trigger := ""
		if summary.Detail != nil {
			trigger = summary.Detail.FinalizeTrigger
		}
		if trigger == "" && c.age > sweepLegacyMaxAge {
			continue // legacy pre-feature history — never mass-upload
		}
		if !isFinalClassTrigger(trigger) && c.age < sweepCheckpointHold {
			continue // young checkpoint: its session may still be alive
		}
		req, ok := buildUploadRequest(summary, u.logger)
		if !ok {
			continue // no uploadable laps
		}
		attempted++
		reqCtx, cancel := context.WithTimeout(ctx, uploadHTTPTimeout)
		result, status, err := u.uploadSealed(reqCtx, baseURL, token, c.id, trigger, req)
		cancel()
		if err != nil {
			retryable := status == 0 || status >= 500 || status == 401 || status == 403 || status == 409 || status == 429
			if retryable {
				u.logger.Warn("upload sweep aborted", "id", c.id, "status", status, "error", err)
				return
			}
			u.logger.Warn("upload sweep: race rejected — skipping", "id", c.id, "status", status, "error", err)
			continue
		}
		uploaded++
		u.logger.Info("upload sweep: race uploaded", "id", c.id, "duplicate", result.Duplicate)
		select {
		case <-ctx.Done():
			return
		case <-time.After(sweepGap):
		}
	}
	if uploaded > 0 {
		u.logger.Info("upload sweep finished", "uploaded", uploaded, "attempted", attempted)
	}
}
