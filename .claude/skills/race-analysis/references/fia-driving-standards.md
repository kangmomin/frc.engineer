# FIA 규정 위키 — 사고 과실 판정

race-analysis 스킬의 참조 문서. 사고 클립(incidents)이 있는 세션에서 **게임 페널티 판정과
별개로**, FIA 공식 규정·가이드라인에 근거해 "누구 과실인가"를 판정할 때 이 문서가 기준이다.
판정 절차는 §3, 텔레메트리 산출법은 §4, 판정 불가 항목은 §5.

---

## S. 출처 / 버전 (Source of Truth)

| ID 접두 | 문서 | 버전 / 발행일 | URL |
|---|---|---|---|
| `DSG-*` | 2026 F1 Driving Standards Guidelines | v01, 2026-02-26 | https://www.fia.com/sites/default/files/2026_f1_driving_standards_guidelines.pdf |
| `PEN` | 2026 F1 Penalty Guidelines | v01 | https://www.fia.com/sites/default/files/2026_f1_penalty_guidelines.pdf |
| `APXL-*` | FIA International Sporting Code, Appendix L (2026), Chapter IV "Code of Driving Conduct on Circuits" | 2026-06-23 발행 | https://www.fia.com/system/files/documents/appendix_l_2026_publie_le_24_juin_2026.pdf |

- DSG 서두 원문: **"These are GUIDELINES and NOT REGULATIONS. At all times the Stewards will
  adjudicate based upon the Regulations, but decisions will be informed and guided by these
  guidelines."** → 규범은 규정(Appendix L·F1 Sporting Regulations)이고 DSG는 스튜어드의 해석
  지침이다. 리포트 인용은 아래 규칙 ID로 한다.
- DSG/PEN이 인용하는 `B1.8.6` 등 **B-조항은 2026 F1 Sporting Regulations 번호 체계**다. 필요한
  조항 원문은 DSG가 그대로 인용하고 있으므로 본 위키는 Sporting Regulations 전문을 별도로
  가져오지 않는다. F1 25(2025 시즌) 콘텐츠 분석 시에도 실질 기준(미러 라인·프런트 액슬·원
  무브)은 동일하며 조항 번호 체계만 다르다.
- FIA 규정은 연중 개정된다(Appendix L 2026은 6월 재발행본). 리포트에 판정 근거를 쓸 때는
  본 위키의 문서 버전을 명시한다.

---

## 0. 판정 원칙 (방향 규칙)

### DSG-PRI — 우선권과 회피 책임의 방향
**원문**: "If it has been established from points A and B below, that an overtaking driver has
priority, it is the responsibility of the defending driver to avoid a collision or forcing off
the overtaking driver."

- 추월자가 DSG-A/B 요건을 **충족** → 우선권은 추월자에게. 충돌·포싱오프 회피 책임은 **방어자**.
- 추월자가 요건을 **미충족** → 공간을 받을 권리가 없다. 무리한("optimistic"/late) 시도로 접촉이
  나면 회피 책임은 **추월자**.
- 한쪽 방향만 적용하지 말 것 — 두 방향 모두 이 문서의 판정 축이다.

### DSG-CAV — 필수 유보 조항 (판정 전 반드시 통과)
**원문** (요건 4항):
1. "A car being overtaken, or performing an overtake, cannot simply 'disappear'."
2. "A lock up or small steering correction do not necessarily imply a driver has lost control"
3. "An apparent temporary loss of control, or a lock up, may be due to an attempt to avoid a
   collision, or simply the 'laws of physics'."
4. "The apex may vary depending on the racing line taken and/or the nature of the corner itself."

**요약**: 차가 사라질 수는 없고(공간이 없으면 접촉은 불가피 요소 포함), 락업·소폭 보정 ≠ 제어
상실, 순간적 제어 상실은 회피 시도나 물리 법칙일 수 있으며, 에이펙스는 라인·코너 특성에 따라
달라진다. **위치 스냅샷 하나로 단정하는 판정을 금지하는 조항이다.**

### DSG-PP — 페널티 포인트 일반 정책
**원문**: "As a general policy, penalty points will be applied only for dangerous, reckless or
apparently deliberate actions resulting in a collision, or other unacceptable driving behaviour
or unsportsmanlike behaviour on the part of the driver"

