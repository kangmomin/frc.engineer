package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"frc.engineer/internal/analysis"
)

type sessionAnalysisCacheEntry struct {
	fingerprint string
	result      *analysis.AnalysisResult
}

func sessionAnalysisFingerprint(dir string) (string, error) {
	required := []string{"lap_data.jsonl", "telemetry.jsonl", "motion.jsonl", "session.jsonl"}
	optional := []string{"car_status.jsonl"}

	parts := make([]string, 0, len(required)+len(optional))
	for _, name := range required {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			return "", err
		}
		parts = append(parts, fmt.Sprintf("%s:%d:%d", name, info.Size(), info.ModTime().UnixNano()))
	}
	for _, name := range optional {
		info, err := os.Stat(filepath.Join(dir, name))
		if err == nil {
			parts = append(parts, fmt.Sprintf("%s:%d:%d", name, info.Size(), info.ModTime().UnixNano()))
		}
	}
	return strings.Join(parts, "|"), nil
}
