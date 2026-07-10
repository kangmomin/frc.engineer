# Fable max 리뷰(07-08~09 Opus 작업분 22커밋) finding 15건 triage — #1 기각, 14건 수정 채택

- **날짜**: 2026-07-10
- **이슈**: `a7eacb53..HEAD`(mockudp 3커밋 제외) 범위에 대해 Fable 5 max 워크플로우 리뷰(파인더 6앵글
  → 후보 38 → 독립 검증 → 37 유지/1 반박 → 상위 15건 보고)가 결함 15건을 보고. 각 finding의
  채택/기각과 정책성 항목(하위호환 4건)의 방향 결정이 필요했다.
- **결정**: **#1(Electron `cleanupCopiedStrategyAssets`의 storage `data/strategy` 재귀 삭제) 기각,
  나머지 14건 전부 수정 채택.**
- **결정자**: 사용자 ("1은 넘어가고 나머진 수정해줘")
- **근거**: #1은 앱이 배포한 복사 자산의 의도된 마이그레이션 클린업(exe-side 자산이 우선하는 새
  구조에서 stale 사본 제거)으로 판단. 나머지는 실사용자 데이터/세션/표기 정확성에 실질 영향.

## 채택된 정책 결정 (하위호환 4건)

| Finding | 결정 | 구현 |
|---|---|---|
| #2 구버전(v4.40 미만) sender rejoin 차단 | 유예 폴백 | `LEGACY_REJOIN_GRACE`(기본 켜짐, `0`으로 비활성): **빈 토큰 + 드라이버가 이미 끊긴 방**에 한해 rejoin/재사용 허용. 활성 드라이버 방은 여전히 탈취 불가, 잘못된 토큰은 항상 거부. fleet 업데이트 후 grace off 권장 |
| #3 XFF 기본 무시 → 기존 IP 밴 무력화 | 사설 피어 암묵 신뢰 | `ClientIP`: 직접 피어가 loopback/사설/링크로컬이면 forwarded 헤더 신뢰(PaaS 엣지 프록시 복원). 공인 직접 피어는 여전히 무시(H8 유지). **`ipAttributable`(IP 자동밴 기록)은 종전대로 명시 `TRUSTED_PROXY_CIDRS` 필요** — 오귀속 mass-ban 위험 때문에 기록(파괴적)은 명시 설정으로만 |
| #4 sender 루프백 전용 바인드 → LAN 오버레이 단절 | opt-in 복원 | `sender-config.json`의 `"overlayLanBind": true`(기본 false, 재시작 필요)로 전 인터페이스 바인드. SSE CORS 헤더는 복원하지 않음 — LAN 바인드 시 오버레이는 same-origin이라 불필요 |
| #6 LAN 호스트네임 forward target 거부 | 허용 복원 | `isForwardHostAllowed`: IP 리터럴 외 호스트네임은 2s 타임아웃 resolve 후 **모든 결과가 사설 범위일 때만** 허용 (검증은 설정 저장 경로에서만 호출) |

## 기타 채택 수정 (요약)

- #5 strategy.html: threat 렌더를 실제 도달 경로(qualifying 브랜치)에 추가 — `⚠ P{n}` + 베스트랩 델타.
  **race 브랜치의 기존 threat 코드는 의도적으로 유지**(향후 race+threat 대비, 데드코드 지적 재발 시 본 항목 인용).
- #7 RaceArchiveDrawer: `setPlaybackActive(true)`를 `applyReplayFrame()`보다 먼저(2곳) — liveSnapshot/raceMetaStore 오염 방지.
- #8 `formatFuelMargin`: 정확히 0/결측 → '—'(muted). 0이 아닌 ±0.05 미만은 '0.0' 유지.
- #9 strategy_manager: 동일 컴파운드 재장착(tireAge 감소) 감지 시 스틴트 마감 + `ageAtFit` 리셋.
- #10 연료 팀 게이팅: `teamId 255`(무팀 sentinel)는 카운트 무관 팀 아님 처리.
- #11 PENA `Time=255` N/A sentinel → 0 처리(255초 오표기 방지).
- #12 페널티 dedup: 값 동일 + **2초 윈도우 내**일 때만 재방송으로 스킵(같은 랩 실제 중복 페널티 보존).
- #13 `restartICE(peerID, expected pc)`: 실행 시점 identity 재검증 + 실패 정리를 `removePeerIf(pc)`로.
- #14 WS `CheckOrigin` allowlist를 `ALLOWED_PITWALL_ORIGINS`로 통합(`ALLOWED_ORIGINS`는 legacy alias 폴백).
- #15 web threat delta 0(동률) → '—' 중립(Go 오버레이와 정합).
- (기능 감사) 리더보드 `penalty` 컬럼 기본 표시 on, 페널티 팝오버 요약 헤더 개선분 커밋.

## 기각된 대안

- **#1 수정(삭제 가드/백업)**: 사용자 명시 기각 — 의도된 클린업. 재발 시 본 문서 인용 종결.
- **#3의 `ipAttributable` 완화**: 부분 기각(위 표 참조) — 조회는 best-effort, 기록은 명시 설정.
- **#5 race 브랜치 threat 코드 제거**: 기각 — 도달 불가지만 무해하고 향후 확장 대비.

## 수정 내역

- 검증: `go build ./...` + `go test ./...` 전체 통과, web `tsc --noEmit` 클린 + vitest 304/304 통과.
  회귀 테스트 추가: same-compound refit 스틴트, PENA sentinel/dedup 윈도우, teamId 255 게이팅,
  fuel '—' degrade, ClientIP 사설 피어 신뢰.
- 커밋:
  - `cd031d63` 페널티 팝오버 요약 헤더 (기능 감사 잔여분)
  - `1dcc8b22` 리플레이 playbackActive 선행 전환 (#7)
  - `25e77cf3` 리더보드·퀄리 표기 3건 + Pen 기본 표시 (#8/#10/#15)
  - `dff1fa86` 스틴트 refit·PENA sentinel/dedup (#9/#11/#12)
  - `2196cc01` sender 하위호환 + threat 오버레이 배선 (#4/#6/#5)
  - `60dde1b5` 시그널링/서버 하위호환 (#2/#3/#14)
  - `372e0e71` restartICE 레이스 (#13)

## 재발 시 대응

- 후속 리뷰/simplify에서 위 항목(특히 #1 삭제 동작, race 브랜치 threat 데드코드, ipAttributable
  게이팅, legacy rejoin grace의 보안 완화)이 재제기되면 본 문서를 인용하고 종결한다.
