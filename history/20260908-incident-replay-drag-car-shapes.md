## 📋 Task Report: 사고 리플레이 드래그 오류 수정과 차량 형태 표시

### 1. Pre-Review (Plan)
- **Orchestrator Feedback**: 드래그 좌표 오류 재현·수정(낮음), 차량 방향·축척 표현(중간), 실제 브라우저 회귀 검증(중간)으로 나눴다. SVG 오류를 숨기지 않고 잘못된 카메라 좌표의 생성 원인을 수정한다.
- **독립 리뷰어 Feedback**: fresh-context 리뷰어 1개가 DOMPoint의 프로토타입 좌표와 spread의 불일치를 확인했다. 좌표 변환 함수에서 일반 객체를 반환하는 수정, 차체의 미터 단위 축척과 yaw 회전, 확대된 차체 밖의 라벨 배치를 제안했다.
- **Refinement**: 위 제안을 반영했다. 영구 브라우저 테스트는 실제 DOMPoint와 SVG 변환을 유지하고 합성 이벤트에 필요한 pointer capture 요청만 임시 대체한다. 별도 실제 CDP 마우스 입력으로 캡처·지도 밖 이동·해제까지 검증했다.

### 2. Implementation Details
- **Assumptions**: 차량 치수와 충돌 판정 영역이 기록에 없어, 길이 약 5.5m·폭 2m의 F1 실루엣을 사용하고 기록된 위치를 실루엣 중심으로 삼았다. 근사 크기이며 실제 충돌 판정 영역이 없다는 점을 화면에 표시한다.
- **Key Changes**:
  - `mapPoint()`가 DOMPoint의 `x/y`를 일반 객체로 반환한다. 이전에는 드래그 기준점에 spread로 저장할 때 두 값이 사라져 첫 이동부터 NaN이 전파됐다.
  - 원형 마커를 차체, 네 바퀴, 앞뒤 윙이 구분되는 F1 실루엣으로 변경했다. 기록된 yaw를 따르며 지도와 함께 확대된다.
  - 이름·팀·플레이어 표시는 읽을 수 있는 화면 크기를 유지하고 차체 위아래에 배치한다. 방향·속도 화살표는 차체 밖에 표시한다.
  - 지도 설명을 도구 모음으로 이동해 모바일에서 차량과 겹치지 않게 했다.
  - 브라우저 회귀 검증에 유한한 SVG 좌표, 여러 번의 포인터 이동과 해제, 줌 후 드래그, 네 방향 yaw, 차체 확대 비율을 추가했다.

### 3. Final Convention Review
- **Layer Analysis**: 변경은 Presentation의 좌표 처리와 SVG 표현에 한정한다. Service·Repository·저장 DTO·WebRTC 페이로드 변경은 없다.
- **Simplicity Check**: 기존 지도 투영·카메라·재생 상태를 재사용했다. 새 의존성이나 충돌 추정 로직을 추가하지 않았다.
- **Style Match**: 기존 React/SVG 구성과 브라우저 테스트 하네스를 유지했다. 차량 표시에서 불필요해진 `width` prop만 제거했다.

### 4. Status
- **Verification**:
  - 수정 전 새 브라우저 테스트가 잘못된 SVG path로 실패했다. 실제 CDP 드래그에서도 `path.d`, `circle.cx/cy`의 NaN을 재현했다.
  - 수정 후 `npm run test:analysis:browser` 통과. 드래그·차량 형태 검증 외 기존 탐색·필터·재생·공유 검증도 통과했다.
  - 실제 CDP 마우스로 기본/확대 상태에서 반복 이동, 지도 밖 포인터 캡처, 해제 후 정지를 검증했다. 브라우저 콘솔·SVG 오류 0건.
  - `IncidentReplay.test.tsx`와 `analysisPlayback.test.ts`: 18개 테스트 통과.
  - 수정 파일 ESLint 및 `npm run build` 통과.
  - 1440px/390px 스크린샷으로 차량 형태와 라벨 배치를 확인했다. `build/artifacts/pithub-incident-cars/`에 보관했다.
- **Cleanup**: 임시 리뷰 스펙, CDP 검증 스크립트, Chrome 프로필과 테스트 세션을 정리했다.
