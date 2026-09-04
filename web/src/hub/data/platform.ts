// Hosted platform client (cmd/platform). Covers the full marketplace + economy
// vertical — public leaderboards, browse/buy/review, and the seller flow (list
// one of your own plausible races, view the owner-only payload, find similar,
// delist) — plus the credit wallet/ledger.
//
// Auth is the Bearer token from session.ts. Public GETs (leaderboards, browse,
// reviews) attach it when present for the `you`/owner view but don't require it;
// mutating and owner calls do. This layer only shapes requests and maps status
// codes to user-facing outcomes.
import { getPlatformUrl, isPlatformConfigured } from './platformBase';
import { getActiveSessionToken, getViewAsToken, notifySessionUnauthorized } from './session';
import type { IncidentReplay, RaceAnalysisDetail, RaceAnalysisListResponse } from './raceAnalysisTypes';

export type ListingKind = 'setup' | 'strategy';

// One of the caller's own plausible races, offered by the sell picker. hasSetup
// gates setup listings; lapCount ≥ 5 gates strategy listings (server also checks).
export interface PlatformSellableRace {
  sourceRaceId: string;
  trackId: number;
  trackName: string;
  gameFormat: string;
  bestLapMs: number | null;
  hasSetup: boolean;
  lapCount: number;
}

// A public/owner listing card — never carries payload or content_hash.
// rating/reviewCount are public review aggregates (0 when a listing has none).
export interface PlatformListingCard {
  id: string;
  kind: ListingKind;
  title: string;
  sellerPersona: string;
  trackId: number;
  gameFormat: string;
  priceCredits: number;
  status: string; // 'active' | 'delisted'
  createdAt: string;
  rating: number;
  reviewCount: number;
}

// Public global-search response. Setup cards use the complete public listing
// shape so selecting one can open the existing buyer modal without refetching.
export interface PlatformDriverSearchHit {
  accountId: string;
  persona: string;
  trackId: number;
  gameFormat: string;
}
export interface PlatformSearchResponse {
  setups: PlatformListingCard[];
  drivers: PlatformDriverSearchHit[];
}

export interface PlatformDriverProfileTimeTrial {
  rank: number;
  participants: number;
  lapMs: number;
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
}

export interface PlatformDriverProfileRacePace {
  rank: number;
  participants: number;
  avgMs: number;
  laps: number;
  consistency: number;
  tyre: string;
}

export interface PlatformDriverProfileTrack {
  trackId: number;
  trackName: string;
  gameFormat: string;
  timeTrial: PlatformDriverProfileTimeTrial;
  racePace: PlatformDriverProfileRacePace | null;
}

export interface PlatformDriverProfile {
  accountId: string;
  persona: string;
  avatarUrl: string;
  verified: boolean;
  summary: {
    verifiedRaces: number;
    validLaps: number;
    trackFormats: number;
  };
  tracks: PlatformDriverProfileTrack[];
}

// Owner detail: a card plus the revealed product. payload is the setup params
// object (setup) or the stint array (strategy); present only when owned.
export interface PlatformSetupParam {
  frontWing?: number;
  rearWing?: number;
  [k: string]: number | undefined;
}
export interface PlatformStint {
  compound: string;
  laps: number;
}
export interface PlatformListingDetail extends PlatformListingCard {
  owned: boolean;
  payload: PlatformSetupParam | PlatformStint[] | null;
}

export interface CreateListingInput {
  kind: ListingKind;
  sourceRaceId: string;
  title: string;
  priceCredits: number;
}

// One append-only ledger row from the caller's perspective.
export interface PlatformLedgerEntry {
  kind: string; // grant | purchase | sale | fee | sink_unlock
  amount: number; // signed
  ref: string;
  createdAt: string;
}

// Purchase outcome: the unlocked product plus settlement details.
export interface PlatformPurchaseResult {
  purchaseId: string;
  kind: ListingKind;
  price: number;
  fee: number;
  payload: PlatformSetupParam | PlatformStint[] | null;
  alreadyOwned: boolean;
}