---

## 1. 규칙 카드

각 카드: **원문**(판정에 필요한 핵심 인용) → **요약** → **판정 기준** → **텔레메트리**(§4 참조).

### DSG-A — 인사이드 추월의 공간 권리
**원문**: "To be entitled to be given room when overtaking on the INSIDE, the overtaking car must:
i) Have its front axle AT LEAST ALONGSIDE THE MIRROR of the other car PRIOR TO AND AT THE APEX
ii) Be driven in a fully controlled manner particularly from entry to apex and not have 'dived in'.
iii) In the Stewards' estimation, have taken a reasonable racing line and been able to complete
the move whilst remaining within track limits."

**요약**: 인사이드 추월자가 공간을 받을 권리는 ① 에이펙스 **이전부터 에이펙스까지** 프런트
액슬이 상대 **미러 라인 이상**, ② 진입~에이펙스 완전 제어("다이브인" 아님), ③ 합리적 라인 +
트랙 리밋 내 완주 가능 — 3요건 **모두** 충족 시 성립.
**판정**: 3요건 충족 → 방어자 회피 책임(DSG-PRI). 미충족 → 추월자 책임 쪽으로.
**텔레메트리**: §4.3 오버랩/미러 라인, §4.4 에이펙스, §4.5 다이브인. (③은 §5 한계 — 트랙 경계
데이터 없음.)

### DSG-B — 아웃사이드 추월의 공간 권리
**원문**: "Overtaking on the outside will always be viewed as a more difficult manoeuvre to
accomplish. To be entitled to be given room, including at the exit, when overtaking on the
OUTSIDE, the overtaking car must: i) Have its front axle AHEAD OF THE FRONT AXLE of the other
car AT THE APEX. ii) Be driven in a controlled manner from entry, to apex, and to exit.
iii) Be able to make the corner within track limits."
**Note 원문**: "On long radius curves, provided point (ii) above is complied with, the Stewards
will treat each case on its merits particularly where there is no defined apex or there are
multiple apexes."

**요약**: 아웃사이드는 더 어려운 기동으로 간주. 권리 성립엔 ① **에이펙스에서** 프런트 액슬이
상대 프런트 액슬보다 **앞**, ② 진입~에이펙스~탈출 제어, ③ 트랙 리밋 내 코너 완주 가능.
충족 시 **탈출(exit)까지 포함**해 공간을 받을 권리.
**판정**: 인사이드(DSG-A)보다 문턱이 높다(미러 라인이 아니라 액슬 대 액슬 우위). 롱 코너·다중
에이펙스는 개별 판단 — 확신도 하향.
**텔레메트리**: §4.3 (dLong ≥ 0 기준), §4.4.

### DSG-C — 시케인·S자
**원문**: "The above guides for INSIDE and OUTSIDE may apply for each element of the combination.
Generally, priority will be given to the first corner element. However other factors such as the
sequence of corners will be considered holistically by the Stewards when assessing the right to
the corner."

**요약**: 복합 코너는 요소별로 DSG-A/B 적용 가능하되, **일반적으로 첫 요소에서의 우선권이
우선**. 코너 연쇄는 종합 판단.

### DSG-NOTES — 종합 판단 요소 (A·B·C 공통, 필수 점검)
**원문**: "Racing is a dynamic process. Although these guidelines indicate specific relative
positions of the cars at various points, the Stewards will always look at how the situation
played out in total when reviewing an incident."
점검 10항 (원문 축약):
i) 어떻게 그 상황에 이르렀나 (late braking, diving in, moving under braking)
ii) 시도가 늦거나 "optimistic"했나
iii) 드라이버가 합리적으로 보고·알고·예상할 수 있었던 것은
iv) 그 기동이 트랙 위에서 완결될 수 있었다고 보나
v) 언더스티어/오버스티어/락업이 있었나
vi) 충돌 회피 시도가 있었나
vii) 우선권을 얻으려고 브레이크를 릴리스했나
viii) 차의 위치·조작이 사고에 기여했나
ix) 코너 특성(캠버·연석·곡률·에이펙스)이 기여했나
x) 상대적 타이어/타이어 나이/그립은

