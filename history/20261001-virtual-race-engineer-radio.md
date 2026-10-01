# 솔로 드라이버용 가상 레이스 엔지니어 라디오 — 규칙 엔진이 말하고, 결정 모델(Jev·laya)은 "말할지"만 판단

- **날짜**: 2026-10-01
- **이슈**: 사람 엔지니어 없이 혼자 달리는 드라이버가 실시간 정보와 전략 지시를 받을 수단이 없었다. 기존 오버레이는 화면만 보여 주고, 알림 생성기(`Processor.handleEventPacket`)는 페널티·충돌 정도만 만들어 WebRTC 대시보드로만 보냈다. 사용자는 TypeSafe Jev(호스팅 결정 모델)나 laya(오픈소스, Jev 와이어 호환)를 활용하고 싶어 했고, 어디에 어떤 기능으로 넣을지가 쟁점이었다.
- **결정**:
  1. **콜 생성은 Sender 안의 결정론적 규칙 엔진**(`internal/engineer`)이 한다. 입력은 기존 관찰자 훅(`SetPitwallStateObserver`, 팬아웃)과 새 이벤트 관찰자(`SetEventObserver`)뿐이며 `BuildState()`를 직접 호출하지 않는다. 완전 오프라인 동작.
  2. **숫자 판단은 모델에 맡기지 않는다.** 갭·마모·연료·피트 윈도우는 코드가 판정한다. Jev 공식 가이드("계산·규칙·정확 조회는 코드에 남겨라")와 일치한다.
  3. **결정 모델의 자리는 두 곳뿐이다**: (a) 이미 만든 콜을 "지금 말할 가치가 있는가"(noul)로 억제, (b) 드라이버 질문의 의도 분류(choice). 모드는 `off`(기본)·`shadow`(기록만)·`enforce`(비긴급 콜 억제·확신 높은 의도만 적용). 긴급 콜과 드라이버 요청(브리핑·다시 듣기·질문 응답)은 모델을 거치지 않는다. 모델 오류·타임아웃은 항상 규칙대로 말한다(fail open).
  4. **Jev·laya는 같은 클라이언트**(`internal/engineer/decision`)로 지원한다. 엔드포인트 기본 경로 `/v1/systemone`, `Authorization: Bearer`. laya를 Driver Pack에 번들하지 않는다.
  5. **음성은 Electron 렌더러의 Web Speech(Windows SAPI5 음성)**로 낸다. Driver Pack 모드에서 렌더러는 Sender와 수명이 같다. 인터컴에서 누가 말하는 중이면 긴급 콜만 재생한다. 음성은 기본 꺼짐(옵트인).
  6. **화면 출력은 네 번째 네이티브 오버레이 `radio`**(Malgun Gothic, 줄바꿈)와 OBS·브라우저용 `/radio` 페이지(`?voice=1`, `?transparent=1`)를 함께 둔다.
  7. **운전 중 방해 최소화**: 우선순위 큐, 키 쿨다운, 만료(TTL), 발화 길이 기반 간격, 제동·조향 중 비긴급 콜 보류(`PlayerInputs` 접근자). 텔레메트리가 끊기면(일시정지) 보류를 해제한다.
  8. **휠 버튼**: BUTN 이벤트를 파싱해 "UDP Action n" 비트를 브리핑·다시 듣기에 지정할 수 있다(상승 에지만).
  9. **정직성 정책 계승**: 게임 예측은 "게임 예측/게임 기준", Sender 휴리스틱은 "휴리스틱"으로 말한다(`basis` 필드). 상대 피트 판정은 `numPitStops` 증가만 쓴다. 언더컷 이득 수치는 말하지 않는다. 데이터가 없거나 5초 이상 오래되면 모른다고 답한다.
