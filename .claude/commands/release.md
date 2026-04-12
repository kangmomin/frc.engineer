---
description: "frc-pitwall-sender 릴리스 배포 자동화"
allowed-tools: ["Bash", "Read", "Edit", "Grep"]
---

# Release: frc-pitwall-sender

deploy 레포(`kangmomin/frc.engineer-deploy`)의 최신 태그를 기준으로 다음 버전을 결정하고, CLAUDE.md의 Deploy Checklist를 순서대로 실행한다.

## 인자

- `$ARGUMENTS` 에 버전이 주어지면 해당 버전을 사용 (예: `/release v3.6.0`)
- 인자가 없으면 deploy 레포의 최신 태그에서 minor를 +1하여 자동 결정

## 실행 순서

### 1. 버전 결정
- `build/deploy-inspect-1`에서 `git fetch --tags`로 최신 태그 조회
- 최신 태그의 minor+1 또는 사용자 지정 버전 사용
- `cmd/server/update_notice.go`의 `appVersion`을 해당 버전으로 변경

### 2. 커밋 & 푸시 (메인 레포)
- 변경된 `update_notice.go`를 커밋: `Chore: appVersion vX.Y.Z 으로 업데이트`
- `git push origin main`

### 3. source-deploy-1 동기화 & 빌드
- `build/source-deploy-1`에서 `git pull origin main`
- Windows GUI 크로스 컴파일:
  ```
  GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui" -o frc-pitwall-sender.exe ./cmd/sender
  ```
- `file frc-pitwall-sender.exe`로 PE32+ GUI 확인 (반드시 "GUI" 포함 검증)

### 4. deploy 레포 동기화 & 바이너리 복사
- `build/deploy-inspect-1`에서 `git pull origin main`
- 바이너리 복사:
  ```
  cp build/source-deploy-1/frc-pitwall-sender.exe build/deploy-inspect-1/frc-pitwall-sender.exe
  cp build/source-deploy-1/frc-pitwall-sender.exe build/artifacts/frc-pitwall-sender.exe
  ```
- Electron 산출물 복사:
  ```
  cp apps/setup-manager/release/Minmo-Driver-Pack-Setup.exe build/deploy-inspect-1/
  cp apps/setup-manager/release/Minmo-Driver-Pack-Setup.exe.blockmap build/deploy-inspect-1/
  cp apps/setup-manager/release/latest.yml build/deploy-inspect-1/
  ```
 - deploy 레포의 이전 버전명 installer / blockmap / portable 파일은 삭제하고 최신 파일만 유지

### 5. deploy 레포 커밋 & 태그 & 푸시
```
cd build/deploy-inspect-1
git add frc-pitwall-sender.exe
git commit -m "deploy: frc-pitwall-sender vX.Y.Z"
git tag vX.Y.Z
git push origin refs/heads/main:refs/heads/main
git push origin vX.Y.Z
```

### 6. GitHub Release 생성
- deploy-inspect-1 디렉토리에서:
  ```
gh release create vX.Y.Z \
    Minmo-Driver-Pack-Setup.exe \
    Minmo-Driver-Pack-Setup.exe.blockmap \
    latest.yml
  ```
- 릴리스 노트에 주요 변경사항 포함
- Setup 인스톨러 + `latest.yml` + `.blockmap` 3개 파일을 에셋으로 업로드 (auto-update에 필요)

### 7. 메인 레포 태그
- 메인 레포 루트에서: `git tag vX.Y.Z && git push origin vX.Y.Z`

### 8. 완료 보고
- 릴리스 URL 출력
- 체크리스트 결과 테이블 출력

## 주의사항
- 빌드 결과가 **PE32+ executable (GUI)** 인지 반드시 확인. "console"이면 중단하고 `-H windowsgui` 누락 경고
- `build/source-deploy-1` 또는 `build/deploy-inspect-1`이 비어있으면 `git clone`으로 초기화
- 릴리스 에셋은 Setup 인스톨러 + `latest.yml` + `.blockmap` 3개 업로드 (auto-update 필수)