**판정**: 위치 기준(DSG-A/B) 충족 여부와 **무관하게** 이 10항을 통과한 뒤에만 결론을 내린다.
DSG 원문이 위치 스냅샷 단독 판정을 금지한다.

### APXL-2b + DSG-G — 직선에서의 방어 (원 무브 · 크라우딩 금지)
**원문(APXL-2b)**: "Overtaking, according to the circumstances, may be carried out on either the
right or the left. … More than one change of direction to defend a position is not permitted.
Any driver moving back towards the racing line, having earlier defended his position off-line,
should leave at least one car width between his own car and the edge of the track on the
approach to the corner. However, manoeuvres liable to hinder other drivers, such as deliberate
crowding of a car beyond the edge of the track or any other abnormal change of direction, are
strictly prohibited."
**DSG-G Note 원문**: "moves intended to break the slipstream of a following car when the
following car is a safe distance behind, considering relative speeds and position on the track,
may be acceptable."

**요약**: 방어 목적 방향 전환은 **1회만**. 오프라인 방어 후 레이싱 라인 복귀 시 코너 진입에서
**한 차폭 이상**의 공간을 남겨야 한다. 트랙 밖으로 밀어내는 고의적 크라우딩·비정상적 방향
전환은 엄금. 뒤차가 안전 거리에 있을 때의 슬립스트림 끊기는 허용될 수 있다.
**텔레메트리**: §4.7 무브 카운트, §4.8 크라우딩.

### DSG-H — 브레이킹 중 무빙
**원문**: "When defending, there must be no change in direction by the defending car, after the
deceleration phase has commenced, except to follow the racing line."

**요약**: 감속 국면 개시 후 방어차의 방향 전환 금지(레이싱 라인 추종 제외). 브레이킹 존
접촉에서 방어자 과실을 가르는 가장 명확한 규칙.
**텔레메트리**: §4.6 — 클립 데이터로 가장 강하게 검증 가능한 규칙 중 하나.

### APXL-2c + DSG-D — 트랙 리밋 · 이탈
**원문(APXL-2c)**: "Drivers must use the track at all times and may not leave the track without a
justifiable reason. For the avoidance of doubt, the white lines defining the track edges are
considered to be part of the track but the kerbs are not. … Should a car leave the track for any
reason, the driver may rejoin. However, this may only be done when it is safe to do so and
without gaining any lasting advantage."
**DSG-D 스트라이크 예외(레이스, 원문 축약)**: 명백한 제어 상실 / 충돌 회피(전형: 랩1 턴1) /
타 차에 의해 forced off로 판정된 경우 / 이미 지속 이득·위험 리조인으로 처벌된 경우 / 다른
사유로 처벌된 사고 중 이탈 / 추월 기동 중 이득 없는 이탈(재량) — 은 스트라이크 미적용.

**요약**: 흰 선까지가 트랙, 연석은 아니다. 이탈 후 복귀는 안전할 때 + 지속 이득 없이.
**과실 판정에서의 용도**: 사고 당사자가 "forced off"였는지(→ 밀어낸 쪽 과실) vs 스스로
이탈했는지의 분류 축.

### DSG-F — 지속 이득 반환 (방어 중 코너 컷)
**원문(Note)**: "If, while defending a position, a car leaves the track (or cuts a chicane) and
re-joins in the same position, it will generally be considered by the stewards as having gained
a lasting advantage and therefore, generally, the position should be conceded."

**요약**: **방어 중** 트랙 이탈(시케인 컷 포함) 후 같은 순위로 복귀 = 일반적으로 지속 이득 →
순위를 내줘야 한다. 심레이스 최빈 시나리오 중 하나 — 이후 접촉이 나면 "이득을 반환하지 않은
방어" 맥락이 과실 판단에 들어간다.

### DSG-I — 트랙 복귀 (리조인)
**원문**: "Maintaining racing speeds in the run-off area is not acceptable. Cars on track must
not be forced to change speed or line to avoid a re-joining car."

