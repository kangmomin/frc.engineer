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
import { getSessionToken } from './session';

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

export type FeedbackCategory = 'bug' | 'suggestion' | 'other';

// One of the caller's own feedback rows (GET /me/feedback).
export interface PlatformFeedbackEntry {
  id: string;
  category: FeedbackCategory;
  body: string;
  status: string; // 'open' | 'in_progress' | 'resolved' | 'dismissed'
  createdAt: string;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  body: string;
}

// ListingError carries a coarse, user-facing reason so the sell modal can show a
// Korean message without re-deriving it from a raw status code.
export type ListingErrorReason =
  | 'unauthorized'
  | 'conflict'
  | 'not-sellable'
  | 'not-found'
  | 'bad-input'
  | 'rate-limited'
  | 'network';

export class ListingError extends Error {
  constructor(readonly reason: ListingErrorReason, message: string) {
    super(message);
    this.name = 'ListingError';
  }
}

async function pfetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isPlatformConfigured()) {
    throw new ListingError('network', '플랫폼이 구성되지 않았습니다');
  }
  const token = getSessionToken();
  if (!token) {
    throw new ListingError('unauthorized', '로그인이 필요합니다');
  }
  try {
    return await fetch(getPlatformUrl(path), {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ListingError('network', '네트워크 오류');
  }
}

// pfetchOpen is for public GETs (browse, reviews list): it attaches the Bearer
// token when present but does not require one.
async function pfetchOpen(path: string): Promise<Response> {
  if (!isPlatformConfigured()) {
    throw new ListingError('network', '플랫폼이 구성되지 않았습니다');
  }
  const token = getSessionToken();
  try {
    return await fetch(getPlatformUrl(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ListingError('network', '네트워크 오류');
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

// PlatformMarket is a thin, stateless client. Callers own loading/error UI state.
export class PlatformMarket {
  // --- Leaderboards (public; attach viewer token for the `you` highlight) ---

  async leaderboardTT(trackId: number, format: string): Promise<PlatformTTRow[]> {
    const res = await pfetchOpen(`/leaderboards/tt?track=${trackId}&format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '타임트라이얼 리더보드');
  }

  async leaderboardPace(trackId: number, format: string): Promise<PlatformPaceRow[]> {
    const res = await pfetchOpen(`/leaderboards/pace?track=${trackId}&format=${encodeURIComponent(format)}`);
    if (res.status === 400) return [];
    return okJson(res, '레이스 페이스 리더보드');
  }

  async listMyRaces(): Promise<PlatformSellableRace[]> {
    return okJson(await pfetch('/me/races'), '내 레이스');
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
    const res = await pfetch(`/listings/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new ListingError('not-found', '리스팅을 찾을 수 없습니다');
    }
    return okJson(res, '리스팅 상세');
  }

  async getSimilar(id: string): Promise<PlatformListingCard[]> {
    const res = await pfetch(`/listings/${encodeURIComponent(id)}/similar`);
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

  async getWallet(): Promise<number> {
    const body = await okJson<{ balance: number }>(await pfetch('/wallet'), '지갑');
    return body.balance;
  }

  async getLedger(): Promise<PlatformLedgerEntry[]> {
    return okJson(await pfetch('/ledger'), '원장');
  }

  // browse lists active listings of a kind by track+format (public). A missing
  // track/format is a 400 → treated as empty.
  async browse(kind: ListingKind, trackId: number, format: string): Promise<PlatformListingCard[]> {
    const path = kind === 'setup' ? '/market/setups' : '/market/strategies';
    const res = await pfetchOpen(`${path}?track=${trackId}&format=${encodeURIComponent(format)}`);
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
    const res = await pfetchOpen(`/listings/${encodeURIComponent(listingId)}/reviews`);
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
}

// isStintPayload narrows an owner payload to a strategy stint array.
export function isStintPayload(
  payload: PlatformListingDetail['payload'],
): payload is PlatformStint[] {
  return Array.isArray(payload);
}
