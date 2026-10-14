# RACE 피트아웃 예측 패널 — 균일 피트로스 추정 + 3-시나리오(정직성 정책)

- **날짜**: 2026-07-20
- **이슈**: 사용자가 피트 전략 영역에 "지금 박스하면 누구 앞/뒤로 몇 초에 나오는지, 클린에어/트래픽인지, 그리고 인접 비-피트 드라이버가 함께/직후 피트하는 3가지 시나리오"를 요청. 이 패널은 본질적으로 **예측**이라 anti-fabrication 문화(기존 `StrategyPanel`/`myCar` 선례: "추측 0")와 충돌 소지가 있어, 어디까지가 실필드 유도이고 어디부터가 조작인지 경계 설정에 판단이 필요했다. Codex Architect + Fable Max 2중 리뷰로 수렴.

- **결정**:
  1. **모든 수치는 실필드에서 유도**: `projectedGap = deltaToPlayer − pit_stop_time_lost_s×1000`. 부호 = 음수(내 앞)/양수(내 뒤). pit-loss는 신규 RPC 없이 이미 로드 중인 `getStrategyGuide` 응답(`track.race_strategy.pit_stop_time_lost_s`)에서 취득. 백엔드/DTO 변경 0 → WebRTC 256KB 페이로드 영향 0.
  2. **S3(언더컷) 수치 표기 기각(Codex blocker)**: 가용 입력만으로는 `L−δ`가 *일시적* 손해지 최종 이득이 아니며, 언더컷 실이득은 아웃랩 페이스(미모델)에 의존. → S3는 "You pit first — undercut on fresher tyres; net gain rides on out-lap pace (not modeled)" 정성·방향 표기로 한정(`estimate:false` 플래그로 UI에서 'projection' 배지 표시).
  3. **피트 중(pitStatus>0) 계산 억제(Codex/Fable 합의)**: 그 순간 `deltaToPlayer`엔 피트로스가 일부 반영돼 재차감은 이중계산. → 계산 갭/스페이싱/시나리오 전부 억제하고 **게임 자체 projection(`pitStopRejoinPosition`)만** 표시. 양 리뷰어 모두 "pit-entry 직후 잠깐 유효하지만 박스 결정은 이미 끝났으니 게임값 위임이 안전, un-suppress-early 복잡도 추가 금지"로 명시 권고.
  4. **활성 라이벌만 투영 대상(Fable REVISE #2/#3)**: `threatWatch.ts` 선례 재사용 — `pitStatus===0 && resultStatus∈{2,3} && position>0 && lapDistance>=0`. DNF/개러지 차(결측 갭)를 coverage 홀로 오인해 전 레이스가 "~근사"로 고착되던 문제, 그리고 피트 중 라이벌의 왜곡된 갭이 순위/스페이싱을 오염시키던 문제를 동시 해소.
  5. **"안 멈춘 차" 판정은 `numPitStops===0`(문자적)만**: `tireAge>5` 추론 기각(Codex #4) — 타이어 나이는 피트 여부를 입증하지 못함. 시나리오 pivot = numPitStops===0 최근접 라이벌, 없으면("전후 모두 피트 완료") 시나리오를 억지로 만들지 않고 안내 문구 표시.
  6. **결측 갭 존재 시 정확 순위/스페이싱 억제(Fable #6/coverage)**: 온트랙 라이벌 중 갭 결측(레벨차 omitempty 등)이 있으면 `approximate` 플래그 → "~P" 근사 표기 + CLEAR/TRAFFIC 판정 억제. 게임 projection이 있으면 headline로 우선.
  7. **UI 문구 4종 명시 구분(Codex #5)**: 게임 projection("game") / 균일 피트로스 추정("est.") / 스페이싱 휴리스틱(2.0s) / DRS 근접(1.0s, "실제 DRS 가용"이 아닌 거리). 패널 전체를 "If boxing now" 가정문으로 프레이밍.
  8. **동점 이웃은 `index` 타이브레이크**(플리커 방지, Fable #9). 실시간 갭 지터는 앱 전역(MyCar 델타 등)과 동일하게 자연 표시 — 디바운스 미도입(일관성).

- **결정자**: 사용자(기능 요구) + 합의(Codex Architect REVISE + Fable Max REVISE 2중 리뷰)

- **근거**: 피트아웃 예측은 기존 `derivePitWindow`(pitStopRejoinPosition 사용)와 동류의 정당한 추정이며, 각 수치가 실필드로 추적 가능하고 명시적으로 라벨링되면 anti-fabrication 원칙에 부합. 조작 위험이 실재하는 두 지점(S3 언더컷 이득, 피트 중 이중계산)은 각각 정성화·억제로 차단.

- **기각된 대안**:
  - S3 언더컷 초 단위 수치(결정 2) / 랩타임 델타 누적 시뮬레이션(범위 외·과잉).
  - 신규 백엔드 RPC·DTO 필드(결정 1 — 기존 응답으로 충분).
  - `tireAge` 기반 피트 추론(결정 5).
  - 피트 중 계산 갭 표시(결정 3) 및 "pit-entry 직전까지 un-suppress" 복잡도(양 리뷰어 명시 반대).
  - **피트 중 3-시나리오 강제 노출**: 사용자 원문("피트인 하는 경우엔 바로 열리게")의 literal 요구지만, 그 시점 계산이 부정확(이중계산)해 시나리오 대신 게임 projection을 즉시 노출하는 것으로 충족. (재논의 시 pre-entry 스냅샷 방식이 대안이나 상태 복잡도 큼 — Codex "larger alternative"로 보류.)

- **수정 내역**: `web/src/views/pitwall/derive/pitExit{,.test}.ts`(신규, 테스트 13), `PitExitPanel.tsx`(신규), `PitWallView.tsx`(pitLossMs 파생 + 패널 마운트), `useDisplayPrefs.ts`/`DisplaySettings.tsx`(`pitExit` PanelKey/칩, 기본 표시). 전체 테스트 371개 green, tsc/eslint clean, prod 빌드 성공.

- **재발 시 대응**: "S3에 언더컷 초를 넣자" → 결정 2 인용(Codex blocker). "피트 중에도 계산 갭 보이자" → 결정 3 인용(이중계산·양 리뷰어 합의). "DNF 있으면 왜 근사로 뜨나 / 활성 판정 바꾸자" → 결정 4 인용. "안 멈춘 차를 타이어 나이로 잡자" → 결정 5 인용. "피트 중에 시나리오가 왜 안 열리나" → 기각된 대안 마지막 항목 인용.

## 후속 결정 (2026-10-14) — headline 우선순위 변경

- 결정 6의 "게임 projection이 있으면 headline 우선"을 **뒤집는다**: headline은 표시된 피트로스로 계산한 추정 순위,
  게임 projection은 `game P#` 보조 표기(피트 중에는 기존대로 게임값만). 근거·상세는
  `20260720-pitwall-pit-loss-measured-and-server-avg.md`의 2026-10-14 후속 결정 참고.
