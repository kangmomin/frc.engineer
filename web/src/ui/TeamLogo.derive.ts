/**
 * 실제 로고 파일 드롭인. `src/assets/team-logos/<teamId>.svg`(또는 .png)를 넣으면
 * 그 팀만 인라인 마크 대신 진짜 로고로 그려진다 — 코드 수정 불필요.
 *
 * 런타임 <img onError> 폴백 대신 빌드타임 glob을 쓰는 이유: 존재 여부가 번들 시점에
 * 확정되므로 폴백 깜빡임과 헛요청이 없다. 게다가 web/public/_redirects의
 * `/*  /index.html  200` 캐치올 때문에 없는 경로도 200을 반환해 상태코드 기반
 * 존재 확인 자체가 불가능하다.
 */
const overrideModules = import.meta.glob('../assets/team-logos/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * glob 결과를 teamId → 로고 URL로 접는다. 같은 ID에 svg/png가 함께 있으면 svg가
 * 이긴다 — glob의 키 순서에 의존하지 않도록 양방향으로 성립하게 짠다.
 * (테스트를 위해 export; 런타임 호출은 아래 한 번뿐이다.)
 */
export function resolveLogoOverrides(modules: Record<string, string>): Record<string, string> {
  const byId: Record<string, string> = {};
  const isSvg: Record<string, boolean> = {};
  for (const [path, url] of Object.entries(modules)) {
    const match = /\/(\d+)\.(svg|png)$/.exec(path);
    if (!match) continue;
    const [, id, ext] = match;
    if (byId[id] !== undefined && (isSvg[id] || ext !== 'svg')) continue;
    byId[id] = url;
    isSvg[id] = ext === 'svg';
  }
  return byId;
}

/** teamId(문자열) → 로고 URL. 파일이 하나도 없으면 빈 객체. */
export const LOGO_OVERRIDES = resolveLogoOverrides(overrideModules);
