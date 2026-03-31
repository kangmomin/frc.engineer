# frc.engineer Project Guide

## Release & Deploy

### 바이너리 구분
| 바이너리 | 소스 레포 | 용도 |
|---|---|---|
| `frc-co-driver.exe` | 타 레포 (별도 프로젝트) | **코드라이버** — 웹 대시보드 + UDP 수신 + 분석 올인원 |
| `frc-pitwall-sender.exe` | **이 레포** (`cmd/sender`) | **피트월 센더** — 게임 PC에서 실행하고 WebRTC로 원격 엔지니어에게 전송 |

> deploy 레포(`kangmomin/frc.engineer-deploy`)는 두 프로젝트의 바이너리를 통합 릴리스하는 단일 배포 지점이다.

### Version Source of Truth
- **`cmd/server/update_notice.go`** 의 `appVersion` 변수가 앱 내 버전 표시의 단일 소스
- 릴리스 시 반드시 이 값을 릴리스 버전과 동일하게 업데이트할 것
- deploy 레포(`kangmomin/frc.engineer-deploy`)의 태그가 배포 버전의 기준

### Deploy Checklist

릴리스 배포 시 아래 순서를 따른다:

1. **버전 업데이트**: `cmd/server/update_notice.go` 의 `appVersion` 을 새 버전으로 변경
2. **커밋 & 푸시**: 메인 레포 (`kangmomin/frc.engineer`) 에 커밋 후 push
3. **source-deploy-1 동기화**: `build/source-deploy-1` 에서 `git pull origin main`
4. **빌드** (pitwall-sender, Windows 크로스 컴파일):
   ```bash
   cd build/source-deploy-1
   GOOS=windows GOARCH=amd64 go build -o frc-pitwall-sender.exe ./cmd/sender
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

### Repository Structure
| 경로 | 설명 |
|---|---|
| `kangmomin/frc.engineer` | 소스 코드 (메인) |
| `kangmomin/frc.engineer-deploy` | 배포 바이너리 + GitHub Releases |
| `build/source-deploy-1` | 소스 동기화 & 빌드용 로컬 클론 |
| `build/deploy-inspect-1` | deploy 레포 로컬 클론 |
| `build/artifacts` | 빌드 산출물 보관 |