// A fixed 5-axis 0..100 performance vote.
export interface PlatformReviewPerf {
  downforce: number;
  topSpeed: number;
  cornering: number;
  tyre: number;
  response: number;
}
export interface PlatformReview {
  author: string;
  stars: number;
  perf: PlatformReviewPerf;
  body: string;
  createdAt: string;
}
export interface CreateReviewInput {
  stars: number;
  perf: PlatformReviewPerf;
  body: string;
}

// One Time Trial leaderboard row (GET /leaderboards/tt). Public; `you` is set
// only when the request carries the viewer's Bearer token.
export interface PlatformTTRow {
  rank: number;
  accountId: string;
  persona: string;
  lapMs: number;
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
  you: boolean;
}

// One Race Pace leaderboard row (GET /leaderboards/pace). tyre is a raw backend
// compound ("Soft"/"Medium"/"Hard"/"Inter"/"Wet"/""), mapped to a label in the UI.
export interface PlatformPaceRow {
  rank: number;
  accountId: string;
  persona: string;
  avgMs: number;
  laps: number;
  consistency: number; // 0..1
  tyre: string;
  you: boolean;
}

// One measured pit-loss average row (GET /tracks/{id}/pit-loss). stopType is
// classified server-side from stationary time: 'tyres' | 'wing' | 'unknown'.
export interface PlatformPitLossRow {
  stopType: string;
  avgLaneMs: number; // mean pit-lane dwell (travel + stationary), ms
  avgStatMs: number; // mean stationary (box work) time, ms
  samples: number;
}

export type FeedbackCategory = 'bug' | 'suggestion' | 'other';
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';

// One of the caller's own feedback rows (GET /me/feedback).
export interface PlatformFeedbackEntry {
  id: string;
  category: FeedbackCategory;
  body: string;
  status: FeedbackStatus;
  createdAt: string;
}

// My Setups is an owner-only history surface. It deliberately has its own
// payload types rather than reusing marketplace payloads: the server never
// exposes a content hash or an equality oracle to the browser.
export interface PlatformMySetupParams {
  frontWing: number;
  rearWing: number;
  onThrottle: number;
  offThrottle: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  frontSuspension: number;
  rearSuspension: number;
  frontAntiRollBar: number;
  rearAntiRollBar: number;
  frontSuspensionHeight: number;
  rearSuspensionHeight: number;
  brakePressure: number;
  brakeBias: number;
  engineBraking: number;
  rearLeftTyrePressure: number;
  rearRightTyrePressure: number;
  frontLeftTyrePressure: number;
  frontRightTyrePressure: number;
  ballast: number;
  fuelLoad: number;
}

export interface PlatformMySetupSummary {
  id: string;
  name: string;
  rating: number | null;
  memo: string;
  params: PlatformMySetupParams;
  usageCount: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  lastTrackId: number;
  lastTrackName: string;
  lastGameFormat: string;
}

export interface PlatformMySetupRace {
  id: string;
  recordedAt: string | null;
  trackId: number;
  trackName: string;
  gameFormat: string;
  sessionType: string;
  finishPosition: number | null;
  completedLaps: number | null;
  bestLapMs: number | null;
}

export interface PlatformMySetupDetail extends PlatformMySetupSummary {
  races: PlatformMySetupRace[];
}

export interface UpdateMySetupInput {
  name: string;
  rating: number | null;
  memo: string;
}

export interface UpdateMySetupResult extends UpdateMySetupInput {
  updatedAt: string;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  body: string;
}

// 분석 리포트 메타 (GET /analysis — 본문 html은 목록에 실리지 않는다).
export interface PlatformAnalysisMeta {
  id: string;
  sessionUid?: string;
  trackName?: string;
  title: string;
  createdAt: string;
}

// 분석 리포트 전체 (GET /analysis/{id}). html은 신뢰 불가 문서로 취급 —
// 반드시 sandbox iframe(srcDoc)으로만 렌더한다.
export interface PlatformAnalysisDoc extends PlatformAnalysisMeta {
  html: string;
}

// RBAC 관리 (GET /rbac/roles). permissions는 그랜트 노드 원본(임의 깊이) —
// 계층 매칭은 data/permissions.ts의 hasPermission으로 한다.
export interface PlatformRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  createdAt: string;
}

