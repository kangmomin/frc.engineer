# frc.engineer Project Guide

## Release & Deploy

### 바이너리 구분
| 바이너리 | 소스 레포 | 용도 |
|---|---|---|
| `frc-co-driver.exe` | 타 레포 (별도 프로젝트) | **코드라이버** — 웹 대시보드 + UDP 수신 + 분석 올인원 |
| `frc-pitwall-sender.exe` | **이 레포** (`cmd/sender`) | **피트월 센더** — 게임 PC에서 실행하고 WebRTC로 원격 엔지니어에게 전송 |

> deploy 레포(`kangmomin/frc.engineer-deploy`)는 두 프로젝트의 바이너리를 통합 릴리스하는 단일 배포 지점이다.

### Version Source of Truth

두 바이너리가 **각각 독립된 `appVersion` 변수**를 갖고 있다. 릴리스 시 **반드시 두 파일 모두** 동일 버전으로 업데이트해야 한다.

| 파일 | 바이너리 | 역할 |
|---|---|---|
| `cmd/server/update_notice.go` | frc-co-driver | 서버(대시보드) 버전 표시 + 업데이트 체크 |
| `cmd/sender/main.go` | frc-pitwall-sender | 센더 버전 표시 + **자동 업데이트 비교 기준** |

> **주의**: sender의 `appVersion`을 올리지 않으면 빌드된 바이너리가 항상 구버전으로 인식하여 **자동 업데이트 무한 루프**가 발생한다.

- deploy 레포(`kangmomin/frc.engineer-deploy`)의 태그가 배포 버전의 기준

### Deploy Checklist

릴리스 배포 시 아래 순서를 따른다:

1. **버전 업데이트** (두 파일 모두 동일 버전으로 변경):
   - `cmd/server/update_notice.go` 의 `appVersion`
   - `cmd/sender/main.go` 의 `appVersion`
2. **커밋 & 푸시**: 메인 레포 (`kangmomin/frc.engineer`) 에 커밋 후 push
3. **source-deploy-1 동기화**: `build/source-deploy-1` 에서 `git pull origin main`
4. **빌드** (pitwall-sender, Windows GUI 크로스 컴파일):
   ```bash
   cd build/source-deploy-1
   GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o frc-pitwall-sender.exe ./cmd/sender
   ```
5. **deploy 레포 동기화**: `build/deploy-inspect-1` 에서 `git pull origin main`
6. **바이너리 복사**:
   ```bash
   cp build/source-deploy-1/frc-pitwall-sender.exe build/deploy-inspect-1/frc-pitwall-sender.exe
   cp build/source-deploy-1/frc-pitwall-sender.exe build/artifacts/frc-pitwall-sender.exe
   ```
7. **deploy 레포 푸시**: `build/deploy-inspect-1` 에서 커밋 & push (태그 포함)
   ```bash
   cd build/deploy-inspect-1
   git add frc-pitwall-sender.exe
   git commit -m "deploy: frc-pitwall-sender vX.Y.Z"
   git tag vX.Y.Z
   git push origin refs/heads/main:refs/heads/main
   git push origin vX.Y.Z
   ```
8. **GitHub Release 생성**: `kangmomin/frc.engineer-deploy` 에 릴리스 생성 + `frc-co-driver.exe`, `frc-pitwall-sender.exe` 에셋 업로드
   > `frc-co-driver.exe`는 타 레포에서 별도로 deploy 레포에 push한다. 이 레포에서는 sender만 담당.
9. **메인 레포 태그**: 메인 레포에도 동일 버전 태그 생성 & push

### WebRTC 페이로드 사이즈 제약
WebRTC DataChannel 관련 기능을 추가하거나 DTO 필드를 확장할 때, **최대 페이로드가 Chrome SCTP 수신 버퍼(256KB)를 초과하지 않는지 반드시 검토**해야 한다.

- 모든 드라이버(22대) 데이터가 채워진 worst-case 기준으로 추정
- TrackMap 포함 시 피크 사이즈 고려
- `maxBufferedAmount`(128KB)와의 관계도 확인
- 초과 가능성이 있으면 `omitempty` 적용, 필드 분리, 또는 전송 빈도 조절로 대응

### Repository Structure
| 경로 | 설명 |
|---|---|
| `kangmomin/frc.engineer` | 소스 코드 (메인) |
| `kangmomin/frc.engineer-deploy` | 배포 바이너리 + GitHub Releases |
| `build/source-deploy-1` | 소스 동기화 & 빌드용 로컬 클론 |
| `build/deploy-inspect-1` | deploy 레포 로컬 클론 |
| `build/artifacts` | 빌드 산출물 보관 |