**요약**: 런오프에서 레이싱 스피드 유지 불가. **본선 차량이 복귀 차량 때문에 속도·라인을
바꿔야 했다면 복귀차 과실.**
**텔레메트리**: §4.10.

### APXL-2d — 충돌 유발 · 제어 상실
**원문**: "Causing a collision, repetition of serious mistakes or the appearance of a lack of
control over the car (such as leaving the track) will be reported to the Stewards and may entail
the imposition of penalties up to and including the disqualification of any driver concerned."

**요약**: 충돌 유발·중대 실수 반복·제어 상실 징후는 회부 대상. 과실 판정의 결과 조항 —
"누가 유발했나"의 판단 기준 자체는 DSG-A/B/G/H 등이 제공한다.

### APXL-2e + DSG-E — 위험 주행 · 임피딩
**원문(APXL-2e)**: "It is not permitted to drive any car unnecessarily slowly, erratically or in
a manner deemed potentially dangerous to other drivers at any time."
**DSG-E**: B4.1.1(임피딩) 집행 + B1.8.5 원문 인용(내용 동일).

**요약**: 불필요한 저속·불규칙(erratic)·잠재적 위험 주행 금지. 저속 주행 차량과의 접촉,
쿨다운 랩 방해 등에 적용.

### APXL-2a + DSG-K — 블루 플랙 (랩핑)
**원문(APXL-2a)**: "A car alone on the track may use the full width of the said track, however,
as soon as it is caught by a car which is about to lap it the driver must allow the faster
driver past at the first possible opportunity."
**DSG-K Note**: 블루 플랙을 받으면 최대한 빨리 양보하되 다음 직선까지는 관용. 다음 직선에서도
미양보면 위반 취급. 8개 연속 라이트 패널 통과 후 양보 / OVERTAKE(에너지) 수취 목적 지연은
거의 확정 위반.

**요약**: 랩 다운 차량과의 접촉에서 백마커가 양보 의무를 다했는지의 기준. (라이트 패널 수는
게임 데이터에 대응물이 없음 — §5.)

### DSG-L — 옐로 · 더블 옐로
**원문(B1.8.4 인용, 축약)**: 싱글 옐로 — "braked earlier and/or discernibly reduced speed in
the relevant marshalling sector". 더블 옐로 — "reduce speed significantly and be prepared to
change direction or stop … must be clear that the driver has not attempted to set a meaningful
lap time".
**Note vi·vii (검증 방법 원문 축약)**: 준수 입증 방법의 하나로, 싱글 옐로는 해당 플랙 섹터
통과 시간이 유사 조건 이전 랩 대비 **+5% 이상**, 더블 옐로는 **+15% 이상**.

**요약**: 사고 직후 옐로 구간에서 2차 사고가 났다면, 후행 차가 감속 의무를 이행했는지가 과실
축. 5%/15% 기준은 DB 섹터 타임으로 실측 검증 가능한 몇 안 되는 항목(§4.11).

### DSG-J — 세이프티카 리스타트
**원문(B5.13.6 인용)**: "from the point at which the orange lights on the safety car are
extinguished drivers must proceed at a pace which involves no erratic acceleration or braking
nor any other manoeuvre which is likely to endanger other drivers or impede the restart".
**Note**: 리더는 페이스·가속 시점 선택권이 있지만 위험 상황 조성 책임을 면제받지 않는다.

**요약**: SC 트레인 내 추돌·리스타트 사고의 판정 축 — 선행차의 erratic 감속 vs 후행차의
부주의.

---

## 2. 페널티 기준표 (주행 행위 발췌)

PEN(2026 F1 Penalty Guidelines v01)에서 **주행 행위 관련 행만** 발췌. 제재는 레이스/스프린트
세션 컬럼(원문 표기 "TTCS") 기준. PP = 페널티 포인트, `*` = 상한(0~그 수치 재량),
DT = Drive-Through, S&G = stop and go. 타이어·커퓨·PU·계량·misconduct 등 비주행 행은 제외.