// 계정 피커 한 행 (GET /rbac/accounts?q=).
export interface PlatformAccountRoles {
  id: string;
  persona: string;
  avatarUrl?: string;
  kind: string;
  banned: boolean;
  roles: string[];
}

export interface PlatformWallet {
  balance: number;
  initialized: boolean;
}

// ListingError carries a coarse, user-facing reason so the sell modal can show a
// Korean message without re-deriving it from a raw status code.
export type ListingErrorReason =
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'not-sellable'
  | 'not-found'
  | 'bad-input'
  | 'rate-limited'
  | 'view-as-read-only'
  | 'network';

export class ListingError extends Error {
  constructor(readonly reason: ListingErrorReason, message: string) {
    super(message);
    this.name = 'ListingError';
  }
}

// Owner race-analysis screens need the actual HTTP outcome to decide whether
// to retain surrounding data, refresh a disappeared race, or clear private
// state. Keep this distinct from the older marketplace's coarse errors.
export type RaceAnalysisErrorReason = 'unauthorized' | 'forbidden' | 'not-found' | 'bad-input' | 'network';

export class RaceAnalysisError extends Error {
  constructor(
    readonly status: number,
    readonly reason: RaceAnalysisErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'RaceAnalysisError';
  }
}

export interface RaceAnalysisListOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

async function pfetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isPlatformConfigured()) {
    throw new ListingError('network', '플랫폼이 구성되지 않았습니다');
  }
  const token = getActiveSessionToken();
  if (!token) {
    throw new ListingError('unauthorized', '로그인이 필요합니다');
  }
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && getViewAsToken()) {
    throw new ListingError('view-as-read-only', 'View As는 읽기 전용입니다');
  }
  try {
    const res = await fetch(getPlatformUrl(path), {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) notifySessionUnauthorized(token);
    return res;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError') {
      throw error;
    }
    throw new ListingError('network', '네트워크 오류');
  }
}

// Strict-viewer reads may be anonymous, but an available token must be sent and
// a rejected token must remain a 401 (never silently downgrade to anonymous).
async function pfetchViewer(path: string, init?: RequestInit): Promise<Response> {
  if (!isPlatformConfigured()) {
    throw new ListingError('network', '플랫폼이 구성되지 않았습니다');
  }
  const token = getActiveSessionToken();
  try {
    const res = await fetch(getPlatformUrl(path), {
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401 && token) notifySessionUnauthorized(token);
    return res;
  } catch {
    throw new ListingError('network', '네트워크 오류');
  }
}

// Privacy-independent public reads never carry either identity token.
async function pfetchAnonymous(path: string, init?: RequestInit): Promise<Response> {
  if (!isPlatformConfigured()) throw new ListingError('network', '플랫폼이 구성되지 않았습니다');
  try {
    return await fetch(getPlatformUrl(path), { ...init, headers: { ...(init?.headers ?? {}) } });
  } catch {
    throw new ListingError('network', '네트워크 오류');
  }
}

// PlatformSearch mirrors GET /search. It is intentionally separate from the
// authenticated market client: global search is public and can be used before
// login, while still forwarding cancellation to fetch.
export class PlatformSearch {
  async search(query: string, signal?: AbortSignal): Promise<PlatformSearchResponse> {
    const q = query.trim();
    const res = await pfetchAnonymous(`/search?q=${encodeURIComponent(q)}`, { signal });
    if (res.status === 400) {
      throw new ListingError('bad-input', '검색어는 2자 이상이어야 합니다');
    }
    return okJson<PlatformSearchResponse>(res, '검색');
  }
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    throw new ListingError('unauthorized', '로그인이 필요합니다');
  }
  if (!res.ok) {
    throw new ListingError('network', `${what} 실패 (${res.status})`);
  }
  return (await res.json()) as T;
}

