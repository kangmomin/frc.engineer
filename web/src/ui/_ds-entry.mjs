// design-sync 번들 엔트리. esbuild가 이 파일을 IIFE(window.MinmoPitwallUI)로 번들한다.
// 토큰/폰트 CSS를 전역으로 주입(외부 @import는 esbuild가 _ds_bundle.css 최상단으로 hoist)하고,
// ui 배럴의 컴포넌트를 그대로 re-export한다.
// SPA 런타임 그래프에는 포함되지 않는다(앱이 이 파일을 import하지 않음).
import './_ds-tokens.css';

export * from './index';
