# 100MiB를 넘는 Driver Pack installer는 Git LFS로 추적

- **날짜**: 2026-09-06
- **이슈**: Electron 44.2.0 보안 패치 후 검증 installer가 121,273,972B가 되어 GitHub의 일반 Git 파일 100MiB 한도를 초과했다. 기존 deploy 레포는 installer를 일반 binary blob으로 추적한다.
- **결정**: deploy 레포의 `Minmo-Driver-Pack-Setup.exe` 한 파일을 Git LFS로 추적한다. `frc-pitwall-sender.exe`, blockmap, `latest.yml`은 기존 저장 방식을 유지하고, GitHub Release에는 실제 installer·blockmap·`latest.yml` 3개 파일을 업로드한다. 기존 Git history는 다시 쓰지 않는다.
- **결정자**: 에이전트 — 사용자의 v4.54.0 릴리스 요청을 수행하며 배포 제약을 해결.
- **근거**: 기존 파일명·배포 레포의 최신 산출물 계약과 패치된 런타임을 유지할 수 있다. GitHub는 100MiB 초과 파일을 차단하며 이 한도를 넘겨 Git에서 추적하려면 LFS를 사용하도록 안내한다. [GitHub 공식 문서](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- **기각된 대안**: 구버전 Electron 유지 또는 로캘·런타임 파일 삭제는 보안 패치와 배포 내용에 영향을 준다. installer를 Git에서 제거하고 Release에만 두면 현재 deploy 레포의 산출물 추적 계약이 달라진다.
- **수정 내역**: deploy `.gitattributes`에 installer 전용 LFS 필터를 추가하고, 배포 클론에 LFS hook을 설치한다. `AGENTS.md`와 `CLAUDE.md`에 실제 파일 업로드 규칙을 기록한다. source/deploy commit은 v4.54.0 Release notes에서 확인한다.
- **재발 시 대응**: 이후 빌드에서 크기 문제를 재제기하면 본 문서를 따른다. LFS 객체 SHA-256·크기와 실제 파일을 대조하고, remote LFS 업로드 및 Release asset digest를 검증한다. LFS 설치 없이 clone한 pointer를 installer로 업로드하지 않는다.
