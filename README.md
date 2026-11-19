# frc.engineer

**F1 25 / F1 26(2026 Season Pack) 심레이싱용 레이스 엔지니어링 플랫폼.**

게임이 내보내는 UDP 텔레메트리를 드라이버 PC에서 받아 해석하고, WebRTC로 원격 피트월·중계 화면에 실시간으로 보냅니다.
레이스가 끝나면 기록을 저장하고 리플레이, 분석, 랭킹, 전략 자료로 다시 씁니다.

```
 F1 25 / F1 26 (게임)
        │  UDP :20777
        ▼
 Minmo Driver Pack (드라이버 PC)
   ├─ Pitwall Sender (Go)        ── 수신·파싱·기록·방송
   └─ Setup Manager (Electron)   ── 상태·오버레이·인터컴·엔지니어 라디오
        │
        ├── WebRTC DataChannel ──▶  Web Dashboard (Pit Wall / Qualifying / Broadcast / Replay)
        │      ▲
        │      └─ 연결 중개: Signaling Server (cmd/signaling)
        │
        └── 레이스 기록 업로드 ──▶  Pitwall Cloud (cmd/platform + PostgreSQL)
                                     └─ PitHub 웹: 랭킹 · 레이스 분석 · 셋업/전략 · RBAC
```

---

## 주요 기능

### 실시간 텔레메트리 (Web Dashboard)
- **Pit Wall** — 실시간 리더보드, 드라이버별 상세·랩 이력, ERS·연료·타이어·전략, 트랙 위치, 피트 아웃 예상 위치와 주요 알림
- **Qualifying** — 공식 최고 랩·섹터, 주행 시도 상태, 트랙 갭, 참가 규모(20/22/24대)에 맞춘 컷오프
- **Broadcast** — 중계용 순위·레이스 상태, 시작 그리드 대비 순위 변화
- **Race Archive / Replay** — 저장된 레이스 목록·요약, 타임라인 탐색·배속 재생 (로컬 HTTP 또는 원격 P2P)
- **Intercom** — 드라이버와 피트월 사이 음성 인터컴

### Minmo Driver Pack (드라이버 PC용 Windows 앱)
- **Pitwall Sender** — UDP 수신·파싱, WebRTC 방송, 레이스 기록·리플레이 저장, 오버레이, 로컬 설정 API, 시스템 트레이 상주
- **Setup Manager UI** — Sender 상태·라이브 텔레메트리·룸 공유, 오버레이, 인터컴, 엔지니어 설정
- **가상 엔지니어 라디오** — 피트 윈도우·연료·타이어·손상·SC·페널티·앞뒤 차·날씨 콜을 우선순위 규칙에 따라 음성/텍스트로 안내. 휠 버튼 브리핑, OBS용 `/radio` 페이지 제공 ([docs/api/engineer-radio.md](docs/api/engineer-radio.md))
- 자동 업데이트(electron-updater), UDP 포트 점유 시 자동 재바인드, 크래시 시 자동 재시작

### PitHub (웹 허브 · Pitwall Cloud)
- Steam 계정 로그인과 드라이버 프로필
- 레이스 분석 리포트·사고(인시던트) 리플레이·분석 공유 링크
- 랭킹·리더보드 기록 ([docs/api/leaderboard-records.md](docs/api/leaderboard-records.md))
- 셋업·전략 마켓, 전략 랩(Strategy Lab) ([docs/api/strategy-lab.md](docs/api/strategy-lab.md))
- 피드백 수신함, 업데이트 로그, 역할 기반 권한(RBAC)·관리자 화면

