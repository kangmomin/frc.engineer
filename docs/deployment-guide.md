# Deployment Guide

This project uses two repositories:

- `frc.engineer`: source code repository
- `frc.engineer-deploy`: binary distribution repository (`frc-engineer.exe`)

The app checks updates from:

- `https://github.com/kangmomin/frc.engineer-deploy/releases/latest`

When a newer release tag exists than the app's internal version, startup prints an update notice in CMD.

---

## 1. Prerequisites

- Windows + PowerShell
- Go 1.22+
- Node.js + npm
- Git
- GitHub CLI (`gh`) logged in with `repo` scope

Quick check:

```powershell
go version
npm -v
git --version
gh auth status
```

---

## 2. Versioning Rule

Use semantic version tags:

- Major: `v2.0.0` (breaking change)
- Minor: `v1.1.0`
- Patch: `v1.0.1`

For a major bump from `v1.0.0`, next is `v2.0.0`.

---

## 3. Release Flow (Summary)

1. Commit and push source changes in `frc.engineer`
2. Build frontend + backend binary with release version injected
3. Copy binary to `frc.engineer-deploy` as `frc-engineer.exe`
4. Commit and push deploy repo
5. Create tags + GitHub Releases in both repos
6. Upload `frc-engineer.exe` asset to deploy release

---

## 4. Detailed Steps

### 4.1 Source repo (`frc.engineer`)

```powershell
cd G:\files\frc.engineer

# 1) Build frontend
cd web
npm ci
npm run build
cd ..

# 2) Build release binary with version injection
# Example for major release v2.0.0:
go build -ldflags "-X main.appVersion=v2.0.0" -o frc.engineer.exe ./cmd/server

# Optional local verification build
go build -o frc-engineer ./cmd/server
```

Commit/push source changes:

```powershell
git add <changed files>
git commit -m "feat: ..."
git push origin main
```

Create source tag + release:

```powershell
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
gh release create v2.0.0 --title "v2.0.0" --generate-notes --latest
```

### 4.2 Deploy repo (`frc.engineer-deploy`)

```powershell
cd G:\files\frc.engineer-deploy

# 1) Replace deploy binary
Copy-Item -Force G:\files\frc.engineer\frc.engineer.exe .\frc-engineer.exe

# 2) Commit + push
git add frc-engineer.exe
git commit -m "deploy: update binary from frc.engineer v2.0.0"
git pull --rebase origin main
git push origin main
```

Create deploy tag + release with asset:

```powershell
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
gh release create v2.0.0 .\frc-engineer.exe `
  --title "v2.0.0" `
  --notes "Major release v2.0.0" `
  --latest
```

---

## 5. Startup Messages (Current Behavior)

At startup, CMD prints:

- Access guide:
  - `여기서 localhost:{port} 로 접속하시면 됩니다.`
- Update notice:
  - shown only if deploy latest release tag > app internal version (`main.appVersion`)

If version injection is skipped during build, update detection may be inaccurate.

---

## 6. Troubleshooting

### Port already in use

Symptom:

- `failed to create UDP listener ... bind: Only one usage ...`

Action:

- stop the existing process or change `udpPort`/`backendPort` in `config.json`

### Deploy push rejected (non-fast-forward)

Action:

```powershell
git pull --rebase origin main
git push origin main
```

If binary conflict occurs during rebase, recopy latest binary, `git add`, then:

```powershell
git rebase --continue
```

