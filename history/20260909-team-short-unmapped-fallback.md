# 미매핑 team ID를 `—`로 가리지 않고 `T{id}`로 노출한다

- **날짜**: 2026-09-09
- **이슈**: 사용자가 라이브(F1 26 / 2026 Season Pack)에서 **팀 배지가 전부 `—`로 나온다**고 보고.
  `getTeamShort()`는 `TEAM_SHORT`(키: `0–10 / 255 / 476–486`)에 없는 ID를 전부 `—`로 접어버려,
  **게임이 실제로 어떤 ID를 보내는지 알 방법이 화면에 없었다.**
  게임 UDP → 화면까지 전 구간을 정적 분석해 원인 후보를 좁혔다:
  파싱(`internal/packets/participants.go:86-99`), DTO(`internal/dto/pitwall.go:103`, `omitempty` 없음),
  msgpack 송신(`internal/rtc/broadcaster.go:49-142`, 키 축약·델타 없음),
  수신 디코드(`web/src/hooks/useWebRTCDataChannel.ts:183`), 라우터(`useMessageRouter.ts:76-78`),
  스토어(`telemetryStore.ts:109-115`), 뷰(`PitWallView.tsx:45,52,99`) — **전 구간 무가공 전달**.
  또 `test-sets/` 녹화 8세션(PacketFormat 2026)의 참가자 팀 ID를 전수 집계하니 `476~486`뿐이고 전부 매핑됐다.
  → 레포의 어떤 데이터로도 재현되지 않으며, 남은 원인은 "게임이 매핑 밖 ID를 보낸다" 하나다.
- **결정**: `getTeamShort`의 미매핑 폴백을 `—` → `` `T${teamId}` ``로 바꾼다.
  단 `255`(게임의 무팀 센티넬)는 `—`를 유지하고, 값이 없는 경우(`undefined`/`NaN`)는
  `Number.isFinite` 가드로 `—`에 떨군다.
- **결정자**: 에이전트
- **근거**:
  - 진단 가능성이 표시 미관보다 우선한다. 값을 삼키는 폴백은 같은 문제를 다음에도 재현 불가로 만든다.
  - `web/src/hub/screens/analysisPlayback.ts:108-115`의 `teamIdentity()`가 이미 미매핑 ID를
    `Team #${id}`로 노출한다 — 새 컨벤션이 아니라 기존 방침을 pitwall에 맞추는 것.
  - `Number.isFinite` 가드가 없으면 값 결측 시 `Tundefined`가 렌더된다. 가드는 `teamId: 0`(Mercedes)을
    falsy로 버리지 않는다.
  - 부수 효과로 **화면이 원인을 구분해준다**: `T512`가 보이면 미매핑 ID, `—`가 지속되면 무팀 센티넬.
- **기각된 대안**: 실제 F1 26 ID 대역을 추측해 미리 매핑에 채워 넣기 →
  관측 근거가 없다. 실측값 확보 후 `TEAM_COLORS`/`TEAM_SHORT`/`TEAM_NAMES` 세 테이블에
  **키 집합을 동일하게** 유지하며 추가하고, 기존 476–486은 하위호환으로 병존시킨다.
- **수정 내역**: `web/src/constants/teamColors.ts`(`getTeamShort`),
  `web/src/constants/teamColors.test.ts`(`expect(getTeamShort(9999)).toBe('—')` → `'T9999'`, 경계 케이스 추가).
  커밋 `8044067c`. 후속 매핑 추가는 아래 섹션 참조.
- **재발 시 대응**: "미매핑도 그냥 `—`로 두자"가 재제기되면 본 문서를 인용하여 종결한다.

---

## 후속: 실측된 team ID 11(Cadillac) 매핑 추가 (2026-09-10)

- **이슈**: `T{id}` 노출 후 사용자가 라이브(F1 26)에서 **team 11 = Cadillac**을 확인해 전달했다.
  본 결정이 노린 대로, 값을 드러내자 원인이 한 번에 특정됐다.
- **결정**: 관측된 `11`만 `TEAM_COLORS`/`TEAM_SHORT`/`TEAM_NAMES`/`TEAM_KEYS` 네 테이블에 추가한다.
  색은 같은 팀인 2026 팩 `486`과 동일한 `#c8a25f`.
- **결정자**: 사용자 (실측값 제공) + 에이전트 (반영 범위)
- **근거**: F1 26이 F1 25 대역(0–10)을 그대로 쓰고 Cadillac만 11로 덧붙인 형태다.
  기존 476–486은 녹화본으로 검증된 값이라 삭제하지 않고 병존시킨다.
- **기각된 대안**: 12~20 등 인접 ID를 미리 채워두기 → 관측 근거가 없다.
  본 문서의 원 결정("추측 매핑 금지")을 그대로 적용한다. 다른 미매핑 ID가 나타나면 `T{id}`로 드러난다.
- **수정 내역**: `web/src/constants/teamColors.ts`(네 테이블 + 대역 주석), `web/src/ui/TeamLogo.tsx`(주석),
  `web/src/constants/teamColors.test.ts`. **`TEAM_COLORS`의 키 집합이 `TEAM_NAMES`와 같은지 검사하는
  테스트를 새로 추가**했다 — 한 테이블을 빠뜨리면 색만 회색으로 남는 식으로 조용히 어긋나기 때문이다.
- **재발 시 대응**: 새 team ID는 반드시 네 테이블에 함께 넣는다. 키 집합 테스트가 누락을 잡는다.
