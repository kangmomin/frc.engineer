# Pit Exit 온트랙 라이벌 필터를 화이트리스트(resultStatus=2/3)→블랙리스트로 완화

- **날짜**: 2026-07-21
- **이슈**: Pit Exit 패널이 실환경에서 상시 "Pit-loss data unavailable"(투영 가능한 온트랙
  라이벌 0)로 떴다. 강화한 콘솔 진단(`pitExitUnavailableReason`)의 조건별 분해가 원인을 지목:
  ```
  투영 가능한 온트랙 라이벌 없음 (총 22대, 나 제외 21대 · 핏중 0 · 트랙밖(lapDist<0) 0 ·
    비활성(resultStatus≠2,3) 21 · 순위없음 0 · 통과 0 · 갭결측 0 · withGap 0)
  ```
  → 나 제외 21대 **전원**이 핏 아님·트랙 위·순위 보유인데 오직 `resultStatus ∈ {2,3}`
  화이트리스트에서만 탈락. 즉 `isRacingRival`의 resultStatus 게이팅이 전 그리드를 오탈락시켰다.
- **근본 원인**: sender는 `resultStatus`를 전달하지만(FABLE 확인, pitwall_manager.go:634),
  실측상 **온트랙 레이싱 차가 resultStatus=0(미보고, omitempty)/1(inactive)로 오는 세션이 있다**.
  기존 코드는 "active(2)/finished(3)만 레이싱 중"이라 가정했으나 이 가정이 세션 의존적이라 깨졌다.
- **결정**: resultStatus 판정을 **화이트리스트(2/3만 통과) → 블랙리스트(명시적 아웃 상태만 제외)**로
  전환한다. 온트랙 여부는 물리 신호(`pitStatus===0` && `lapDistance>=0` && `position>0`)로
  판정하고, resultStatus는 **DNF(4)/DSQ(5)/NC(6)/retired(7)** 만 제외한다. 0/1/2/3은 포함.
  갭 부재는 하류 `withGap` 필터가 이미 거르므로 이중 안전.
- **결정자**: 사용자 (라이브 진단 로그 제공) + 에이전트 (원인 분석/설계)
- **근거**:
  - 진단 로그가 물리 조건(핏/트랙/순위) 전부 통과·resultStatus 단독 탈락임을 수치로 증명 → 필터
    완화의 blast radius가 "레이싱 중인데 status만 0인 차 재포함"으로 명확히 한정됨.
  - out-of-race(4~7) 차는 여전히 제외되어 "다들 유지" 가정을 깨는 유령 라이벌은 안 생긴다.
  - `out-of-race` 판정을 `isDriverOutOfRace(resultStatus)` 헬퍼로 추출해 필터와 진단 카운터가
    **동일 기준**을 공유하도록 함(진단 라벨과 실제 필터가 어긋나 오판하는 회귀 방지).
- **기각된 대안**:
  - resultStatus 조건 완전 제거 — DNF/은퇴 차의 stale deltaToPlayer가 투영을 오염시킬 수 있어
    기각. 블랙리스트로 아웃 상태만 배제하는 게 최소 변경이면서 안전.
- **수정 내역**:
  - `derive/pitExit.ts`: `isDriverOutOfRace()` 헬퍼 신설(4/5/6/7). `isRacingRival`의
    `(rs===2||rs===3)` → `!isDriverOutOfRace(rs)`. 진단 breakdown의 `notActive`→`outOfRace`
    카운터 + 라벨 "비활성(resultStatus≠2,3)"→"아웃(DNF/DSQ/NC/retired)"로 동기화. 주석 정정.
  - `derive/pitExit.test.ts`: resultStatus=0 온트랙 차 **포함** 테스트 + 아웃 상태(4/5/6/7)
    **제외** 테스트 추가.
- **재발 시 대응**: "resultStatus 화이트리스트가 더 안전하지 않나 / 2·3만 레이싱 중" 재제기 시
  본 문서 인용(실측 세션이 온트랙 차를 0/1로 보내므로 화이트리스트는 전 그리드 오탈락 —
  물리 신호 판정 + 아웃 상태만 블랙리스트가 검증된 결론).