| 위반 | 조항 | 레이스 기준 제재 | PP |
|---|---|---|---|
| 충돌 유발 (기본) | App.L Ch.IV 2(d) | **10s (Baseline)**, DT 또는 10s S&G; 완화 시 5s | 0–3* |
| 충돌 유발 — 즉각적·명백한 스포팅 결과 없음 | 〃 | 무페널티/견책/5s/10s ("kiss" 수준 접촉은 무페널티 가능) | 0 |
| 충돌 유발 — 명백한 고의·무모 | 〃 | 10s S&G 또는 30s 초과 타임 페널티; 극단적 사례는 DSQ 또는 차기 레이스 출전정지 | 4 |
| 포싱 오프 (기본) | App.L Ch.IV 2(b) | **10s (Baseline)**, DT 또는 10s S&G; 완화 시 5s | 0 |
| 포싱 오프 — 무모·위험·고의 | 〃 | 10s S&G 또는 30s 초과 타임 페널티 | 3 |
| 트랙 이탈 + 지속 이득 | B1.9.6 & 2(c) | 10s (Baseline) ~ DT; 완화 시 5s | 0 |
| 트랙 이탈 + 위험 리조인 | B1.8.6 & 2(c) | 5s ~ DT | 2 |
| 정당 사유 없는 트랙 이탈 (트랙 리밋) | B1.8.6 / 2(c) | 랩 삭제 + 스트라이크; 3회 흑백기; 4회부터 각 5s | 0 |
| 방어 목적 방향 전환 2회 이상 | App.L Ch.IV 2(b) | 5s ~ DT | 3* |
| 브레이킹 존 무빙 | App.L Ch.IV 2(e) | 첫 위반 흑백기 가능, 이후 페널티 | 0 |
| 브레이킹 존 무빙 — "잠재적 위험" | 〃 | 5s ~ DT | 3* |
| erratic/잠재적 위험 주행 | B1.8.5 / 2(e) | 10s (Baseline), DT 또는 10s S&G; 완화 시 5s | 3* |
| 위험한 방식의 불필요한 저속 주행 | 〃 | 10s (Baseline), DT 또는 10s S&G; 완화 시 5s | 3* |
| 명백한 손상 차량 계속 주행 | B1.8.7 | 10s (Baseline), DT 또는 10s S&G | 3* |
| 임피딩 | B4.1.1 / 2(b) | (레이스 중 임피딩은 블루플랙 행 참조; 퀄리파잉: 3그리드) | 0 |
| 싱글 옐로 미감속/추월 | B1.8.4(a) | 10s 또는 DT | 3* |
| 더블 옐로 미감속/추월 | B1.8.4(b)(c) | 10s S&G | 3* |
| 블루 플랙 무시 | App.H 2.5.5(e) / 2(a) | 5s 또는 10s, DT | 0 |
| SC/VSC 중 추월 (순위 미반환) | B5.13.2(c) / B5.12.2(c) | 1대: 10s / 2대: DT / 3대+: 10s S&G (순위 반환 시 No Further Action) | 2–3 |
| SC/VSC 중 저속·erratic·위험 주행 | B5.13.2a / B5.12.2a & 2(e) | 5s/10s, DT 또는 10s S&G | 2–3 |
| 리스타트 전(SC 복귀 중) 추월 | B5.15.3 | DT 또는 10s S&G (의무) | 2–3 |

**PP 운영 규칙(PEN 원문 요지)**: 견책·벌금에는 PP 부과 불가. PP는 12개월 후 소멸, 12점 도달 시
다음 이벤트 출전정지. 기재 수치는 통상 기준(norm)이며 가중·완화 사정으로 조정 가능 —
상향은 예외적 상황에서만. PP 부과는 DSG-PP 정책(위험·무모·명백한 고의)과 함께 읽는다.

---

## 3. 과실 판정 절차 (사고 클립 1건당)

### F1. 시나리오 분류
클립 궤적·충돌 쌍·랩/시각으로 분류 (복수 해당 가능):
`코너 추월-인사이드` / `코너 추월-아웃사이드` / `시케인·S자` / `직선 방어` /
`브레이킹 존` / `리조인` / `SC·VSC/리스타트` / `옐로 구간 2차 사고` / `랩핑(블루)` / `기타`.

