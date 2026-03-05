# frc.engineer Project Guide

## Release & Deploy

### Version Source of Truth
- **`cmd/server/update_notice.go`** 의 `appVersion` 변수가 앱 내 버전 표시의 단일 소스
- 릴리스 시 반드시 이 값을 릴리스 버전과 동일하게 업데이트할 것

### Deploy Checklist

릴리스 배포 시 아래 순서를 따른다:

1. **버전 업데이트**: `cmd/server/update_notice.go` 의 `appVersion` 을 새 버전으로 변경
2. **커밋 & 푸시**: 메인 레포 (`kangmomin/frc.engineer`) 에 커밋 후 push
3. **source-deploy-1 동기화**: `build/source-deploy-1` 에서 `git pull origin main`
4. **빌드**:
   ```bash
   cd build/source-deploy-1
   cd web && npm ci && npm run build && cd ..
   go build -o frc-engineer.exe ./cmd/server
   ```
5. **바이너리 복사**:
   ```bash
   cp build/source-deploy-1/frc-engineer.exe build/deploy-inspect-1/frc-engineer.exe
   cp build/source-deploy-1/frc-engineer.exe build/artifacts/frc-engineer.exe
   ```
6. **deploy 레포 푸시**: `build/deploy-inspect-1` 에서 커밋 & push (태그 포함)
   ```bash
   cd build/deploy-inspect-1
   git add frc-engineer.exe
   git commit -m "deploy: frc-engineer vX.Y.Z"
   git tag vX.Y.Z
   git push origin refs/heads/main:refs/heads/main
   git push origin vX.Y.Z
   ```
7. **GitHub Release 생성**: `kangmomin/frc.engineer-deploy` 에 릴리스 생성 + exe 에셋 업로드
8. **메인 레포 태그**: 메인 레포에도 동일 버전 태그 생성 & push

### Repository Structure
| 경로 | 설명 |
|---|---|
| `kangmomin/frc.engineer` | 소스 코드 (메인) |
| `kangmomin/frc.engineer-deploy` | 배포 바이너리 + GitHub Releases |
| `build/source-deploy-1` | 소스 동기화 & 빌드용 로컬 클론 |
| `build/deploy-inspect-1` | deploy 레포 로컬 클론 |
| `build/artifacts` | 빌드 산출물 보관 |
