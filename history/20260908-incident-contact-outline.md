## 📋 Task Report: 사고 시점 차량 빨간 외곽선

### 1. Pre-Review (Plan)
- **Orchestrator Feedback**: 기존 사고 시점과 차량 ID를 사용해 표시 조건과 SVG 외곽선만 추가한다(낮음).
- **독립 리뷰어 Feedback**: fresh-context 리뷰어가 차량 배열 순서 대신 `participant.idx`를 비교하도록 확인했다. 프레임 사이의 이벤트 시각과 연쇄 충돌 데이터의 한계를 검토했다.
- **Refinement**: 재생 시각도 비교해 사고 시점 이전에는 같은 저장 프레임을 표시하더라도 강조하지 않는다.

### 2. Implementation Details
- **Assumptions**: [Assumption] 연쇄 충돌의 개별 접촉 시각이 저장되지 않아, 대표 사고 시각(`sessionTimeMs`)에서 `collisions`에 포함된 관련 차량을 함께 강조한다.
- **Key Changes**: 사고 시점의 표시 프레임에서 차량 실루엣에 빨간 외곽선을 추가한다. 팀 색상은 유지하고, 테두리는 확대 배율과 무관하게 2.5px로 표시한다. 앞뒤 탐색 시 강조 상태를 갱신한다.

### 3. Final Convention Review
- **Layer Analysis**: Presentation만 변경했다. Service·Repository·DTO·WebRTC 페이로드 변경은 없다.
- **Simplicity Check**: 기존 프레임 선택 함수와 차량 변환을 재사용하고 새 상태나 타이머를 추가하지 않았다.

### 4. Status
- **Verification**: 브라우저 회귀 테스트, 수정 파일 ESLint, 프로덕션 빌드 통과. 사고 전·사고 시점·다음 프레임·역방향 탐색, 불규칙 프레임 사이의 접촉, 무관한 차량 제외, 저장 범위 밖 이벤트를 검증했다.
- **Cleanup**: 임시 리뷰 스펙과 브라우저 테스트 세션 정리 완료.
