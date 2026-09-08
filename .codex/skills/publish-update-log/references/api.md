# 업데이트 로그 자동화 API

## 키 설정

1. 저장소 밖의 비공개 경로에 새 키 파일을 만든다. 상위 디렉터리는 미리 생성한다.

   ```bash
   python3 <스킬 디렉터리>/scripts/publish_update_log.py generate-key \
     --out <비공개 디렉터리>/update-log.key
   ```

   원본은 파일에만 저장되며 POSIX 파일 권한은 `0600`이다. 기존 파일·심볼릭 링크는 덮어쓰지 않는다. Windows에서는 해당 사용자만 읽을 수 있도록 디렉터리 ACL을 설정한다. 출력되는 `PLATFORM_UPDATE_LOG_API_KEY_SHA256=<64자리 hex>`는 서버에 설정할 해시다.

2. 플랫폼 서버(`cmd/platform`)의 비밀 환경변수에 출력한 `PLATFORM_UPDATE_LOG_API_KEY_SHA256`을 설정하고 서버를 재시작한다. 이 값이 없으면 자동화 API는 404로 비활성화된다. 형식이 잘못되면 서버 시작이 실패한다. 원본 키는 서버 설정에 필요하지 않다.
3. 실행 도구에는 `--key-file`로 원본 파일 경로를 지정하거나 `PLATFORM_UPDATE_LOG_API_KEY`를 비밀 환경변수로 주입한다. 원본 키를 프런트엔드 `VITE_*` 변수, Git, 프롬프트, URL에 넣지 않는다.
4. 서버 주소는 플랫폼 백엔드의 최종 HTTPS 기본 URL이다. 웹 프런트엔드 주소와 다르다. `--base-url` 또는 `PLATFORM_URL`로 설정한다. 스크립트는 리다이렉트와 환경 프록시를 사용하지 않는다.

키 교체는 새 파일 생성 → 서버 해시 교체·재시작 → 호출 도구에 새 파일 지정 순서로 한다. 기존 키는 서버 해시 교체 후 사용할 수 없다. 다중 서버는 모두 같은 해시로 반영해야 한다.

## 프록시와 요청 제한

- 기본 IP는 실제 연결의 `RemoteAddr`다. `X-Forwarded-For`는 `PLATFORM_UPDATE_LOG_TRUSTED_PROXY_CIDRS`에 명시한 프록시에서 온 요청에만 사용한다. 값은 쉼표로 구분한 CIDR이다. 실제 배포 프록시의 대역만 지정하고 인터넷 전체 대역을 신뢰하지 않는다.
- 프록시 뒤에서 이 설정을 생략하면 모든 호출이 프록시 IP 제한을 공유한다. 배포 사업자가 보장하는 프록시 주소와 헤더 덮어쓰기 정책을 확인해 설정한다. 직접 접속에서는 생략한다.
- IP별 최근 10분에 인증 실패 5회까지 기록하고, 이후 요청은 가장 오래된 실패가 만료될 때까지 429로 거부한다. 키가 맞아도 해당 IP가 제한 중이면 거부된다. 차단 중 요청은 실패 시각을 연장하지 않는다.
- IP별 전체 요청은 분당 30회, 유효 키 요청은 전체 서버 합산 분당 10회다. 유효 키 제한에는 검증 오류와 동일 요청 재시도도 포함한다. 분당 제한은 고정된 분 단위 창이며 경계에서 두 창의 요청이 인접할 수 있다.
- 잘못된 키 요청은 유효 키의 전역 게시 한도를 소비하지 않는다. 키 자체를 인증 실패로 영구 잠그지 않는다.
- 실패는 실제 시각으로 DB의 기존 `platform.rate_limits`에 기록한다. 서버 재시작·복제본 간에 공유하며 DB 장애 시 게시를 허용하지 않는다. 기존 1시간 보존 정리 작업을 사용한다.
- 키는 32바이트 난수여야 한다. IP 제한은 분산된 대량 트래픽 전체를 막는 장치가 아니므로 인프라의 요청량 제한과 함께 운용한다.

## 요청·응답

```http
POST /automation/update-logs
Authorization: Bearer <원본 키>
Content-Type: application/json
```

```json
{
  "releaseKey": "commit:0123456789abcdef0123456789abcdef01234567",
  "title": "업데이트 로그와 새 소식 알림",
  "body": "업데이트 내역을 한곳에서 확인할 수 있습니다.\n새 소식은 접속할 때 한 번 알려드립니다."
}
```

`releaseKey`는 영문·숫자로 시작하고 영문·숫자·`._:/-`만 포함하는 1~128자 문자열이다. 제목·본문의 앞뒤 Unicode 공백은 제거한다. 제목 1~120자, 본문 1~10,000자이고 JSON 요청 크기는 128 KiB 이하이다. 제목은 탭, 본문은 탭·CR·LF 외 제어 문자를 허용하지 않는다.

| 상태 | 의미 |
|---|---|
| 201 | 새 게시물 등록. `{"entry":{"id":"…","title":"…","body":"…","publishedAt":"…"},"replayed":false}` |
| 200 | 같은 releaseKey와 정규화된 내용의 재호출. 기존 게시물을 반환하고 `replayed:true`. 새 ID·알림 없음 |
| 400 | 필드·본문·releaseKey·쿼리 파라미터 등이 잘못됨 |
| 401 | 키 누락·오류. 반복 시도 중단 |
| 404 | 서버에서 자동화 비활성화 또는 주소·버전 불일치 |
| 409 | 같은 releaseKey로 다른 내용을 보냄. 기존 글 변경 없음 |
| 429 | 요청 제한. `Retry-After`에 대기 초 |
| 500 | DB 등 서버 오류. 성공 여부 확인 후 동일 요청으로 재시도 |

API는 새 로그 등록 권한만 제공한다. 회원 조회·열람 상태 변경·다른 관리 API에는 이 키를 사용할 수 없다. 수동 운영자 UI 등록은 기존 Steam/RBAC 인증을 유지한다. `015_update_log_automation.sql`은 `update_logs.release_key`만 추가하며 별도 API 키·열람 이력 테이블은 만들지 않는다.

## 스크립트 사용

```bash
# 키 없이 요청 검증·미리보기
python3 <스킬 디렉터리>/scripts/publish_update_log.py publish \
  --payload /tmp/update-log.json --dry-run

# 한 번 게시: 원본 키를 명령행 값으로 전달하지 않음
python3 <스킬 디렉터리>/scripts/publish_update_log.py publish \
  --base-url https://<플랫폼 서버> \
  --key-file <비공개 디렉터리>/update-log.key \
  --payload /tmp/update-log.json
```

환경에서 `PLATFORM_URL`, `PLATFORM_UPDATE_LOG_API_KEY`를 주입한 경우 `publish --payload …`만 실행한다. `--payload -`는 표준 입력을 읽는다. 성공 출력은 ID·발행 시각·재호출 여부만 포함한다. 실패는 종료 코드 1이며 자동 재시도하지 않는다. 요청 파일은 성공 확인까지 유지한다.

로컬 테스트에는 임시 키·별도 DB와 `--base-url http://127.0.0.1:<port> --allow-local-http`를 사용한다. 이 옵션은 숫자 loopback IP만 허용하며 외부 HTTP 서버나 `localhost` 이름은 허용하지 않는다.
