package signaling

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

const (
	permissionCodeStoreTable   = "signaling_permission_codes"
	permissionCodeQueryTimeout = 5 * time.Second
)

type PermissionCodeStore struct {
	mu       sync.RWMutex
	path     string
	logger   *slog.Logger
	codes    map[string]PermissionCode
	db       *sql.DB
	location string
}

func OpenPermissionCodeStore(databaseURL, path string, logger *slog.Logger) (*PermissionCodeStore, error) {
	if strings.TrimSpace(databaseURL) != "" {
		return LoadPermissionCodeStoreFromDatabase(databaseURL, logger)
	}
	return LoadPermissionCodeStore(path, logger)
}

func LoadPermissionCodeStore(path string, logger *slog.Logger) (*PermissionCodeStore, error) {
	if logger == nil {
		logger = slog.Default()
	}

	store := &PermissionCodeStore{
		path:     path,
		logger:   logger,
		codes:    make(map[string]PermissionCode),
		location: path,
	}

	if path == "" {
		return store, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, fmt.Errorf("read permission codes: %w", err)
	}
	if len(data) == 0 {
		return store, nil
	}

	var codes []PermissionCode
	if err := json.Unmarshal(data, &codes); err != nil {
		return nil, fmt.Errorf("unmarshal permission codes: %w", err)
	}

	for _, code := range codes {
		normalized, ok := normalizePermissionCode(code.Code)
		if !ok {
			continue
		}
		code.Code = normalized
		store.codes[normalized] = code
	}

	return store, nil
}

func LoadPermissionCodeStoreFromDatabase(databaseURL string, logger *slog.Logger) (*PermissionCodeStore, error) {
	if logger == nil {
		logger = slog.Default()
	}

	db, err := sql.Open("postgres", strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("open permission code database: %w", err)
	}

	store := &PermissionCodeStore{
		logger:   logger,
		db:       db,
		location: permissionCodeStoreTable,
	}

	ctx, cancel := store.operationContext()
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping permission code database: %w", err)
	}
	if err := store.ensureDatabaseSchema(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *PermissionCodeStore) Backend() string {
	if s != nil && s.db != nil {
		return "postgres"
	}
	return "file"
}

func (s *PermissionCodeStore) Location() string {
	if s == nil {
		return ""
	}
	return s.location
}

func (s *PermissionCodeStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *PermissionCodeStore) List() ([]PermissionCode, error) {
	if s == nil {
		return nil, nil
	}
	if s.db != nil {
		return s.listFromDatabase()
	}

	s.mu.RLock()
	codes := make([]PermissionCode, 0, len(s.codes))
	for _, code := range s.codes {
		codes = append(codes, code)
	}
	s.mu.RUnlock()

	sort.Slice(codes, func(i, j int) bool {
		return codes[i].Code < codes[j].Code
	})
	return codes, nil
}

func (s *PermissionCodeStore) Upsert(code, label string, permissions Permissions) (PermissionCode, error) {
	if s == nil {
		return PermissionCode{}, fmt.Errorf("permission code store unavailable")
	}

	normalized, ok := normalizePermissionCode(code)
	if !ok {
		return PermissionCode{}, fmt.Errorf("permission code is required")
	}

	entry := PermissionCode{
		Code:        normalized,
		Label:       strings.TrimSpace(label),
		Permissions: permissions,
	}

	if s.db != nil {
		if err := s.upsertInDatabase(entry); err != nil {
			return PermissionCode{}, err
		}
		s.logger.Info("permission code upserted", "code", normalized, "label", entry.Label)
		return entry, nil
	}

	s.mu.Lock()
	s.codes[normalized] = entry
	err := s.persistLocked()
	s.mu.Unlock()
	if err != nil {
		return PermissionCode{}, err
	}

	s.logger.Info("permission code upserted", "code", normalized, "label", entry.Label)
	return entry, nil
}

func (s *PermissionCodeStore) Delete(code string) (bool, error) {
	if s == nil {
		return false, fmt.Errorf("permission code store unavailable")
	}

	normalized, ok := normalizePermissionCode(code)
	if !ok {
		return false, nil
	}

	if s.db != nil {
		deleted, err := s.deleteFromDatabase(normalized)
		if err != nil {
			return false, err
		}
		if deleted {
			s.logger.Info("permission code deleted", "code", normalized)
		}
		return deleted, nil
	}

	s.mu.Lock()
	if _, exists := s.codes[normalized]; !exists {
		s.mu.Unlock()
		return false, nil
	}
	delete(s.codes, normalized)
	err := s.persistLocked()
	s.mu.Unlock()
	if err != nil {
		return false, err
	}

	s.logger.Info("permission code deleted", "code", normalized)
	return true, nil
}

func (s *PermissionCodeStore) Resolve(code string) (Permissions, bool, error) {
	if s == nil {
		return Permissions{}, false, nil
	}

	normalized, ok := normalizePermissionCode(code)
	if !ok {
		return Permissions{}, false, nil
	}

	if s.db != nil {
		return s.resolveFromDatabase(normalized)
	}

	s.mu.RLock()
	entry, exists := s.codes[normalized]
	s.mu.RUnlock()
	if !exists {
		return Permissions{}, false, nil
	}
	return entry.Permissions, true, nil
}