### F2. 역할 판정 — 추월자/방어자
- 윈도우 시작 시점(충돌 수 초 전) **앞선 차 = 방어자**, 뒤에서 **closing speed > 0**로 접근한
  차 = 추월자 (§4.2·§4.9). 리조인·SC 시나리오는 역할 대신 "복귀차/본선차", "선행/후행"으로.

### F3. 우선권 테스트 (위치 기준)
- 인사이드: DSG-A ①②③ / 아웃사이드: DSG-B ①②③ / 시케인: DSG-C(첫 요소 우선).
- 산출 수치를 판정 문장에 병기: 오버랩(m), 에이펙스 시점 근사, 클로징 스피드(km/h) 등.
- **에이펙스가 클립 윈도우(±1s) 밖이면 위치 기준 테스트는 "적용 불가"로 표기**하고 F4의
  홀리스틱 요소만으로 판단하되 확신도를 낮춘다. 위치 기준 미산출을 숨기지 않는다.

### F4. 홀리스틱 점검 (필수 통과)
- DSG-CAV 4항 + DSG-NOTES 10항을 각각 확인해 해당/비해당/판정불가로 채운다.
  (전부 서술할 필요는 없고, 판정을 바꿀 수 있는 항목은 반드시 리포트에 남긴다.)
- 위치 기준(F3)을 통과했어도 F4에서 뒤집힐 수 있다 — DSG 원문이 "how the situation played
  out in total"을 요구한다.

### F5. 판정
스튜어드 실제 용어의 3단계 척도:

| 판정 | 의미 |
|---|---|
| **wholly to blame** | 전적 과실 — 한쪽이 규칙 위반으로 사고를 유발 |
| **predominantly to blame** | 주된 과실 — 쌍방 요인이 있으나 한쪽이 지배적 |
| **racing incident** (no further action) | 레이싱 인시던트 — 어느 쪽에도 유의미한 과실 없음 |

- 판정 문장에 **근거 규칙 ID + 산출 수치**를 붙인다.
  예: "B predominantly to blame — 에이펙스 시점 오버랩 +1.4m로 DSG-A(i) 충족 상태에서
  방어차 조향 유지(DSG-PRI 회피 책임 불이행) [브레이킹 무빙 없음: DSG-H 비해당]"
- **확신도(높음/중간/낮음)와 그 이유**(데이터 한계·[추정] 임계값 의존도)를 함께 표기.
- 데이터가 부족하면 racing incident로 뭉개지 말고 **"판정 불가(확신도 낮음)"**로 쓴다.

### F6. 게임 판정 병기
- "게임 판정" = `events`의 페널티/워닝을 사고 t0(±병합 윈도우)·랩에 매핑한 것.
- 매핑되는 페널티가 없으면 **"게임 판정 없음"**으로 표기 (임의 해석 금지).
- FIA 판정과의 일치/상이를 한 줄로 명시한다.

### F7. 참고 페널티
- §2 표에서 해당 위반의 기준 제재를 "참고"로 첨부한다 — 리포트가 페널티를 부과하는 게
  아니라, 실제 규정이라면 어느 수위인지의 참조.

### 리포트 표기 블록 (사고별)
```
사고 #n (랩 L, t0=…): <시나리오>
- 역할: A(추월자/인사이드) vs B(방어자) — 근거: 윈도우 시작 갭 +x.x m, 클로징 +yy km/h
- 우선권 테스트: DSG-A(i) 충족/미충족/적용불가 [수치] · (ii) … · (iii) 판정불가(§5)
- 홀리스틱: NOTES i·vii 해당(브레이크 릴리스 감지) …
- FIA 판정: … to blame — [규칙 ID들] (확신도: 중간 — 사유)
- 게임 판정: <events 매핑 결과 또는 "게임 판정 없음"> → FIA 판정과 일치/상이
- 참고 페널티: 충돌 유발(기본) — 10s Baseline, PP 0–3* [PEN]
```

---

## 4. 텔레메트리 → 규정 매핑

사고 클립 프레임의 차량별 14값(순서 고정): `x,y,z, vx,vy,vz, yaw, gLat, gLong, speedKmh,
throttle, brake, steer, gear` (~20Hz, ±1s 윈도우, 체인 병합 최대 5s). SoT:
`internal/dto/incident.go`.