function raceAnalysisErrorForStatus(status: number, what: string): RaceAnalysisError {
  switch (status) {
    case 400:
      return new RaceAnalysisError(status, 'bad-input', `${what} 입력이 올바르지 않습니다`);
    case 401:
      return new RaceAnalysisError(status, 'unauthorized', '로그인이 필요합니다');
    case 403:
      return new RaceAnalysisError(status, 'forbidden', '레이스 분석을 볼 권한이 없습니다');
    case 404:
      return new RaceAnalysisError(status, 'not-found', '레이스 분석을 찾을 수 없습니다');
    default:
      return new RaceAnalysisError(status, 'network', `${what} 실패 (${status})`);
  }
}

async function ownerRaceAnalysisJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    const response = await pfetch(path, { cache: 'no-store', signal });
    if (response.status !== 200) throw raceAnalysisErrorForStatus(response.status, '레이스 분석 조회');
    return (await response.json()) as T;
  } catch (error: unknown) {
    if (error instanceof RaceAnalysisError) throw error;
    if (error instanceof ListingError) {
      const status = error.reason === 'unauthorized' ? 401 : error.reason === 'view-as-read-only' ? 403 : 0;
      const reason: RaceAnalysisErrorReason = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'network';
      throw new RaceAnalysisError(status, reason, error.message);
    }
    // pfetch intentionally preserves cancellation for selection changes.
    if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError') throw error;
    throw new RaceAnalysisError(0, 'network', '네트워크 오류');
  }
}

// PlatformMarket is a thin, stateless client. Callers own loading/error UI state.
export class PlatformMarket {
  async getDriverProfile(accountId: string, signal?: AbortSignal): Promise<PlatformDriverProfile> {
    const res = await pfetch(`/profiles/${encodeURIComponent(accountId)}`, { cache: 'no-store', signal });
    switch (res.status) {
      case 200:
        return (await res.json()) as PlatformDriverProfile;
      case 401:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 403:
        throw new ListingError('forbidden', '프로필을 볼 권한이 없습니다');
      case 404:
        throw new ListingError('not-found', '드라이버 프로필을 찾을 수 없습니다');
      default:
        throw new ListingError('network', `프로필 조회 실패 (${res.status})`);
    }
  }

  // --- Leaderboards (public; attach viewer token for the `you` highlight) ---

  async leaderboardTT(trackId: number, format: string): Promise<PlatformTTRow[]> {
    const res = await pfetchViewer(`/leaderboards/tt?track=${trackId}&format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '타임트라이얼 리더보드');
  }

  async leaderboardPace(trackId: number, format: string): Promise<PlatformPaceRow[]> {
    const res = await pfetchViewer(`/leaderboards/pace?track=${trackId}&format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '레이스 페이스 리더보드');
  }