---

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 백엔드 | Go 1.26, [pion/webrtc](https://github.com/pion/webrtc), gorilla/websocket, pgx(PostgreSQL), msgpack |
| UDP 파서 | [`kangmomin/f1-25-parser`](https://github.com/kangmomin/f1-25-parser) (Go) |
| 웹 프론트엔드 | React 18, TypeScript, Vite, Zustand, Vitest |
| 데스크톱 앱 | Electron, electron-builder(NSIS), electron-updater |
| 인프라 | Docker(signaling/platform), Vercel(정적 웹), GitHub Actions CI |

---

## 저장소 구조

| 경로 | 설명 |
|---|---|
| `cmd/sender` | **Pitwall Sender** — 드라이버 PC에서 실행되는 텔레메트리 수신·방송 프로그램 |
| `cmd/server` | 로컬 모드 서버 — UDP 수신 + 웹 대시보드 임베드(`go:embed`) 단일 바이너리 |
| `cmd/signaling` | WebRTC 시그널링 서버 (룸, TURN 자격 증명, 닉네임/IP 차단 목록) |
| `cmd/platform` | Pitwall Cloud 백엔드 (계정, 랭킹, 분석, 마켓, RBAC) |
| `cmd/mockudp` | F1 25/26 UDP 패킷 시뮬레이터 (게임 없이 개발·테스트용) |
| `cmd/wsclient` | WebSocket 디버그 클라이언트 |
| `cmd/strategy-normalize` | 전략 원본 데이터 정규화 도구 |
| `internal/` | 패킷 파싱, 텔레메트리 처리, 레이스 저장, RTC, 엔지니어 라디오, 분석, 전략, RBAC 등 핵심 로직 |
| `web/` | 웹 대시보드 + PitHub (React) |
| `apps/setup-manager/` | Minmo Driver Pack Electron 앱 |
| `data/` | 트랙 레이아웃·코너, 전략, 셋업, 타이어 온도 등 정적 데이터 |
| `docs/` | API 문서, 텔레메트리 구조, 리뷰·연구 자료, 레이스 분석 리포트 |
| `history/` | 설계 결정 기록 ([history/README.md](history/README.md)) |

---

## 빠르게 시작하기

### 요구 사항
- Go 1.26+
- Node.js 22+ / npm
- (선택) PostgreSQL 17 — `cmd/platform` 실행 및 DB 통합 테스트용
- (선택) F1 25 또는 F1 26 — 없으면 `cmd/mockudp`로 대체

### 1. 로컬 모드 (단일 바이너리)

웹 빌드를 임베드한 서버를 실행하고, 게임 텔레메트리를 `20777` 포트로 받습니다.

```bash
make run
```

> 게임 설정에서 UDP Telemetry를 켜고 포트를 `20777`, 형식을 해당 시즌(2025/2026)으로 맞춥니다.
> 포트 등 런타임 설정은 루트의 `config.json`에 저장됩니다.

### 2. 개발 모드 (백엔드 + Vite 개발 서버)

```bash
go build -o frc-engineer ./cmd/server && ./frc-engineer
```

```bash
cd web && npm install && npm run dev
```

브라우저에서 `http://localhost:3000` 을 엽니다. Windows에서는 `start.bat` 한 번으로 백엔드·프론트엔드를 함께 띄울 수 있습니다.

### 3. 게임 없이 테스트

```bash
go run ./cmd/mockudp
```

### 4. 원격 모드 구성 요소

```bash
make build-sender
```

```bash
make build-signaling
```

```bash
make build-remote SIGNALING_URL=wss://<your-signaling-host>/ws
```

### 5. Driver Pack 개발 실행

```bash
cd apps/setup-manager && npm install && npm run dev
```

---

## 환경 변수 (주요)

| 변수 | 대상 | 설명 |
|---|---|---|
| `SIGNALING_URL` | sender | 시그널링 서버 WebSocket 주소 |
| `SENDER_ROOM_NAME` / `SENDER_ROOM_PASSWORD` | sender | 기본 룸 이름 / 비밀번호 |
| `SETTINGS_PORT` | sender | 로컬 설정 API 포트 (기본 `8099`) |
| `FRC_STORAGE_DIR` | sender | 레이스 기록 저장 경로 |
| `PORT` / `SIGNALING_PORT` | signaling | 리스닝 포트 (기본 `9090`) |
| `PORT` | platform | 리스닝 포트 (기본 `8090`) |
| `DATABASE_URL` | signaling, platform | PostgreSQL 접속 문자열 (platform은 필수, signaling은 선택) |
| `ALLOWED_ORIGINS` | signaling, platform | CORS 허용 Origin 목록 |
| `STEAM_API_KEY` | platform | Steam 로그인 연동 키 |
| `WEBRTC_ICE_SERVERS` | signaling | ICE/TURN 서버 설정 |

---

## 테스트

```bash
go test -race ./...
```

```bash
cd web && npm run lint && npm test
```

```bash
cd apps/setup-manager && npm test && npm run typecheck
```

> DB 통합 테스트는 `TEST_DATABASE_URL`, `PLATFORM_TEST_DATABASE_URL` 이 설정된 경우에만 실행됩니다.
> CI(`.github/workflows/ci.yml`)는 PostgreSQL 통합 테스트, Chrome WebRTC 브라우저 테스트, govulncheck·npm audit, Windows 인스톨러 빌드·스모크 테스트를 수행합니다.

---

## 배포

| 산출물 | 소스 | 배포처 |
|---|---|---|
| Minmo Driver Pack 인스톨러 | `apps/setup-manager/` + `cmd/sender` | [`kangmomin/frc.engineer-deploy`](https://github.com/kangmomin/frc.engineer-deploy) GitHub Releases |
| 시그널링 / 플랫폼 서버 | `cmd/signaling`, `cmd/platform` (Dockerfile 포함) | 컨테이너 호스팅 |
| 원격 웹 대시보드 | `web/` (`npm run build:remote`) | 정적 호스팅 (Vercel) |

릴리스 버전의 기준은 `apps/setup-manager/package.json`의 `version` 입니다.
전체 배포 절차는 [CLAUDE.md](CLAUDE.md)의 **Deploy Checklist**를 따릅니다.

> WebRTC DataChannel 페이로드를 늘리는 변경은 Chrome SCTP 수신 버퍼(256KB) 한도 안에 드는지 확인해야 합니다. F1 26은 24대 기준으로 계산합니다.

---

## 참고 문서

- [텔레메트리 데이터 구조](docs/telemetry-data-structure.md)
- [기능 범위와 로드맵](docs/feature-scope-roadmap.md)
- [API 문서](docs/api/) — 엔지니어 라디오, 랩 트레이스, 리더보드 기록, 전략 랩
- [F1 25 UDP 사양](docs/Data%20Output%20from%20F1%2025%20v3.pdf)
- [설계 결정 기록](history/)