### 4.0 좌표계 — 검증 완료 항목과 [추정] 잔여 항목

**검증됨** (Belgium 2026-08-13 세션, 사고 클립 3건 실측 — 시험 적용 캘리브레이션):
- **지면 평면 = x–z, 수직축 = y**: 클립 창 내 y 변화 2.5~4.3m vs 평면 축 수십~160m.
- **yaw 헤딩 관례 = (sin yaw, cos yaw) in (x,z)**: 직선 프레임(|gLat|<0.5)에서 속도벡터
  방향과의 오차 평균 0.2°, 최대 1.2°. **코너에서의 편차는 관례 오류가 아니라 실제 슬립각**
  (편차 부호가 gLat 부호와 78/78 상관) — §4.10 슬립각 신호의 실측 근거.
- **speedKmh = |v(3D)|·3.6**: 오차 ≤0.8km/h — 속도는 world m/s.
- **좌표 기준점 = 차량 중심, 차폭 ≈ 2.0m**: 순수 측면 휠 접촉(COLL)에서 중심 간 거리 2.0m.
- **입력 범위**: throttle/brake 0..1, steer −1..1 (brake 0.85, steer −1.0 실측).
- 유도 기법: **yaw 증가는 +dLat 방향으로의 회전** (dLat = r·h⊥, h⊥=(hz,−hx) 기준).
  → 회전 방향(yaw rate 부호)이 상대(+dLat) 쪽이면 **상대가 코너 인사이드**, 반대면 아웃사이드.
- **minDistM 주의**: 참가자 minDistM은 **중심 간 3D 거리**다. 나란히 달리면 접촉 시에도
  ≈2.0m(차폭)이므로 "minDist>0 = 무접촉"으로 읽지 말 것. 접촉 발생·시각의 마커는
  **COLL(sessionTimeMs)**. 실측: minDist 2.0~3.4m 클립 모두 COLL 발생.

**[추정] 유지** (전후 접촉 사례가 없어 미검증 — 조정 가능 기본값, 판정 문장에 [추정] 표기):
- 차량 전장 ~5.6m, 미러 라인 오프셋(dLong ≥ −0.8m), brake 임계 0.2.

### 4.1 신호 목록

| # | 신호 | 산출 | 검증 강도 | 적용 규칙 |
|---|---|---|---|---|
| 4.2 | 상대 위치 분해 dLong/dLat | 방어자 헤딩 단위벡터 h로 상대 위치 r=P상대−P기준을 투영: dLong=r·h(+ 앞), dLat=r·h⊥ | 중간 | 역할 판정, DSG-A/B |
| 4.3 | 오버랩/미러 라인 | **[추정]** 차량 전장 ~5.6m, 중심 기준. DSG-A(i) "프런트 액슬 ≥ 미러 라인" ≈ **dLong ≥ −0.8m** (기본값, 조정 가능). DSG-B(i) "액슬 대 액슬 앞" ≈ **dLong ≥ 0** | 낮음([추정] 기하) | DSG-A(i), DSG-B(i) |
| 4.4 | 에이펙스 시점 | 코너 국면에서 \|yaw rate\|(Δyaw/Δt) 또는 \|gLat\| 피크 시점으로 근사. DSG-CAV 4(에이펙스 가변) 명심 | 중간 | DSG-A/B "at the apex" |
| 4.5 | 다이브인 / late braking | brake 개시 시점·개시 속도, 진입 클로징 스피드, **진입 중 brake 릴리스**(NOTES vii: 우선권 획득 목적) | 높음(입력 실측) | DSG-A(ii), NOTES i·ii·vii |
| 4.6 | 브레이킹 중 무빙 | 방어차 brake > 0.2 **[추정]** 구간에서 steer/헤딩의 유의미한 추가 전환(레이싱 라인 곡률 초과) | **높음** — 가장 강하게 검증 가능한 규칙 | DSG-H |
| 4.7 | 방어 무브 카운트 | 직선 국면(\|gLat\| 낮음)에서 방어차 dLat 궤적의 방향 전환 횟수. 2회 이상 = APXL-2b 위반 신호. 슬립스트림 끊기 예외(DSG-G Note)는 뒤차 거리로 판단 | 중간 | APXL-2b, DSG-G |
| 4.8 | 크라우딩 | 방어차의 지속적 횡이동으로 두 차의 dLat 간격 축소 + 공격차의 감속/조향 회피 반응. 트랙 에지 데이터가 없어 "beyond the edge" 확정 불가 — [추정] 표기 | 낮음 | APXL-2b, 포싱 오프 |
| 4.9 | 클로징/충격 | 상대속도 벡터 크기, 최소거리 시점 전후 속도 델타 | 높음 | 역할 판정, 충격 심각도 |
| 4.10 | 제어 상실/슬립/스핀 | 슬립각 = 헤딩 vs 속도벡터 각도차 급증; 스핀 = yaw 단조 회전. **DSG-CAV 2·3 필수 적용** — 락업·소폭 보정 ≠ 상실, 회피 기동일 수 있음 | 중간 | APXL-2d, NOTES v·vi |
| 4.11 | 리조인 위험 | 복귀차: 저속 + 타 차량 통과 궤적(레이싱 라인 근사)에서 크게 이탈했다 재진입. 본선차: 복귀차 접근 시점 속도·조향 급변(= "forced to change speed or line") | 중간 | DSG-I |