  // Measured pit-loss averages for a track, split by stop type (public).
  async pitLoss(trackId: number, format: string): Promise<PlatformPitLossRow[]> {
    const res = await pfetchAnonymous(`/tracks/${trackId}/pit-loss?format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '피트로스 평균');
  }

  async listMyRaces(): Promise<PlatformSellableRace[]> {
    return okJson(await pfetch('/me/races'), '내 레이스');
  }

  // --- Owner race analysis (no HTML document or client-side cache) ---

  async listRaceAnalyses(): Promise<RaceAnalysisListResponse>;
  async listRaceAnalyses(options: RaceAnalysisListOptions): Promise<RaceAnalysisListResponse>;
  async listRaceAnalyses(limit: number, offset?: number, signal?: AbortSignal): Promise<RaceAnalysisListResponse>;
  async listRaceAnalyses(
    optionsOrLimit: RaceAnalysisListOptions | number = {},
    positionalOffset = 0,
    positionalSignal?: AbortSignal,
  ): Promise<RaceAnalysisListResponse> {
    const options = typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit, offset: positionalOffset, signal: positionalSignal }
      : optionsOrLimit;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    return ownerRaceAnalysisJson<RaceAnalysisListResponse>(
      `/me/race-analyses?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`,
      options.signal,
    );
  }

  async getRaceAnalysis(raceId: string, signal?: AbortSignal): Promise<RaceAnalysisDetail> {
    return ownerRaceAnalysisJson<RaceAnalysisDetail>(`/me/race-analyses/${encodeURIComponent(raceId)}`, signal);
  }

  async getRaceAnalysisIncident(raceId: string, index: number, signal?: AbortSignal): Promise<IncidentReplay> {
    return ownerRaceAnalysisJson<IncidentReplay>(
      `/me/race-analyses/${encodeURIComponent(raceId)}/incidents/${encodeURIComponent(String(index))}`,
      signal,
    );
  }

  // --- My Setups (owner-only history) ---

  async listMySetups(): Promise<PlatformMySetupSummary[]> {
    const res = await pfetch('/me/setups', { cache: 'no-store' });
    return mySetupsJson<PlatformMySetupSummary[]>(res, '셋업 목록');
  }

  async getMySetup(id: string): Promise<PlatformMySetupDetail> {
    const res = await pfetch(`/me/setups/${encodeURIComponent(id)}`, { cache: 'no-store' });
    return mySetupsJson<PlatformMySetupDetail>(res, '셋업 상세');
  }

  async updateMySetup(id: string, input: UpdateMySetupInput): Promise<UpdateMySetupResult> {
    const res = await pfetch(`/me/setups/${encodeURIComponent(id)}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return mySetupsJson<UpdateMySetupResult>(res, '셋업 저장');
  }

  async listMyListings(): Promise<PlatformListingCard[]> {
    return okJson(await pfetch('/me/listings'), '내 리스팅');
  }

  async createListing(input: CreateListingInput): Promise<string> {
    const res = await pfetch('/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    switch (res.status) {
      case 201:
        return ((await res.json()) as { listingId: string }).listingId;
      case 400:
        throw new ListingError('bad-input', '입력이 올바르지 않습니다');
      case 401:
      case 403:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 404:
        throw new ListingError('not-found', '레이스를 찾을 수 없습니다');
      case 409:
        throw new ListingError('conflict', '이미 등록된 레이스입니다');
      case 422:
        throw new ListingError('not-sellable', '판매할 수 없는 레이스입니다 (셋업/스틴트 부족)');
      case 429:
        throw new ListingError('rate-limited', '잠시 후 다시 시도하세요');
      default:
        throw new ListingError('network', `등록 실패 (${res.status})`);
    }
  }

  // getListing returns owner detail. As the seller, the backend reveals the
  // payload; as anyone else it 404s a delisted/banned listing.
  async getListing(id: string): Promise<PlatformListingDetail> {
    const res = await pfetchViewer(`/listings/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new ListingError('not-found', '리스팅을 찾을 수 없습니다');
    }
    return okJson(res, '리스팅 상세');
  }

  async getSimilar(id: string): Promise<PlatformListingCard[]> {
    const res = await pfetchAnonymous(`/listings/${encodeURIComponent(id)}/similar`);
    if (res.status === 404) return [];
    return okJson(res, '유사 리스팅');
  }

  async delist(id: string): Promise<void> {
    const res = await pfetch(`/listings/${encodeURIComponent(id)}/delist`, { method: 'POST' });
    if (res.status === 204) return;
    if (res.status === 404) {
      throw new ListingError('not-found', '이미 내려간 리스팅입니다');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ListingError('unauthorized', '로그인이 필요합니다');
    }
    throw new ListingError('network', `내리기 실패 (${res.status})`);
  }

  // --- Phase 3D1 economy ---

  async getWallet(): Promise<PlatformWallet> {
    return okJson<PlatformWallet>(await pfetch('/wallet'), '지갑');
  }

  async getLedger(): Promise<PlatformLedgerEntry[]> {
    return okJson(await pfetch('/ledger'), '원장');
  }

  // browse lists active listings of a kind by track+format (public). A missing
  // track/format is a 400 → treated as empty.
  async browse(kind: ListingKind, trackId: number, format: string): Promise<PlatformListingCard[]> {
    const path = kind === 'setup' ? '/market/setups' : '/market/strategies';
    const res = await pfetchAnonymous(`${path}?track=${trackId}&format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '거래소');
  }

  async purchase(listingId: string): Promise<PlatformPurchaseResult> {
    const res = await pfetch(`/listings/${encodeURIComponent(listingId)}/purchase`, { method: 'POST' });
    switch (res.status) {
      case 200:
        return (await res.json()) as PlatformPurchaseResult;
      case 401:
      case 403:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 402:
        throw new ListingError('bad-input', '크레딧이 부족합니다');
      case 404:
        throw new ListingError('not-found', '리스팅을 찾을 수 없습니다');
      case 409:
        throw new ListingError('conflict', '구매 처리 중입니다 — 다시 시도하세요');
      case 422:
        throw new ListingError('not-sellable', '본인 리스팅은 구매할 수 없습니다');
      case 429:
        throw new ListingError('rate-limited', '잠시 후 다시 시도하세요');
      default:
        throw new ListingError('network', `구매 실패 (${res.status})`);
    }
  }

  async listReviews(listingId: string): Promise<PlatformReview[]> {
    const res = await pfetchAnonymous(`/listings/${encodeURIComponent(listingId)}/reviews`);
    if (res.status === 404) return [];
    return okJson(res, '리뷰');
  }

  async createReview(listingId: string, input: CreateReviewInput): Promise<void> {
    const res = await pfetch(`/listings/${encodeURIComponent(listingId)}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    switch (res.status) {
      case 201:
        return;
      case 400:
        throw new ListingError('bad-input', '입력이 올바르지 않습니다');
      case 401:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 403:
        throw new ListingError('not-sellable', '구매한 사용자만 리뷰할 수 있습니다');
      case 409:
        throw new ListingError('conflict', '이미 리뷰를 남겼습니다');
      case 429:
        throw new ListingError('rate-limited', '잠시 후 다시 시도하세요');
      default:
        throw new ListingError('network', `리뷰 실패 (${res.status})`);
    }
  }

  // --- Feedback ---

  async submitFeedback(input: CreateFeedbackInput): Promise<string> {
    const res = await pfetch('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    switch (res.status) {
      case 201:
        return ((await res.json()) as { feedbackId: string }).feedbackId;
      case 400:
        throw new ListingError('bad-input', '입력이 올바르지 않습니다');
      case 401:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 403:
        throw new ListingError('unauthorized', '권한이 없습니다');
      case 429:
        throw new ListingError('rate-limited', '잠시 후 다시 시도하세요');
      default:
        throw new ListingError('network', `의견 전송 실패 (${res.status})`);
    }
  }

  async listMyFeedback(): Promise<PlatformFeedbackEntry[]> {
    return okJson(await pfetch('/me/feedback'), '내 의견');
  }

  // Inbox rows intentionally carry no submitter identity. Keep the status
  // mapping explicit: callers need distinct login, authorization, and retry UI.
  async listFeedbackInbox(): Promise<PlatformFeedbackEntry[]> {
    const res = await pfetch('/feedback-inbox', { cache: 'no-store' });
    switch (res.status) {
      case 200:
        return (await res.json()) as PlatformFeedbackEntry[];
      case 401:
        throw new ListingError('unauthorized', '로그인이 필요합니다');
      case 403:
        throw new ListingError('forbidden', '피드백 인박스를 볼 권한이 없습니다');
      default:
        throw new ListingError('network', `피드백 인박스 조회 실패 (${res.status})`);
    }
  }

  // --- Analysis reports (admin 전용 — 서버가 env 허용목록으로 게이트) ---

  async listAnalyses(): Promise<PlatformAnalysisMeta[]> {
    return okJson(await pfetch('/analysis'), '분석 리포트 목록');
  }

  async getAnalysis(id: string): Promise<PlatformAnalysisDoc> {
    const res = await pfetch(`/analysis/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new ListingError('not-found', '리포트를 찾을 수 없습니다');
    }
    return okJson(res, '분석 리포트');
  }

  async deleteAnalysis(id: string): Promise<void> {
    const res = await pfetch(`/analysis/${encodeURIComponent(id)}/delete`, { method: 'POST' });
    if (res.status === 204) return;
    if (res.status === 404) {
      throw new ListingError('not-found', '이미 삭제된 리포트입니다');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ListingError('unauthorized', '권한이 없습니다');
    }
    throw new ListingError('network', `삭제 실패 (${res.status})`);
  }

  // --- RBAC 관리 (pithub.rbac.* — 서버가 게이트한다) ---
  // 변경 계열은 전부 치환(replace) semantics다: 보낸 배열이 곧 전체가 된다.
  // 화면이 체크박스로 현재 상태를 통째로 보내는 이유가 이것이다.

  async listRoles(): Promise<PlatformRole[]> {
    return okJson(await pfetch('/rbac/roles'), 'Role 목록');
  }

  async listPermissionCatalog(): Promise<string[]> {
    return okJson(await pfetch('/rbac/permissions'), '권한 카탈로그');
  }

  async searchAccounts(q: string): Promise<PlatformAccountRoles[]> {
    return okJson(await pfetch(`/rbac/accounts?q=${encodeURIComponent(q)}`), '계정 검색');
  }

  async createRole(name: string, description: string): Promise<string> {
    const res = await pfetch('/rbac/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    switch (res.status) {
      case 201:
        return ((await res.json()) as { roleId: string }).roleId;
      case 400:
        throw new ListingError('bad-input', 'Role 이름이 올바르지 않습니다 (소문자·숫자·하이픈, 32자 이내)');
      case 409:
        throw new ListingError('conflict', '이미 있는 Role입니다');
      case 401:
      case 403:
        throw new ListingError('unauthorized', '권한이 없습니다');
      case 429:
        throw new ListingError('rate-limited', '잠시 후 다시 시도하세요');
      default:
        throw new ListingError('network', `Role 생성 실패 (${res.status})`);
    }
  }

  async deleteRole(name: string): Promise<void> {
    const res = await pfetch(`/rbac/roles/${encodeURIComponent(name)}/delete`, { method: 'POST' });
    if (res.status === 204) return;
    if (res.status === 403) {
      throw new ListingError('unauthorized', '시드 Role은 삭제할 수 없습니다');
    }
    if (res.status === 404) {
      throw new ListingError('not-found', '이미 없는 Role입니다');
    }
    throw new ListingError('network', `Role 삭제 실패 (${res.status})`);
  }

  async setRolePermissions(name: string, permissions: string[]): Promise<void> {
    const res = await pfetch(`/rbac/roles/${encodeURIComponent(name)}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
    });
    if (res.status === 204) return;
    throw rbacMutationError(res.status, '권한 저장');
  }

  async setAccountRoles(accountId: string, roles: string[]): Promise<void> {
    const res = await pfetch(`/rbac/accounts/${encodeURIComponent(accountId)}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles }),
    });
    if (res.status === 204) return;
    throw rbacMutationError(res.status, 'Role 할당');
  }
}