- **결정자**: 합의 (사용자 요청 "전부 구현" + 에이전트 조사·제안)
- **근거**:
  - laya 공개 지연(33ms)은 T4 GPU 값이고 CPU 실측은 0.2~2초다. 기본 체크포인트는 typed-decisions에서 거의 무작위(0.362)라 도메인 파인튠 없이는 판정 품질을 기대할 수 없다. Jev는 미국 호스팅이며 가정 회선 지연이 0.6~2.5초까지 흔들린다. 실시간 콜 경로에 넣으면 타이밍이 깨진다.
  - Sender는 Linux에서 CGO 없이 Windows로 크로스 컴파일한다. ONNX Runtime 바인딩(cgo)이나 Python 사이드카는 빌드·인스톨러(이미 약 121MB, LFS) 부담이 크다.
  - 2026-07-07 Team Radio(합성 대사) 제거와 Spec §9 anti-fabrication, 2026-07-20 피트아웃 예측 결정과 충돌하지 않도록 모든 콜을 실필드로 만든다.
- **기각된 대안**:
  - LLM이 콜 문장을 생성: 지연·환각·비용. 합성 라디오 금지 원칙과 충돌.
  - laya ONNX를 Sender에 내장: CGO 금지 빌드, Windows 미지원 Go 바인딩, 모델 325~581MB.
  - Go에서 SAPI COM 직접 호출: unsafe vtable 코드가 길고 테스트 불가. 렌더러 Web Speech가 같은 음성을 쓴다.
  - 인터컴 SFU에 봇 엔지니어로 참가: 온라인 전용, 역할·할당 변경 필요. 후속 과제로 남김.
  - `/api/overlay/apply`·프리셋·핫키에 `radio`를 일반 bool로 추가: 구버전 클라이언트·저장된 프리셋이 키 누락으로 라디오 오버레이를 닫는다. 포인터(누락=유지)로 결정.
- **수정 내역**:
  - 새 패키지 `internal/engineer`(규칙·큐·브리핑·질문·결정 브리지), `internal/engineer/decision`(Jev 와이어 클라이언트, 루프백·사설망 기본 허용, 원격은 `allowRemote`+HTTPS, 리다이렉트 금지, 키 미반환).
  - `internal/packets/event.go`: BUTN 파싱(`ButtonsEvent`, `UDPActionMask`). `internal/telemetry`: `SetEventObserver`, `PitwallManager.PlayerInputs`.
  - `cmd/sender`: `/api/radio/{stream,settings,recent,decisions,briefing,repeat,test,ask,toggle}`, `/radio` 페이지, `radio` 오버레이 종류, `senderConfig.engineer` 영속화, 결정 기록 `logs/engineer-decisions.jsonl`(5MB 회전).
  - `apps/setup-manager`: Engineer 섹션(`EngineerRadioPanel`), 음성 훅(`useEngineerRadio`, `RadioVoiceQueue`), 오버레이 4번째 타일·핫키 Alt+Shift+4, `backgroundThrottling: false`.
  - 부수 버그 수정: `strategy_evidence.go`가 충돌·페널티 이벤트를 값 타입으로 단언해 incident/penalty 플래그가 켜지지 않던 문제(파서는 포인터 저장). 회귀 테스트 추가.
  - CI 네이티브 Windows 테스트 대상에 `./internal/engineer/...` 추가.
- **남은 범위(미구현)**:
  - 음성 질문 입력(STT): Electron의 Web Speech 인식은 Google API 키가 필요하고, 오프라인 Windows 음성 인식은 네이티브 코드가 필요하다. 현재는 텍스트 질문 + 휠 버튼 브리핑으로 대체한다.
  - 사람 엔지니어의 지시 카드·확인(C16), 인터컴 봇 엔지니어.
  - laya 레이스 도메인 파인튠 데이터셋. 섀도 모드 JSONL 기록이 그 원천이 된다.
- **재발 시 대응**: "모델이 직접 전략 수치를 판단/생성하자" 또는 "라디오 문장을 LLM으로 만들자"는 제안이 재제기되면 본 문서와 `20260720-pitwall-pit-exit-projection.md`를 인용하고 종결한다. 결정 모델 범위 확대는 섀도 기록으로 불일치율·지연을 먼저 측정한 뒤 별도 결정으로 다룬다.
