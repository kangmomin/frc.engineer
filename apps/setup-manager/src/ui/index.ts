// Driver Pack UI — MinmoPitwallUI(web/src/ui) 컴포넌트를 그대로 재사용하고,
// 데스크톱 앱에만 필요한 입력·버튼 류는 같은 토큰으로 만든 kit에서 가져온다.
// web 배럴(index.ts)은 TeamLogo 등 불필요한 의존을 끌고 오므로 파일 단위로 import한다.
export { MetricTile } from "../../../../web/src/ui/MetricTile";
export { PanelTitle } from "../../../../web/src/ui/PanelTitle";
export { WeatherIcon } from "../../../../web/src/ui/WeatherIcon";
export type { Tone } from "../../../../web/src/ui/types";
export * from "./kit";

/** SVG·인라인 스타일에서 쓰는 theme.css 토큰 참조. */
export const T = {
  bg: "var(--bg-primary)",
  panel: "var(--bg-panel)",
  inset: "rgba(14, 14, 15, 0.52)",
  border: "var(--bg-panel-border)",
  borderStrong: "var(--border-color)",
  text: "var(--text-primary)",
  text2: "var(--text-secondary)",
  muted: "var(--text-muted)",
  accent: "var(--accent)",
  lime: "var(--accent-lime)",
  red: "var(--accent-red)",
  soft: "var(--accent-soft)",
  racing: "var(--font-racing)",
} as const;
