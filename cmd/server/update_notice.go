package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	deployLatestReleaseAPI = "https://api.github.com/repos/kangmomin/frc.engineer-deploy/releases/latest"
	deployReleasesURL      = "https://github.com/kangmomin/frc.engineer-deploy/releases"
)

// appVersion is injected at build time for release binaries:
// go build -ldflags "-X main.appVersion=v2.6.0" ...
var appVersion = "v2.8.0"

type githubReleaseAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type githubLatestRelease struct {
	TagName string               `json:"tag_name"`
	HTMLURL string               `json:"html_url"`
	Assets  []githubReleaseAsset `json:"assets"`
}

type semVer struct {
	major int
	minor int
	patch int
}

func printStartupAccessGuide(logger *slog.Logger, port int) {
	url := fmt.Sprintf("http://localhost:%d", port)
	logger.Info("dashboard access", "url", url)
	fmt.Printf("\n여기서 localhost:%d 로 접속하시면 됩니다. (%s)\n\n", port, url)
}

func checkForUpdateAsync(logger *slog.Logger) {
	go func() {
		release, hasUpdate, err := checkForNewRelease(appVersion)
		if err != nil {
			logger.Warn("update check failed", "error", err)
			return
		}
		if !hasUpdate {
			return
		}
		latestURL := release.HTMLURL
		if latestURL == "" {
			latestURL = deployReleasesURL
		}

		logger.Warn("new version available",
			"currentVersion", appVersion,
			"latestVersion", release.TagName,
			"url", latestURL,
		)
		fmt.Printf("[업데이트 안내] 신규 버전 %s 이(가) 나왔습니다. 현재 버전: %s\n업데이트: %s\n\n",
			release.TagName, appVersion, latestURL)
	}()
}

func checkForNewRelease(currentVersion string) (*githubLatestRelease, bool, error) {
	current, ok := parseSemVer(currentVersion)
	if !ok {
		return nil, false, fmt.Errorf("invalid current version: %q", currentVersion)
	}

	req, err := http.NewRequest(http.MethodGet, deployLatestReleaseAPI, nil)
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

	var latest githubLatestRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&latest); err != nil {
		return nil, false, err
	}

	latestParsed, ok := parseSemVer(latest.TagName)
	if !ok {
		return &latest, false, fmt.Errorf("invalid latest tag format: %q", latest.TagName)
	}

	return &latest, compareSemVer(latestParsed, current) > 0, nil
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