func (s *PermissionCodeStore) listFromDatabase() ([]PermissionCode, error) {
	ctx, cancel := s.operationContext()
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `
		SELECT code, label, view_ers_actual, view_advanced_strategy, view_pit_status, view_top_speed, view_player_delta
		FROM `+permissionCodeStoreTable+`
		ORDER BY code
	`)
	if err != nil {
		return nil, fmt.Errorf("list permission codes: %w", err)
	}
	defer rows.Close()

	var codes []PermissionCode
	for rows.Next() {
		entry, err := scanPermissionCode(rows)
		if err != nil {
			return nil, err
		}
		codes = append(codes, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate permission codes: %w", err)
	}
	return codes, nil
}

func (s *PermissionCodeStore) upsertInDatabase(entry PermissionCode) error {
	ctx, cancel := s.operationContext()
	defer cancel()

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO `+permissionCodeStoreTable+` (
			code,
			label,
			view_ers_actual,
			view_advanced_strategy,
			view_pit_status,
			view_top_speed,
			view_player_delta
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (code) DO UPDATE SET
			label = EXCLUDED.label,
			view_ers_actual = EXCLUDED.view_ers_actual,
			view_advanced_strategy = EXCLUDED.view_advanced_strategy,
			view_pit_status = EXCLUDED.view_pit_status,
			view_top_speed = EXCLUDED.view_top_speed,
			view_player_delta = EXCLUDED.view_player_delta
	`,
		entry.Code,
		entry.Label,
		entry.Permissions.ViewERSActual,
		entry.Permissions.ViewAdvancedStrategy,
		entry.Permissions.ViewPitStatus,
		entry.Permissions.ViewTopSpeed,
		entry.Permissions.ViewPlayerDelta,
	)
	if err != nil {
		return fmt.Errorf("upsert permission code: %w", err)
	}
	return nil
}

func (s *PermissionCodeStore) deleteFromDatabase(code string) (bool, error) {
	ctx, cancel := s.operationContext()
	defer cancel()

	result, err := s.db.ExecContext(ctx, `DELETE FROM `+permissionCodeStoreTable+` WHERE code = $1`, code)
	if err != nil {
		return false, fmt.Errorf("delete permission code: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("delete permission code rows affected: %w", err)
	}
	return rowsAffected > 0, nil
}

func (s *PermissionCodeStore) resolveFromDatabase(code string) (Permissions, bool, error) {
	ctx, cancel := s.operationContext()
	defer cancel()

	var permissions Permissions
	err := s.db.QueryRowContext(ctx, `
		SELECT view_ers_actual, view_advanced_strategy, view_pit_status, view_top_speed, view_player_delta
		FROM `+permissionCodeStoreTable+`
		WHERE code = $1
	`, code).Scan(
		&permissions.ViewERSActual,
		&permissions.ViewAdvancedStrategy,
		&permissions.ViewPitStatus,
		&permissions.ViewTopSpeed,
		&permissions.ViewPlayerDelta,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return Permissions{}, false, nil
		}
		return Permissions{}, false, fmt.Errorf("resolve permission code: %w", err)
	}
	return permissions, true, nil
}

func (s *PermissionCodeStore) ensureDatabaseSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS `+permissionCodeStoreTable+` (
			code TEXT PRIMARY KEY,
			label TEXT NOT NULL DEFAULT '',
			view_ers_actual BOOLEAN NOT NULL DEFAULT FALSE,
			view_advanced_strategy BOOLEAN NOT NULL DEFAULT FALSE,
			view_pit_status BOOLEAN NOT NULL DEFAULT FALSE,
			view_top_speed BOOLEAN NOT NULL DEFAULT FALSE,
			view_player_delta BOOLEAN NOT NULL DEFAULT FALSE
		)
	`)
	if err != nil {
		return fmt.Errorf("ensure permission code table: %w", err)
	}
	return nil
}

func (s *PermissionCodeStore) operationContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), permissionCodeQueryTimeout)
}

func (s *PermissionCodeStore) persistLocked() error {
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return fmt.Errorf("create permission code dir: %w", err)
	}

	codes := make([]PermissionCode, 0, len(s.codes))
	for _, code := range s.codes {
		codes = append(codes, code)
	}
	sort.Slice(codes, func(i, j int) bool {
		return codes[i].Code < codes[j].Code
	})

	data, err := json.MarshalIndent(codes, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal permission codes: %w", err)
	}
	data = append(data, '\n')

	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("write permission code temp file: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("replace permission code file: %w", err)
	}
	return nil
}

func scanPermissionCode(scanner interface {
	Scan(dest ...any) error
}) (PermissionCode, error) {
	var entry PermissionCode
	if err := scanner.Scan(
		&entry.Code,
		&entry.Label,
		&entry.Permissions.ViewERSActual,
		&entry.Permissions.ViewAdvancedStrategy,
		&entry.Permissions.ViewPitStatus,
		&entry.Permissions.ViewTopSpeed,
		&entry.Permissions.ViewPlayerDelta,
	); err != nil {
		return PermissionCode{}, fmt.Errorf("scan permission code: %w", err)
	}
	return entry, nil
}

func normalizePermissionCode(code string) (string, bool) {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	if normalized == "" {
		return "", false
	}
	return normalized, true
}
