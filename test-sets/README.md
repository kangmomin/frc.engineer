# F1 텔레메트리 테스트 패킷 세트

전체 캡처(40개 디렉토리) 분석 후 선별한 핵심 테스트 세트 4종.
모든 세션: **PacketFormat 2026 / GameYear 25 / v1.22 / 모나코(TrackID 5)**

각 시나리오 폴더에는 메인 캡처 + tail 조각(같은 SessionUID) 디렉토리가 들어 있다.
**SEND(세션 종료)와 final_class.jsonl은 tail 디렉토리에만 존재하므로 리플레이 시 반드시 두 디렉토리를 병합해야 한다.**

## quali-full-session (1.97GB) — 퀄리파잉 표준 세트 ★
- 숏 퀄리파잉, 세션 타이머 1080→0 완전 소진 (유일)
- SSTA→SEND 전체 라이프사이클, 패킷 연속성 99%
- FTLP 4회 베스트랩 갱신 체인(72.835→70.990s), 랩 무효화 페널티(PenaltyType 12), OVTK 179건
- tail(_232617)에 SEND + final_class.jsonl

## quali-final-classification (1.15GB) — 최종 분류/리타이어 세트
- 숏 퀄리파잉, 퀄리 중 리타이어(RTMT) 발생한 유일한 세션
- 최종 분류: 완주 21대(ResultStatus=3) + 리타이어 1대(=7)
- FTLP 3, PENA 1, COLL 1, OVTK 125건
- tail(_231133)에 SEND + final_class.jsonl

## race-clean-start (3.43GB) — 레이스 진행 세트
- 39랩 레이스, 스타트 시퀀스(STLG×5→LGOT→SSTA)부터 리더 12랩까지 15분 무손실
- 22대 풀그리드, OVTK 87, COLL 11
- 미완주(12/39랩에서 중도 종료, CHQF 없음) — 완주 시나리오는 별도 캡처 필요

## race-edge-cases (1.53GB) — 파서 견고성 세트
- 20랩 레이스, 세이프티카(SCAR) 4회, 세션 재시작으로 sessionTime 리셋 3회
- 리타이어 2, 페널티 6, 충돌 4 / 미드세션 캡처 시작(첫 SessionTime 113s)
- 리셋·분할 캡처·DNF 처리 등 엣지 케이스 검증용

## 공통 주의사항
- TotalLaps가 세션 중 변동함(예: 1→5) — 첫 패킷 값을 고정값으로 사용 금지
- 퀄리 세션은 개러지 시간 가속으로 sessionTime과 벽시계가 최대 2배 어긋남 — 타임라인은 sessionTime/frame 기준 처리
- session_history / final_class는 rawHex 미디코딩 상태로 저장됨
- lap_data 배열은 24슬롯 고정, NumActiveCars와 불일치(비활성 슬롯 ResultStatus=0) 필터링 필요

_분석일: 2026-07-07, 캡처일: 2026-06-23~24_
