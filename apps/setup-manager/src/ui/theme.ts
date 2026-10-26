// PitHub(web/src/hub) 팔레트를 그대로 쓴다. 색 값의 원본은 hub theme.ts의 buildTheme이고,
// 여기서는 그 결과를 :root CSS 변수(--bg, --panel, --t1, --acc …)로 펼치기만 한다.
import { buildTheme } from "../../../../web/src/hub/theme";

export const HUB_THEME = buildTheme("#e0a83d", "light");

export function applyHubTheme(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(HUB_THEME)) {
    if (typeof value === "string") root.style.setProperty(`--${key}`, value);
  }
}
