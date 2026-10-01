# 가상 엔지니어 라디오

솔로 드라이버를 위한 엔지니어 라디오다. Sender가 실시간 텔레메트리로 짧은 라디오 콜을 만들고, Driver Pack이 Windows 음성으로 읽으며, 오버레이와 OBS 페이지가 같은 콜을 보여 준다. 핵심 경로는 완전 오프라인으로 동작한다. 결정 배경은 [history/20261001-virtual-race-engineer-radio.md](../../history/20261001-virtual-race-engineer-radio.md)에 있다.

## 흐름

```mermaid
flowchart LR
    UDP[게임 UDP] --> Proc[Processor]
    Proc -- 2~4Hz PitwallState --> Eng[internal/engineer 규칙 엔진]
    Proc -- 이벤트 BUTN·SCAR·RDFL·DRSE·RTMT·FLBK --> Eng
    PM[PitwallManager.PlayerInputs] -- 제동·조향 --> Eng
    Eng --> Q[우선순위 큐: 쿨다운·만료·간격·제동 보류]
    Q -- SSE /api/radio/stream --> DP[Driver Pack 음성]
    Q --> OV[radio 네이티브 오버레이]
    Q -- SSE --> OBS[/radio 페이지]
    Eng -. 선택: shadow/enforce .-> DM[Jev 또는 laya-serve]
```

## 콜 종류

| 분류 | 조건 | 우선순위 | 근거 표기 |
|---|---|---|---|
| 피트 윈도우 | 게임 이상 랩 직전·윈도우 진입·마지막 랩 (레이스) | 보통·높음 | 게임 값, 복귀 순위는 "게임 예측" |
| 연료 | MFD 여유가 -0.3랩 이하, -1.0랩 이하, +0.1랩 회복 | 높음·긴급·정보 | 게임 값 |
| 타이어 | 최대 마모가 경고값(기본 60%), 경고값+15% (스틴트당 1회) | 보통·높음 | 측정 |
| 손상 | 부위가 20% 이상이면서 한 번에 10%p 이상 증가, DRS·ERS 고장 | 높음 | 측정 |
| 레이스 컨트롤 | SC·VSC 출동·복귀·그린, 레드 플래그, 페널티·경고 증가, 미이행 페널티, 파이널 랩 | 긴급~보통 | 게임 값 |
| 앞뒤차 | 바로 앞뒤 차의 `numPitStops` 증가, 리타이어, 1초 이내 접근(1.5초에 재무장) | 보통·정보 | 게임 값·측정 |
| 날씨 | 현재 날씨 변화, 15분 내 강수 확률 50% 이상 예보 | 보통·높음 | 게임 값 |
| 전략 | 전략 오버레이의 언더컷·오버컷 VIABLE 전환 | 보통 | 휴리스틱 |
| 랩 브리핑 | 매 랩 결승선 (기본 꺼짐) | 보통 | 측정 |

세션의 첫 스냅샷은 기준점으로만 쓰고 말하지 않는다. 플래시백으로 랩이 줄면 그 프레임은 침묵하고 대기 중인 콜을 비운다. 같은 콜은 반복하지 않는다.

## 전달 규칙

- 긴급 콜은 즉시 나간다. 그 외 콜은 이전 발화가 끝날 시간(한국어 초당 7자, 영어 15자 추정 + 0.8초)을 기다린다.
- `brakeGate`가 켜져 있으면 브레이크 0.15 초과 또는 시속 60km 이상에서 조향 0.25 초과일 때 비긴급 콜을 보류한다. 텔레메트리가 5초 이상 끊기면 보류하지 않는다.
- 만료: 긴급 15초, 높음 30초, 보통 20초, 정보 15초. 늦은 콜은 말하지 않는다.
- Driver Pack 음성은 인터컴에서 누가 말하거나 PTT 중이면 긴급 콜만 재생한다.

## 결정 모델 (선택)

| 모드 | 동작 |
|---|---|
| `off` | 기본값. 모델 호출 없음 |
| `shadow` | 나간 콜과 질문에 대해 모델을 호출하고 기록만 한다 |
| `enforce` | 비긴급 규칙 콜을 내보내기 전 `speak` 확률이 임계값(기본 0.35) 미만이면 생략한다. 질문은 의도 확률 0.5 이상일 때 모델 분류를 쓴다 |

