package signaling

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type PermissionCodeStore struct {
	mu     sync.RWMutex
	path   string
	logger *slog.Logger
	codes  map[string]PermissionCode
}

func LoadPermissionCodeStore(path string, logger *slog.Logger) (*PermissionCodeStore, error) {
	if logger == nil {
		logger = slog.Default()
	}

	store := &PermissionCodeStore{
		path:   path,
		logger: logger,
		codes:  make(map[string]PermissionCode),
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

func (s *PermissionCodeStore) List() []PermissionCode {
	if s == nil {
		return nil
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
	return codes
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

func (s *PermissionCodeStore) Resolve(code string) (Permissions, bool) {
	if s == nil {
		return Permissions{}, false
	}

	normalized, ok := normalizePermissionCode(code)
	if !ok {
		return Permissions{}, false
	}

	s.mu.RLock()
	entry, exists := s.codes[normalized]
	s.mu.RUnlock()
	if !exists {
		return Permissions{}, false
	}
	return entry.Permissions, true
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

func normalizePermissionCode(code string) (string, bool) {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	if normalized == "" {
		return "", false
	}
	return normalized, true
}
