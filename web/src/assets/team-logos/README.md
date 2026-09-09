# Team logos (drop-in)

실제 팀 로고 파일을 넣는 곳. **파일만 넣으면 자동 적용**되며 코드 수정은 필요 없다.

- 파일명은 게임이 보내는 **team ID**: `<teamId>.svg` 또는 `<teamId>.png`
- ID 대역: F1 25 = `0`~`10`, 2026 Season Pack = `476`~`486`
  (같은 팀이 두 ID를 가지므로, 두 시즌 모두 쓰려면 두 파일을 넣는다 — 예: Mercedes = `0.svg`, `476.svg`)
- 같은 ID에 `.svg`와 `.png`가 모두 있으면 **`.svg`가 우선**한다
- 파일이 없는 팀은 `src/ui/TeamLogo.tsx`의 인라인 SVG 마크로 그려진다
- 16×16 박스에 `object-fit: contain`으로 들어가므로 정사각형에 가까운 크롭이 가장 잘 보인다

수집은 빌드타임(`import.meta.glob`)에 일어난다. 파일을 추가/삭제한 뒤에는 dev 서버를 재시작한다.

`TEAM_COLORS` / `TEAM_SHORT` / `TEAM_NAMES` / `getTeamKey`의 ID 매핑은 `src/constants/teamColors.ts`에 있다.
