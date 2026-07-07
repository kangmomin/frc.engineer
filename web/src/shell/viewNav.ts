/**
 * 신규 shell의 뷰 네비게이션 유틸.
 * 3개 프론트 뷰(RACE/QUALI/WORLD FEED)를 서버가 인식하는 2개 setView 모드로 매핑한다.
 * (서버는 'cockpit'|'qualifying'만 인식 — internal/rtc/peer_manager.go)
 */

export type ViewId = 'pitwall' | 'qualifying' | 'broadcast';

/** 서버 setView가 수용하는 값. 'broadcast'가 wire로 새지 않도록 좁힌 union. */
export type SenderView = 'cockpit' | 'qualifying';

/** 기본 랜딩 뷰 (RACE). ?view= 파라미터 없을 때. */
export const DEFAULT_VIEW: ViewId = 'pitwall';

const VIEW_IDS: readonly ViewId[] = ['pitwall', 'qualifying', 'broadcast'];

export function isViewId(value: string | null): value is ViewId {
  return value !== null && (VIEW_IDS as readonly string[]).includes(value);
}

/** Broadcast·PitWall → 'cockpit', Qualifying → 'qualifying'. */
export function viewToSenderView(view: ViewId): SenderView {
  return view === 'qualifying' ? 'qualifying' : 'cockpit';
}

export function readInitialView(): ViewId {
  const view = new URLSearchParams(window.location.search).get('view');
  return isViewId(view) ? view : DEFAULT_VIEW;
}

export function persistView(view: ViewId): void {
  const params = new URLSearchParams(window.location.search);
  if (view === DEFAULT_VIEW) params.delete('view');
  else params.set('view', view);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}