// My Setups needs a finer status distinction than okJson: GET 403 is a read
// permission problem, while POST 403 leaves the user's draft intact as a
// read-only account. Keep this mapping local to the owner API contract.
async function mySetupsJson<T>(res: Response, what: string): Promise<T> {
  switch (res.status) {
    case 200:
      return (await res.json()) as T;
    case 400:
      throw new ListingError('bad-input', '입력이 올바르지 않습니다');
    case 401:
      throw new ListingError('unauthorized', '로그인이 필요합니다');
    case 403:
      throw new ListingError('forbidden', 'My Setups 권한이 없습니다');
    case 404:
      throw new ListingError('not-found', '셋업을 찾을 수 없습니다');
    default:
      throw new ListingError('network', `${what} 실패 (${res.status})`);
  }
}

// rbacMutationError maps the shared 204/400/401/403/404/429 shape of the /rbac
// replace endpoints onto a user-facing reason.
function rbacMutationError(status: number, what: string): ListingError {
  switch (status) {
    case 400:
      return new ListingError('bad-input', '알 수 없는 항목이 포함되어 있습니다');
    case 401:
    case 403:
      return new ListingError('unauthorized', '권한이 없습니다');
    case 404:
      return new ListingError('not-found', '대상을 찾을 수 없습니다');
    case 429:
      return new ListingError('rate-limited', '잠시 후 다시 시도하세요');
    default:
      return new ListingError('network', `${what} 실패 (${status})`);
  }
}

// isStintPayload narrows an owner payload to a strategy stint array.
export function isStintPayload(
  payload: PlatformListingDetail['payload'],
): payload is PlatformStint[] {
  return Array.isArray(payload);
}