- 와이어: `POST {url}/v1/systemone`, 본문 `{state, questions, model?}`, 헤더 `Authorization: Bearer <apiKey>`. laya-serve(`pip install "laya[serve]"`, 기본 `0.0.0.0:8000`)와 같은 형식이다. Jev의 정확한 경로는 공식 문서로 확인해 URL에 경로를 포함해 넣을 수 있다.
- 질문: `speak`(noul)과 `urgency`(score) 두 개를 한 요청으로 보낸다. 의도 분류는 `intent`(choice) 하나다.
- 상태: 콜 문장·분류·우선순위, 세션·랩·순위·SC·날씨·앞뒤 갭(초), 최근 콜 3개. 드라이버 이름은 보내지 않는다.
- 개인정보: 루프백·사설망 주소는 항상 허용한다. 그 외 호스트는 `allowRemote`와 HTTPS가 모두 필요하다. 리다이렉트는 따르지 않는다. API 키는 `sender-config.json`에 저장하고 API 응답에 돌려주지 않는다.
- 요청은 한 번에 하나만 보낸다. 오류·타임아웃은 규칙대로 말한다.
- `logDecisions`를 켜면 `logs/engineer-decisions.jsonl`에 기록한다(5MB에서 `.1`로 회전). 섀도 기록은 모델 도입 판단과 laya 파인튠 데이터의 근거로 쓴다.

## HTTP API (Sender, 기본 `http://localhost:8099`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/radio/stream` | SSE. `event: hello`(언어·활성 콜), `event: call`(나간 콜), 15초 하트비트 |
| GET | `/api/radio/settings` | `{settings, hasApiKey, status}`. `settings.decision.apiKey`는 항상 비어 있다 |
| PUT | `/api/radio/settings` | 설정 전체 교체. `decision.apiKey`가 비면 기존 키 유지, `clearApiKey: true`면 삭제. 원격 URL 정책 위반은 400 |
| GET | `/api/radio/recent` | 최근 나간 콜 30개와 화면용 활성 콜 |
| GET | `/api/radio/decisions` | 최근 모델 결정 200개와 상태 |
| POST | `/api/radio/briefing` | 즉시 상황 브리핑 |
| POST | `/api/radio/repeat` | 마지막 콜 다시 듣기 (없으면 404) |
| POST | `/api/radio/test` | 라디오 체크 |
| POST | `/api/radio/ask` | `{question}` → `{intent, source, keywordIntent, modelIntent?, text}`. 답은 콜로도 나간다 |
| POST | `/api/radio/toggle` | 네이티브 radio 오버레이 토글 |
| GET | `/radio` | OBS·브라우저 페이지. `?voice=1`이면 클릭 후 브라우저 음성, `?transparent=1`이면 투명 배경 |

`POST /api/overlay/apply`와 프리셋·핫키의 `radio` 키는 생략 가능하다. 생략하면 radio 오버레이·핫키를 그대로 둔다.

## 설정 (`senderConfig.engineer`)

| 필드 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `true` | 자동 콜. 꺼도 브리핑·다시 듣기·질문은 동작 |
| `language` | `ko` | `ko`·`en` |
| `verbosity` | `normal` | `minimal`(높음 이상)·`normal`(보통 이상)·`detailed`(전부) |
| `categories.*` | 랩 브리핑만 꺼짐 | `pit`, `fuel`, `tyres`, `damage`, `raceControl`, `rivals`, `weather`, `lapBriefing` |
| `brakeGate` | `true` | 제동·코너 중 비긴급 콜 보류 |
| `briefingButton`, `repeatButton` | `0` | 게임 컨트롤의 "UDP Action" 번호(1~12). 0은 끔 |
| `tyreWearWarnPct` | `60` | 30~95 |
| `decision` | `mode: off` | 위 결정 모델 설정 |

Driver Pack의 음성 설정(켜기·음성·속도·볼륨)은 Electron `user-settings.json`의 `frc_engineer_radio_voice`에 저장한다. 기본은 꺼짐이다.

## 한계

- 음성 질문(STT)은 없다. Driver Pack의 텍스트 질문과 휠 버튼 브리핑을 쓴다.
- 상대 차량의 연료·ERS·손상은 공개된 텔레메트리 범위에서만 쓴다(기존 visibility 계약).
- 언더컷·오버컷은 Sender 휴리스틱 신호이며 이득 수치를 말하지 않는다. SC 확률·날씨 전환 시점은 예측하지 않는다.
