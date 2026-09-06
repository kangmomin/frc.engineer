# frc.engineer Project Guide

## Release & Deploy

### 산출물 구분
| 산출물 | 소스 | 용도 |
|---|---|---|
| **Minmo Driver Pack** (Electron 앱) | `apps/setup-manager/` + `cmd/sender` | Setup Manager UI + Pitwall Sender 통합 패키지 |

> deploy 레포(`kangmomin/frc.engineer-deploy`)는 Minmo Driver Pack 인스톨러를 배포하는 단일 배포 지점이다.

> 100MiB를 넘는 `Minmo-Driver-Pack-Setup.exe`는 deploy 레포에서 Git LFS로 추적한다. 배포 클론에는 Git LFS를 설치하고, GitHub Release에는 LFS pointer가 아닌 실제 installer 파일을 업로드한다.

### Version Source of Truth

릴리스 버전은 **`apps/setup-manager/package.json`의 `version` 필드**가 기준이다.

| 파일 | 용도 |
|---|---|
| `apps/setup-manager/package.json` → `version` | **릴리스 버전** (Electron 앱 버전, deploy 태그 기준) |
| `cmd/sender/main.go` → `appVersion` | sender 내부 표시용 (tray tooltip, debug API). 릴리스 시 package.json과 동기화 |
| `cmd/server/update_notice.go` → `appVersion` | server 전용 (이 레포 deploy와 무관) |

### Deploy Checklist

릴리스 배포 시 아래 순서를 따른다:

1. **버전 업데이트**:
   - `apps/setup-manager/package.json`의 `version`
   - `cmd/sender/main.go`의 `appVersion` (동일 버전으로 맞춤)
2. **커밋 & 푸시**: 메인 레포에 커밋 후 push
3. **source-deploy-1 동기화**: `build/source-deploy-1` 에서 `git pull origin main`
4. **sender 빌드** (Windows GUI 크로스 컴파일):
   ```bash
   cd build/source-deploy-1
   GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o frc-pitwall-sender.exe ./cmd/sender
   cp frc-pitwall-sender.exe ../artifacts/frc-pitwall-sender.exe
   ```
5. **Electron 앱 빌드**:
   ```bash
   cd apps/setup-manager
   npm install
   npm run build
   npm run dist:win
   ```
   > 산출물: `apps/setup-manager/release/` 에 NSIS installer + portable exe 생성
6. **deploy 레포 동기화**: `build/deploy-inspect-1` 에서 `git pull origin main`
7. **Electron 산출물을 deploy 레포에 복사**:
   ```bash
   cp apps/setup-manager/release/Minmo-Driver-Pack-Setup.exe build/deploy-inspect-1/
   cp apps/setup-manager/release/Minmo-Driver-Pack-Setup.exe.blockmap build/deploy-inspect-1/
   cp apps/setup-manager/release/latest.yml build/deploy-inspect-1/
   ```
   > deploy 레포에는 최신 installer 한 벌만 유지하고, 이전 버전명 installer / blockmap / portable 파일은 삭제
8. **deploy 레포 푸시**: `build/deploy-inspect-1` 에서 커밋 & push (태그 포함)
   ```bash
   cd build/deploy-inspect-1
   git add *.exe *.blockmap latest.yml
   git commit -m "deploy: Minmo Driver Pack vX.Y.Z"
   git tag vX.Y.Z
   git push origin refs/heads/main:refs/heads/main
   git push origin vX.Y.Z
   ```
9. **GitHub Release 생성**: `kangmomin/frc.engineer-deploy` 에 릴리스 생성 + Setup 인스톨러 + `latest.yml` + `.blockmap` 3개 에셋 업로드 (auto-update에 필요)
   ```bash
   gh release create vX.Y.Z \
     Minmo-Driver-Pack-Setup.exe \
     Minmo-Driver-Pack-Setup.exe.blockmap \
     latest.yml
   ```
10. **메인 레포 태그**: 메인 레포에도 동일 버전 태그 생성 & push

### WebRTC 페이로드 사이즈 제약
WebRTC DataChannel 관련 기능을 추가하거나 DTO 필드를 확장할 때, **최대 페이로드가 Chrome SCTP 수신 버퍼(256KB)를 초과하지 않는지 반드시 검토**해야 한다.

- 모든 드라이버 데이터가 채워진 worst-case 기준으로 추정 (**F1 26(2026 Season Pack)은 NumCars=24** — 22대 기준으로 잡지 말 것. F1 25는 22대)
- TrackMap 포함 시 피크 사이즈 고려
- `maxBufferedAmount`(128KB)와의 관계도 확인
- 초과 가능성이 있으면 `omitempty` 적용, 필드 분리, 또는 전송 빈도 조절로 대응

### Repository Structure
| 경로 | 설명 |
|---|---|
| `kangmomin/frc.engineer` | 소스 코드 (메인) |
| `kangmomin/frc.engineer-deploy` | Minmo Driver Pack 인스톨러 배포 + GitHub Releases |
| `build/source-deploy-1` | 소스 동기화 & 빌드용 로컬 클론 |
| `build/deploy-inspect-1` | deploy 레포 로컬 클론 |
| `build/artifacts` | 빌드 산출물 보관 |
