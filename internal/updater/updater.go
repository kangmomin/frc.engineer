// Package updater provides self-update functionality by checking
// GitHub releases and replacing the running binary.
package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DeployLatestReleaseAPI = "https://api.github.com/repos/kangmomin/frc.engineer-deploy/releases/latest"
	DeployReleasesURL      = "https://github.com/kangmomin/frc.engineer-deploy/releases"
)

// ProgressFunc is called during auto-update with a status message and
// a percentage (0-100). pct is -1 for non-download steps.
type ProgressFunc func(status string, pct int)

// ReleaseAsset represents a single file attached to a GitHub release.
type ReleaseAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// LatestRelease is the response from the GitHub releases/latest API.
type LatestRelease struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Assets  []ReleaseAsset `json:"assets"`
}

type semVer struct {
	major, minor, patch int
}

// CleanOldBinary removes leftover .old files from previous updates.
func CleanOldBinary(logger *slog.Logger) {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	oldPath := exePath + ".old"
	if err := os.Remove(oldPath); err == nil {
		logger.Info("cleaned up old binary", "path", oldPath)
	}
}

// CheckForNewRelease checks the deploy repo for a newer version.
func CheckForNewRelease(currentVersion string) (*LatestRelease, bool, error) {
	current, ok := parseSemVer(currentVersion)
	if !ok {
		return nil, false, fmt.Errorf("invalid current version: %q", currentVersion)
	}

	req, err := http.NewRequest(http.MethodGet, DeployLatestReleaseAPI, nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "frc.engineer-update-check")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("release API returned status %d", resp.StatusCode)
	}

	var latest LatestRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&latest); err != nil {
		return nil, false, err
	}

	latestParsed, ok := parseSemVer(latest.TagName)
	if !ok {
		return &latest, false, fmt.Errorf("invalid latest tag format: %q", latest.TagName)
	}

	return &latest, compareSemVer(latestParsed, current) > 0, nil
}

// CheckForUpdateAsync logs a notice if a newer release is available.
func CheckForUpdateAsync(logger *slog.Logger, appVersion string) {
	go func() {
		release, hasUpdate, err := CheckForNewRelease(appVersion)
		if err != nil {
			logger.Warn("update check failed", "error", err)
			return
		}
		if !hasUpdate {
			return
		}
		latestURL := release.HTMLURL
		if latestURL == "" {
			latestURL = DeployReleasesURL
		}
		logger.Warn("new version available",
			"currentVersion", appVersion,
			"latestVersion", release.TagName,
			"url", latestURL,
		)
	}()
}

// AutoUpdate checks for a new release and performs download, replace, and restart.
// It matches the running executable's filename against the release assets.
// If onProgress is non-nil, it is called with human-readable status strings.
func AutoUpdate(logger *slog.Logger, appVersion string, onProgress ProgressFunc) error {
	notify := func(s string, pct int) {
		if onProgress != nil {
			onProgress(s, pct)
		}
	}

	if env := os.Getenv("AUTO_UPDATE"); strings.EqualFold(env, "false") || env == "0" {
		logger.Info("auto-update disabled via AUTO_UPDATE env var")
		return nil
	}

	notify("Checking for updates...", -1)

	release, hasUpdate, err := CheckForNewRelease(appVersion)
	if err != nil {
		return fmt.Errorf("update check: %w", err)
	}
	if !hasUpdate {
		return nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	exeName := strings.ToLower(filepath.Base(exePath))
	asset := FindExeAsset(release.Assets, exeName)
	if asset == nil {
		return fmt.Errorf("no matching asset for %q in release %s", exeName, release.TagName)
	}

	logger.Info("auto-update: new version found, downloading",
		"current", appVersion,
		"latest", release.TagName,
		"asset", asset.Name,
		"size", asset.Size,
	)

	notify(fmt.Sprintf("Update %s found, downloading...", release.TagName), 0)

	dir := filepath.Dir(exePath)
	progressCb := func(downloaded, total int64) {
		if total <= 0 {
			return
		}
		pct := int(downloaded * 100 / total)
		notify(fmt.Sprintf("%.1fMB / %.1fMB",
			float64(downloaded)/(1024*1024), float64(total)/(1024*1024)), pct)
	}
	tempPath, err := downloadAsset(asset, dir, progressCb)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}

	info, err := os.Stat(tempPath)
	if err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("stat temp file: %w", err)
	}
	if asset.Size > 0 && info.Size() != asset.Size {
		os.Remove(tempPath)
		return fmt.Errorf("size mismatch: expected %d, got %d", asset.Size, info.Size())
	}

	notify("Replacing binary...", -1)

	if err := replaceBinary(exePath, tempPath); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("replace binary: %w", err)
	}

	logger.Info("auto-update: binary replaced, restarting", "version", release.TagName)
	notify(fmt.Sprintf("Restarting with %s...", release.TagName), -1)

	if err := restartProcess(exePath); err != nil {
		return fmt.Errorf("restart: %w", err)
	}

	return nil
}

