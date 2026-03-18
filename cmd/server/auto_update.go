package main

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// cleanOldBinary removes leftover .old files from previous updates.
func cleanOldBinary(logger *slog.Logger) {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	oldPath := exePath + ".old"
	if err := os.Remove(oldPath); err == nil {
		logger.Info("cleaned up old binary", "path", oldPath)
	}
}

// autoUpdate checks for a new release and performs automatic download, replace, and restart.
func autoUpdate(logger *slog.Logger) error {
	if env := os.Getenv("AUTO_UPDATE"); strings.EqualFold(env, "false") || env == "0" {
		logger.Info("auto-update disabled via AUTO_UPDATE env var")
		return nil
	}

	release, hasUpdate, err := checkForNewRelease(appVersion)
	if err != nil {
		return fmt.Errorf("update check: %w", err)
	}
	if !hasUpdate {
		return nil
	}

	asset := findExeAsset(release.Assets)
	if asset == nil {
		return fmt.Errorf("no .exe asset found in release %s", release.TagName)
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	logger.Info("auto-update: new version found, downloading",
		"current", appVersion,
		"latest", release.TagName,
		"asset", asset.Name,
		"size", asset.Size,
	)
	fmt.Printf("\n[자동 업데이트] %s → %s 다운로드 중...\n", appVersion, release.TagName)

	dir := filepath.Dir(exePath)
	tempPath, err := downloadAsset(logger, asset, dir)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}

	// Verify downloaded file size matches GitHub asset metadata
	info, err := os.Stat(tempPath)
	if err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("stat temp file: %w", err)
	}
	if asset.Size > 0 && info.Size() != asset.Size {
		os.Remove(tempPath)
		return fmt.Errorf("size mismatch: expected %d, got %d", asset.Size, info.Size())
	}

	if err := replaceBinary(exePath, tempPath); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("replace binary: %w", err)
	}

	fmt.Printf("[자동 업데이트] %s 설치 완료, 재시작합니다...\n\n", release.TagName)
	logger.Info("auto-update: binary replaced, restarting", "version", release.TagName)

	if err := restartProcess(exePath); err != nil {
		return fmt.Errorf("restart: %w", err)
	}

	return nil // unreachable after os.Exit
}

func findExeAsset(assets []githubReleaseAsset) *githubReleaseAsset {
	for i := range assets {
		if strings.HasSuffix(strings.ToLower(assets[i].Name), ".exe") {
			return &assets[i]
		}
	}
	return nil
}

func downloadAsset(logger *slog.Logger, asset *githubReleaseAsset, dir string) (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(asset.BrowserDownloadURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned status %d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp(dir, "frc-engineer-update-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()

	var written int64
	buf := make([]byte, 32*1024)
	lastPercent := -1

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := tmpFile.Write(buf[:n]); wErr != nil {
				tmpFile.Close()
				os.Remove(tmpPath)
				return "", wErr
			}
			written += int64(n)
			if asset.Size > 0 {
				percent := int(written * 100 / asset.Size)
				if percent != lastPercent && percent%10 == 0 {
					fmt.Printf("[자동 업데이트] 다운로드 진행: %d%%\n", percent)
					lastPercent = percent
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			tmpFile.Close()
			os.Remove(tmpPath)
			return "", readErr
		}
	}

	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return "", err
	}

	return tmpPath, nil
}

// replaceBinary performs a safe binary swap on Windows:
// current exe → exe.old, then temp → exe path. Rolls back on failure.
func replaceBinary(exePath, tempPath string) error {
	oldPath := exePath + ".old"
	os.Remove(oldPath)

	if err := os.Rename(exePath, oldPath); err != nil {
		return fmt.Errorf("rename current to .old: %w", err)
	}

	if err := os.Rename(tempPath, exePath); err != nil {
		// Rollback: restore old binary
		if rbErr := os.Rename(oldPath, exePath); rbErr != nil {
			return fmt.Errorf("rename temp to exe failed (%v) AND rollback failed (%v)", err, rbErr)
		}
		return fmt.Errorf("rename temp to exe: %w", err)
	}

	return nil
}

func restartProcess(exePath string) error {
	cmd := exec.Command(exePath, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	if err := cmd.Start(); err != nil {
		return err
	}

	os.Exit(0)
	return nil // unreachable
}
