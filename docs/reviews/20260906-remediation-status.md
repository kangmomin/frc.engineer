# 2026-09-06 감사 후속 수정

대상: `20260906-project-audit.md`의 N01–N15, C01, K01–K07, I01–I04 전체 27건.
사용자 승인: 보고된 모든 이슈 수정. 기존 릴리스는 v4.53.0이며 이번 작업은 수정과 검증 범위다.

## 사전 리뷰와 계획

- 오케스트레이터: 멈춤·음성 종료·응답 유실 → 세션/기록 계약 → 분석/저장 → 화면/리플레이 → 의존성/CI/문서 순으로 수정한다.
- 독립 리뷰어: fresh-context 리뷰 완료. UID 문자열, 입력 경계 초기화, 공식 기록 우선, replay 출처 분리, 비동기 작업 세대, DB 격리를 보완했다.
- 난이도: 세션·비동기·리플레이·의존성/CI는 상, 분석·조회·업로드·문서는 중.
- **Assumptions**: 사전 계획에 명시된 기존 `getBestLap` API 유지와 저장 경로 복구를 적용했다. 그 밖의 제품 정책 추가 없음.
- **Refinement**: 후속 독립 리뷰에서 live/replay epoch 충돌, 선수 전환 trace, Result Only 저장 gate, 일반 Event의 PM 초기화 4건을 보완했고 재검토를 통과했다.

## 항목별 상태