// FindExeAsset finds a release asset matching the given executable name.
func FindExeAsset(assets []ReleaseAsset, selfName string) *ReleaseAsset {
	for i := range assets {
		if strings.EqualFold(assets[i].Name, selfName) {
			return &assets[i]
		}
	}
	return nil
}

func downloadAsset(asset *ReleaseAsset, dir string, onProgress func(downloaded, total int64)) (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(asset.BrowserDownloadURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned status %d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp(dir, "frc-update-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()

	total := asset.Size
	var reader io.Reader = resp.Body
	if onProgress != nil && total > 0 {
		reader = &progressReader{r: resp.Body, total: total, onProgress: onProgress}
	}

	if _, err := io.Copy(tmpFile, reader); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return "", err
	}

	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return "", err
	}

	return tmpPath, nil
}

// progressReader wraps an io.Reader and reports download progress.
type progressReader struct {
	r          io.Reader
	total      int64
	downloaded int64
	lastPct    int
	onProgress func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	if n > 0 {
		pr.downloaded += int64(n)
		pct := int(pr.downloaded * 100 / pr.total)
		if pct != pr.lastPct {
			pr.lastPct = pct
			pr.onProgress(pr.downloaded, pr.total)
		}
	}
	return n, err
}

func replaceBinary(exePath, tempPath string) error {
	oldPath := exePath + ".old"
	os.Remove(oldPath)

	if err := os.Rename(exePath, oldPath); err != nil {
		return fmt.Errorf("rename current to .old: %w", err)
	}

	if err := os.Rename(tempPath, exePath); err != nil {
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
	return nil
}

func parseSemVer(version string) (semVer, bool) {
	v := strings.TrimSpace(version)
	if v == "" {
		return semVer{}, false
	}
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")

	parts := strings.Split(v, ".")
	if len(parts) < 3 {
		return semVer{}, false
	}

	major, ok := parseIntPrefix(parts[0])
	if !ok {
		return semVer{}, false
	}
	minor, ok := parseIntPrefix(parts[1])
	if !ok {
		return semVer{}, false
	}
	patch, ok := parseIntPrefix(parts[2])
	if !ok {
		return semVer{}, false
	}

	return semVer{major: major, minor: minor, patch: patch}, true
}

func parseIntPrefix(part string) (int, bool) {
	part = strings.TrimSpace(part)
	if part == "" {
		return 0, false
	}
	end := 0
	for i := 0; i < len(part); i++ {
		if part[i] < '0' || part[i] > '9' {
			break
		}
		end = i + 1
	}
	if end == 0 {
		return 0, false
	}
	n, err := strconv.Atoi(part[:end])
	if err != nil {
		return 0, false
	}
	return n, true
}

func compareSemVer(a, b semVer) int {
	if a.major != b.major {
		if a.major > b.major {
			return 1
		}
		return -1
	}
	if a.minor != b.minor {
		if a.minor > b.minor {
			return 1
		}
		return -1
	}
	if a.patch != b.patch {
		if a.patch > b.patch {
			return 1
		}
		return -1
	}
	return 0
}
