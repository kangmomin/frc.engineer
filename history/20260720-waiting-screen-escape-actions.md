# 대기 화면(Waiting for telemetry stream)에 링크 상태 + 수동 재연결/홈 탈출구 추가

- **날짜**: 2026-07-20
- **이슈**: 일부 기기에서 sender는 online이고 데이터도 송신 중인데 뷰어는 "Waiting for telemetry stream…"에 영구 고착되는 보고. 대기 화면에는 상태 표시도 조작 수단도 없어 사용자가 새로고침 외에 할 수 있는 것이 없었다. 조사 결과 화면상 재현 가능한 고착 경로가 최소 3가지:
  1. **무한 자동 재연결 루프** — 한 번 connected 이력이 있으면 재연결은 무한 재시도인데, AppShell 실패 게이트가 `connectionState !== 'reconnecting'`을 명시 제외하므로 루프 내내 대기 화면만 보인다 (`web/src/shell/AppShell.tsx`).
  2. **half-open P2P** — keepalive ping 미지원 구버전 sender에서는 워치독이 비활성(`pingSeenRef`)이라 죽은 DataChannel을 감지하지 못하고 'connected' 표시로 고착.
  3. **sender가 session 패킷 없이 broadcast** — `HasData()`는 motion만으로 true가 되고 뷰어 게이트는 `!session || drivers.length === 0`이므로, 게임 session 패킷이 파싱되지 않는 환경(예: 미지원 packetFormat은 전부 drop)에서는 데이터가 흘러도 대기 화면 유지.
- **결정**: 근본 원인 1건으로 특정하지 않고(기기 의존·재현 불가), 세 뷰(RACE/QUALI/WORLD FEED)의 waiting 상태에 공통 탈출구를 추가한다 — ① `Link status · <connectionState 라벨>` 표시, ② Reconnect 버튼(=`forceReconnect`, 시그널링+PC 전체 재수립 + 백오프 즉시 건너뜀), ③ Main Screen 버튼(=`onGoHome`, Hub 복귀). 세션 타입 안내용 empty("available during race sessions" 등)에는 붙이지 않는다.
- **결정자**: 사용자(버튼 추가 요청) + 에이전트(상태 라벨 노출, 배치 설계)
- **근거**: 위 3가지 고착 경로 중 1·2는 전체 재수립으로 즉시 복구되고, 3은 홈 복귀로 탈출 가능. 상태 라벨은 "connected인데 데이터 없음"과 "재연결 루프 중"을 현장에서 구분하게 해 이후 원인 특정(`window.__frcP2PDebugLog` 링버퍼 확인)에 필요한 단서를 준다.
- **기각된 대안**: Reconnect를 `handleRemoteConnect`식 스토어 초기화(clearNotifications 등)까지 포함한 하드 리셋으로 구현 — 대기 화면에서는 스토어가 이미 비어 있어 실익 없고, 데이터가 잠깐 끊긴 뷰에서 노티 이력을 날리는 부작용만 있어 기각.
- **수정 내역**: `web/src/shell/TelemetryWaitingActions.tsx`(신규), `web/src/shell/types.ts`(`onReconnect` 추가), `web/src/shell/AppShell.tsx`, 세 뷰 Empty 컴포넌트(`PitWallView`/`BroadcastView`/`QualifyingView`)에 actions 연결.
- **재발 시 대응**: 대기 화면 고착 이슈가 재보고되면 본 문서의 고착 경로 3종을 기준으로 `Link status` 라벨과 `__frcP2PDebugLog`를 먼저 확인. "버튼이 왜 waiting에만 있나"가 재제기되면 본 문서 인용으로 종결.