| ID | 수정 대상 | 상태 | 검증 근거 |
|---|---|---|---|
| N01 | 비정상 yaw로 Sender 멈춤 | 회귀 검증 통과 | Inf/NaN/±MaxFloat32 실제 UDP→Processor, telemetry/rtc/analysis race 검사 통과 |
| N02 | Leave ACK 대기 중 마이크 재활성화 | 회귀 검증 통과 | 인터컴 49개 단위 검사, 실제 Chrome RTP Leave 이후 수신 0, 타입 검사 통과 |
| N03 | 불완전 랩의 트랙맵 덮어쓰기 | 회귀 검증 통과 | PM 입력 경로의 UID/트랙/랩 회귀·점프·부분 랩 보호와 정상 완주 저장, telemetry race 통과 |
| N04 | latest API의 전체 replay 반복 전송 | 회귀 검증 통과 | 실제 latest handler memory/disk 24대·240 frame 요약 ≤4KiB, 캐시 갱신, sender race 검사 통과 |
| N05 | 오프라인 랩 유효성 | 회귀 검증 통과 | 무효 80초·유효 90초 및 전체 무효 랩 최고 기록 없음, analysis race 검사 통과 |
| N06 | 완료 랩 sector와 minute 보존 | 회귀 검증 통과 | 70/40/40초 완료 섹터와 legacy alias 처리, analysis race 검사 통과 |
| N07 | 시간 기준 tyre 매칭 | 회귀 검증 통과 | Soft/Soft/Medium, 미래 snapshot 제외, flashback 재관측, analysis race 검사 통과 |
| N08 | replay 세션 메타데이터 복사 | 회귀 검증 통과 | replay 프레임·메타의 600/1080초, UID, mutable metadata 독립 복사, telemetry race 통과 |
| N09 | replay와 live 파생 이력 분리 | 회귀 검증 통과 | 실제 Chrome에서 archive별 prefix·forward seek·동일 랩 rewind·live 복귀, 동일 UID/epoch의 Broadcast 배틀/Pitwall modal 초기화, 지연된 archive 응답의 출처 보존 |
| N10 | qualifying 무효 last lap fallback | 회귀 검증 통과 | 단위 검사와 실제 QualifyingView에서 무효 last lap이 Best Lap으로 승격되지 않음 |
| N11 | qualifying cutoff 목표와 동률 | 회귀 검증 통과 | 실제 22대 Q1 P17→P16 목표·동률 1ms, 20/22/24대 단위 검사와 position 0 처리 |
| N12 | 공식 sector 기록 반영 | 회귀 검증 통과 | 공식 sector validity 독립 비트·minute 검사, 실제 화면에서 임시 20초→공식 30초→공식 없음으로 교정 |
| N13 | qualifying 세션/선수 초기화 | 회귀 검증 통과 | 실제 React에서 Q1→Q2, lap 2→1, player 변경 시 attempt 초기화 |
| N14 | 같은 형식의 새 세션 식별 | 회귀 검증 통과 | 64-bit UID 문자열·빈 새 세션·lap 1→lap 1 grid/history 초기화와 동일 UID 재연결 보존, 19개 store 검사 통과 |
| N15 | 분석 세션 시간순 정렬 | 회귀 검증 통과 | UID 역순·기록 시간순 목록 회귀 검사 통과 |
| C01 | 20/22/24대 qualifying 형식 | 회귀 검증 통과 | 실제 packet formula·관측 roster 20/22/24대, Q2 축소 roster·F2·short·unknown 보수적 처리, Chrome 22대 cutoff |
| K01 | 새 UID의 이전 packet cache | 회귀 검증 통과 | 13종 첫 packet/event 이후 다른 모든 source·ERS cache 초기화 및 첫 TrackMap 뒤 새 history 보존, telemetry race 통과 |
| K02 | 재시작 debrief 관측 값 merge | 회귀 검증 통과 | 출처별 타이어/페널티 merge·관측 0·upload DTO, sender/races race 검사 통과 |
| K03 | 업로드 영구 거절 후 backlog 진행 | 회귀 검증 통과 | 20건 HTTP 400 후 재시작하여 21번째 업로드 및 수동 재시도, sender race 검사 통과 |
| K04 | reliable 응답의 혼잡 시 유실 | 회귀 검증 통과 | 실제 열린 Pion 채널 mutex 경합 응답 수신, 방송 drop 유지, rtc race 검사 통과 |
| K05 | 재시작 replay merge | 회귀 검증 통과 | stable ID 저장·재시작·반복 저장으로 [1000,1500,2000] 보존, races/sender race 검사 통과 |
| K06 | connected 유지 ICE restart 성공 | 회귀 검증 통과 | 실제 Chrome에서 connection/ICE callback 없는 restart 후 answer와 reliable ping으로 복구, 12.5초 뒤 동일 PeerConnection 유지 |
| K07 | replay 취소의 Sender 전파 | 회귀 검증 통과 | 실제 Chrome cancel 메시지·late chunk 무시, peer별 transport/request 취소, 실제 Pion 경합 대기 취소, Sender replay decoder/batch·저장소 정리 |
| I01 | 취약 의존성과 실제 빌드 툴체인 | 패치·로컬 빌드 검증 완료 | Go 1.26.7·Pion·x/*·Electron 44.2.0·builder 26.15.3·Vite 갱신. npm 2개 프로젝트 0건, Go symbol/package 0건. Windows GUI/installer 빌드·ASAR 화면/종료 통과. 미사용 module advisory와 플랫폼 범위는 아래 명시 |
| I02 | DB/browser/Windows/security CI | CI 구성·로컬 검증 완료 | go.mod 기준 toolchain, 별도 PostgreSQL DB 2개와 ban schema, race 직렬 실행, browser/security gate, native Windows 저장·종료·설치·Electron smoke job 추가. actionlint 통과; 원격 CI 실행은 대기 |
| I03 | Delta best lap 영속화 | 회귀 검증 통과 | Australia load·UID→track→lap 순서·invalid/분 단위 sector·callback lock·선수 교체 trace 초기화 검사. Sender 원시 best lap은 saveFiles+Advanced에서만 저장 |
| I04 | 현재 기능 범위 문서 갱신 | 문서 갱신 완료 | 활성 PitWall/Qualifying/Broadcast, Archive replay, Driver Pack 분석, legacy best-lap API와 현재 지원 형식으로 기능 범위 문서 교정 |

## 구현과 최종 컨벤션 검토

- **Key Changes**: 입력 경계에서 세션·선수 identity를 확정하고, 저장·분석의 완료 랩과 관측 출처를 보존했다. 화면은 표시 중인 live/replay 출처를 따르며, 요청 취소와 연결 복구는 해당 peer/request 세대에 연결했다.
- **Layer Analysis**: Presentation은 공식 기록과 표시 출처, Service는 유효한 완료 랩·bounded RTC/음성 수명, Repository는 얕은 조회·재시작 merge·취소 가능한 읽기를 담당한다. 세션 identity는 DTO에서 문자열로 전달한다.
- **Simplicity Check / Style Match**: 기존 helper와 store 구조를 확장하고, latest/replay handler를 테스트 가능한 기존 책임 단위로 분리했다. 기능과 무관한 일괄 스타일 변경은 하지 않았다. `git diff --check`, Web lint/타입 검사, Driver Pack 타입 검사와 CI actionlint 통과.
- **추가 실기동 발견**: Electron 실제 종료에서 `closed` 후 `win.webContents.id` 접근이 `Object has been destroyed`를 발생시켰다. 생성 시 ID를 보관하도록 수정했다. 동일 패키지 smoke가 수정 전 exit 1, 재패키징 후 exit 0을 확인하며 Windows CI에도 포함했다.

## 검증 결과

| 검사 | 결과 |
|---|---|
| 전체 Go | `go test -race -count=1 -p 1 -json ./...`: **646개 test/subtest 통과**, 실패·test skip 0. 테스트가 있는 22개 package 통과, 나머지 11개는 test 파일 없음 |
| DB | 새 전용 PostgreSQL 17 클러스터의 통합 DB·업그레이드 DB 및 ban schema 사용. 공유 DB와 분리 |
| Web | **58개 파일 / 622개 검사 통과**, lint·전체 TypeScript·local/remote build 통과 |
| 실제 Chrome | RTC 재시작·cancel, Archive 비동기 순서·출처, 실제 RTP Leave, 실제 Qualifying/Broadcast/Pitwall 렌더 4개 suite 통과 |
| Driver Pack | **20개 검사**, TypeScript·Vite build 통과 |
| Electron | Windows 산출물의 ASAR main/preload/renderer를 **Linux Electron 44.2.0**에서 실제 로딩하고 정상 quit 확인 |
| 24대 payload | 최대 uint64 UID, 공식 lap history, 64개 예보·21개 marshal zone·차량별 penalty cap 포함. **2,000점 TrackMap 포함 91,674B / steady 35,598B**, 각각 256KiB/128KiB 미만 |
| 의존성 | Web/Driver Pack `npm audit` 모든 심각도 **0건**. govulncheck의 도달 symbol **0건**, import package **0건** |
| 빌드 | Windows amd64 GUI Sender 및 NSIS installer·blockmap·latest.yml 생성. 내장 Sender hash, ASAR main/preload/renderer, manifest size/SHA-512와 package version 일치 |

Vite의 500kB 초과 chunk 안내는 남아 있으며 build 실패는 없다.

Go module 단위에서는 사용하지 않는 `golang.org/x/crypto/openpgp`의 **GO-2026-5932** 1건이 남는다. 수정 버전은 N/A이며 이 프로젝트는 해당 package를 import하거나 호출하지 않는다. 도달성 결과를 전체 module advisory 0건으로 해석하지 않았다. [공식 advisory](https://pkg.go.dev/vuln/GO-2026-5932)

C01은 실제 관측한 표준 20/22/24대와 Modern/F1 26 formula만 적용하며 정보가 없으면 cutoff를 추정하지 않는다. 인원별 탈락 수는 FIA B2.4.2–3, formula 정의는 EA UDP 구조를 대조했다. [FIA 규정](https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_06_-_2026-04-28.pdf), [EA 2026 UDP 명세](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347)

## 산출물과 검증 범위

- [Windows 검증용 installer](../../build/remediation-20260906/electron/Minmo-Driver-Pack-Setup.exe), [Sender](../../build/remediation-20260906/frc-pitwall-sender.exe)
- [검증 로그·독립 리뷰·빌드 hash 증거 묶음](20260906-remediation-evidence.tar.gz)
- [현재 기능 범위](../feature-scope-roadmap.md)

산출물은 **기존 버전 4.53.0의 수정 작업트리로 만든 로컬 검증용**이다. `build/artifacts`의 기존 배포물은 보존했고 새 버전·tag·push·Release는 만들지 않았다. 실행 파일 metadata의 `vcs.modified=true`와 실제 hash를 증거 묶음에 기록했다.

Windows native CI job은 구성했지만 원격 실행 결과는 아직 없다. 이번 환경에서 수행한 것은 Linux의 실제 Chrome/Electron, 실제 Pion, PostgreSQL 검사와 Windows cross-build다. 실제 F1 게임의 장시간 송신, Windows 설치·자동 업데이트 전체 실행, 운영 NAT/TURN 환경은 검증 범위에 포함하지 않는다.

## 정리 상태

검증 로그와 독립 리뷰는 위 증거 묶음으로 보존했다. 임시 PostgreSQL 클러스터·재현 하네스·브라우저/Electron 세션을 종료·정리했고, 생성된 TypeScript build cache는 원래 상태로 되돌렸다. 기존 감사 자료와 사용자 문서는 보존했다. Windows 검증용 산출물은 `build/remediation-20260906`에 유지한다.