### 4.12 클립 밖 데이터 (DB/로컬 요약)

| 데이터 | 용도 | 검증 강도 |
|---|---|---|
| `laps`의 섹터 타임 | 옐로/더블 옐로 준수 — 플랙 섹터 통과 시간이 유사 조건 이전 랩 대비 **+5% / +15%** (DSG-L Note vi·vii의 공식 검증법 그대로) | **높음** — 실측 |
| `events`의 페널티/워닝/RC 알림 | F6 게임 판정 매핑; 옐로·SC 국면 특정 | 높음 |
| `drivers[]`(로컬 요약) / 동일 세션 타 계정 행 | 상대 차량의 랩·스틴트 맥락(NOTES x 타이어 나이) | 중간 |

---

## 5. 한계 — 판정 불가 항목 (리포트의 "해석 한계"에 그대로 반영)

1. **트랙 경계 데이터 없음** — DSG-A(iii)/B(iii)의 "within track limits", 크라우딩의 "beyond
   the edge", 트랙 리밋 위반 자체는 클립만으로 확정 불가. 정황(궤적·회피 반응) 근사만 가능.
2. **클립 윈도우 ±1s(병합 최대 5s)** — 진입 몇 코너 전부터의 배틀 맥락(NOTES i의 일부)은
   포착되지 않는다. 에이펙스가 윈도우 밖이면 위치 기준 테스트 적용 불가(F3 분기).
   실측: Belgium 시험 적용에서 3클립 중 2클립이 에이펙스 미도달 — 이 분기는 예외가 아니라
   상시 경로다.
3. **참가자는 플레이어 반경 내 차량만** — 제3차의 개입(회피 유발 등)이 누락될 수 있다.
4. **일부 기하 임계값은 [추정]** — 좌표 기준점(중심)·차폭(2.0m)은 실측 검증됐으나(§4.0)
   차 길이·미러 라인 −0.8m·brake 0.2는 미검증 기본값이다. 판정 문장에 [추정]을 남긴다.
5. **시야·인지 판정 불가** — NOTES iii("무엇을 볼 수 있었나")는 데이터로 답할 수 없다.
6. **블루 플랙 8 라이트 패널 규칙(DSG-K)** — 게임 데이터에 대응물 없음 → N/A.
7. **events ↔ 사고 매핑은 근사** — events 타임스탬프는 wall-clock, 클립 t0는 session-time이라
   앵커 없이는 랩 단위 매핑만 가능하다. F6 게임 판정 병기에서 같은 랩의 이벤트라도 사고와의
   인과 연결은 단정하지 말고 "미확정"으로 표기한다.
8. **본 판정은 시뮬레이션 참고 판정** — 실제 FIA 스튜어드 판정의 재현이 아니며, 게임 물리와
   실차 물리의 차이도 흡수하지 않는다. 리포트에 이 문장을 명시한다.
