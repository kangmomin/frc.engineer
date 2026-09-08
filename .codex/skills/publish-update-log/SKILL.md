---
name: publish-update-log
description: frc.engineer 변경사항을 사용자용 업데이트 로그로 정리하고 Python 스크립트로 전용 API에 게시한다. 업데이트 공지 작성·등록·발행 요청에 사용한다.
---

# 업데이트 로그 작성과 API 게시

이 스킬의 디렉터리를 기준으로 `scripts/publish_update_log.py`를 실행한다. Python 3.10 이상, 표준 라이브러리만 사용한다. API 계약·키 설정·운영 제한은 [references/api.md](references/api.md)를 필요한 경우 읽는다.

## 작성

- 사용자가 지정한 저장소·커밋 범위·릴리스의 변경을 읽어 제목과 사용자에게 보이는 개선 사항을 한국어 일반 텍스트로 정리한다. 구현 예정 내용을 완료한 기능으로 쓰지 않는다. 테스트 결과는 실제 실행 근거가 있을 때만 포함한다.
- 요청에 범위가 없다면 이번 대화에서 완료한 변경을 사용한다. 관련 없는 작업 트리 변경은 포함하지 않는다.
- `releaseKey`는 재시도에도 유지되는 식별자다. 사용자가 지정한 값을 우선하고, 커밋 기반이면 전체 SHA를 포함한 `commit:<sha>`를 사용한다. 앱 릴리스 버전이 필요한 경우 `apps/setup-manager/package.json`의 `version`이 기준이다. 커밋 이전 작업이고 식별자가 없다면 `update:<UUID>`를 한 번 생성해 요청 파일에 보존한다.
- UTF-8 JSON 파일에 `releaseKey`, `title`, `body`만 쓴다. 제목 1~120자, 본문 1~10,000자. HTML·Markdown 렌더링은 제공하지 않으므로 읽기 쉬운 일반 텍스트와 줄바꿈을 사용한다.

```bash
python3 <스킬 디렉터리>/scripts/publish_update_log.py publish --payload /tmp/update-log.json --dry-run
```

## 게시

현재 사용자의 요청이 실제 게시까지 포함하면 그 승인을 재사용한다. 초안·요약·API/스크립트 구현만 요청했거나 게시를 보류한 경우에는 요청 파일과 dry-run 결과까지만 전달한다. 게시를 원하지만 대상 서버나 게시할 내용의 범위가 불명확한 경우에는 가능한 준비를 마친 뒤 누락된 정보만 묻는다. 게시 대상 서버를 변경하면 새 대상에 대한 요청 범위를 확인한다.

```bash
python3 <스킬 디렉터리>/scripts/publish_update_log.py publish \
  --base-url https://<플랫폼 서버> \
  --key-file <키 파일 경로> \
  --payload /tmp/update-log.json
```

- 이미 `PLATFORM_URL`과 `PLATFORM_UPDATE_LOG_API_KEY`가 실행 환경에 있으면 `--base-url`, `--key-file`을 생략한다.
- 키는 스크립트가 읽는다. 키 파일·환경변수 원본을 도구 출력, AI 컨텍스트, 요청 본문, URL, 커밋에 복사하지 않는다. 키가 없으면 먼저 요청 파일을 완성하고 [키 설정 안내](references/api.md#키-설정)를 전달한다.
- 스크립트는 한 번만 요청한다. 401은 키 설정을 확인하고 중단, 409는 기존 게시물과 내용 차이를 확인하고 중단한다. 429는 `Retry-After`를 보고하며 반복 호출하지 않는다.
- 타임아웃·네트워크 오류는 성공 여부가 불명확하다. **정규화된 제목·본문과 releaseKey가 동일한 파일을 보존**하고 재시도 시 그대로 사용한다. 새 키를 만들거나 내용을 다시 요약해 중복 공지를 만들지 않는다. 자동 재시도하지 말고 사용자의 재시도 요청에 따른다.
- 성공은 게시물 ID와 `replayed`를 보고한다. `replayed: true`는 이미 등록한 동일 게시물의 재응답이며 새 공지를 발행한 것이 아니다.

키 생성·서버 설정과 최초 실제 게시는 별개의 작업이다. 이 스킬을 만들거나 설치했다는 사실만으로 운영 공지를 게시하지 않는다.
