// MarketManage — the real Phase 3C/3D1 marketplace vertical, rendered above the
// mock browse grid on the Market screen. A logged-in user:
//  - sells one of their own plausible races (3C),
//  - manages their listings (owner detail + delist, 3C),
//  - browses OTHER sellers' real listings, buys them (payload unlocks, 3D1), and
//    reviews what they bought (3D1).
// The mock showcase grid below stays untouched (its rich rating/perf come in a
// later slice); everything here talks to the hosted platform (cmd/platform).
import { useCallback, useEffect, useState } from 'react';
import type { HubTheme } from '../theme';
import { msToTimeShort } from '../format';
import {
  PlatformMarket, ListingError, isStintPayload,
  type PlatformSellableRace, type PlatformListingCard, type PlatformListingDetail,
  type PlatformReview, type PlatformReviewPerf, type ListingKind,
} from '../data/platform';
import type { PlatformAccount } from '../data/session';

const MONO = "'JetBrains Mono',monospace";
const MIN_STRATEGY_LAPS = 5; // mirrors the backend's minStrategyLaps gate
type Payload = PlatformListingDetail['payload'];

interface Props {
  t: HubTheme;
  configured: boolean;
  account: PlatformAccount | null;
  market: PlatformMarket;
  defaultKind: ListingKind;
  sellOpen: boolean;
  onCloseSell: () => void;
  onEconomyChange?: () => void; // called after a purchase so the wallet card refreshes
}

export function MarketManage(p: Props) {
  const { t, configured, account, market } = p;
  const [listings, setListings] = useState<PlatformListingCard[] | null>(null);
  const [detail, setDetail] = useState<{ card: PlatformListingDetail; similar: PlatformListingCard[] } | null>(null);
  const [buyer, setBuyer] = useState<PlatformListingCard | null>(null); // browsed listing being viewed
  const [purchased, setPurchased] = useState<Record<string, Payload>>({}); // listingId → unlocked payload (this session)
  const [note, setNote] = useState<string>('');

  const refresh = useCallback(() => {
    if (!account) return;
    market.listMyListings()
      .then((rows) => setListings(rows))
      .catch((e: unknown) => setNote(msgOf(e)));
  }, [account, market]);

  useEffect(() => {
    if (!configured || !account) { setListings(null); return; }
    refresh();
  }, [configured, account, refresh]);

  if (!configured) return null;

  if (!account) {
    return (
      <Bar t={t}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.06em', color: t.t2 }}>
          ◆ Steam 로그인 후 내 셋업·전략을 판매하고 다른 셋업을 구매할 수 있어요 — PROFILE에서 로그인
        </span>
      </Bar>
    );
  }

  const markPurchased = (id: string, payload: Payload) => {
    setPurchased((m) => ({ ...m, [id]: payload }));
    p.onEconomyChange?.();
  };

  return (
    <>
      <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>
            내 리스팅 · {account.persona}
          </span>
          <button onClick={refresh} style={ghostBtn(t)}>새로고침</button>
        </div>
        {note && <div style={{ fontSize: 11.5, color: t.t3, marginBottom: 8 }}>{note}</div>}
        {listings == null ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>불러오는 중…</div>
        ) : listings.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>아직 등록한 리스팅이 없습니다. 위 ‘＋ 판매’로 시작하세요.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {listings.map((c) => (
              <MyListingRow key={c.id} t={t} c={c}
                onOpen={() => openDetail(market, c.id, setDetail, setNote)}
                onDelist={() => doDelist(market, c.id, setNote, refresh)} />
            ))}
          </div>
        )}
      </div>

      <BuyerBrowse t={t} market={market} defaultKind={p.defaultKind}
        onOpen={setBuyer} onError={setNote} />

      {p.sellOpen && (
        <SellModal t={t} market={market} defaultKind={p.defaultKind}
          onClose={p.onCloseSell}
          onCreated={() => { p.onCloseSell(); refresh(); }} />
      )}

      {detail && <OwnerDetailModal t={t} data={detail} onClose={() => setDetail(null)} />}

      {buyer && (
        <BuyerDetailModal t={t} market={market} card={buyer}
          unlocked={purchased[buyer.id]}
          onPurchased={(payload) => markPurchased(buyer.id, payload)}
          onClose={() => setBuyer(null)} />
      )}
    </>
  );
}

// --- buyer browse (real listings) ---

function BuyerBrowse({ t, market, defaultKind, onOpen, onError }: {
  t: HubTheme; market: PlatformMarket; defaultKind: ListingKind;
  onOpen: (c: PlatformListingCard) => void; onError: (s: string) => void;
}) {
  const [kind, setKind] = useState<ListingKind>(defaultKind);
  const [track, setTrack] = useState('99');
  const [format, setFormat] = useState('F1 26');
  const [cards, setCards] = useState<PlatformListingCard[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = () => {
    const trackId = Number(track);
    if (!Number.isInteger(trackId)) { onError('트랙 번호가 올바르지 않습니다'); return; }
    setBusy(true);
    market.browse(kind, trackId, format.trim())
      .then((rows) => setCards(rows))
      .catch((e: unknown) => onError(msgOf(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600, marginBottom: 10 }}>거래소 · 실 리스팅 검색</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <KindTab t={t} on={kind === 'setup'} disabled={false} label="셋업" onClick={() => setKind('setup')} />
        <KindTab t={t} on={kind === 'strategy'} disabled={false} label="전략" onClick={() => setKind('strategy')} />
        <input value={track} onChange={(e) => setTrack(e.target.value.replace(/[^0-9]/g, ''))} placeholder="트랙 ID" inputMode="numeric"
          style={{ ...inputStyle(t), width: 90, marginBottom: 0 }} />
        <input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="포맷 (F1 26)"
          style={{ ...inputStyle(t), width: 130, marginBottom: 0 }} />
        <button onClick={search} disabled={busy} style={primaryBtn(t)}>{busy ? '검색 중…' : '찾기'}</button>
      </div>
      {cards == null ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>트랙·포맷으로 판매 중인 리스팅을 검색하세요.</div>
      ) : cards.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>해당 조건의 리스팅이 없습니다.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cards.map((c) => (
            <div key={c.id} onClick={() => onOpen(c)} className="hubCard"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, cursor: 'pointer' }}>
              <span style={kindChip(t)}>{c.kind === 'setup' ? '셋업' : '전략'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.t1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, color: t.t3, marginTop: 2 }}>{c.sellerPersona} · {c.gameFormat}</div>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: t.accInk }}>⬢ {c.priceCredits}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>상세 →</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BuyerDetailModal({ t, market, card, unlocked, onPurchased, onClose }: {
  t: HubTheme; market: PlatformMarket; card: PlatformListingCard;
  unlocked: Payload | undefined; onPurchased: (payload: Payload) => void; onClose: () => void;
}) {
  const [reviews, setReviews] = useState<PlatformReview[] | null>(null);
  const [payload, setPayload] = useState<Payload | undefined>(unlocked);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const owned = payload !== undefined;

  useEffect(() => { market.listReviews(card.id).then(setReviews).catch(() => setReviews([])); }, [market, card.id]);

  const buy = () => {
    setBusy(true); setErr('');
    market.purchase(card.id)
      .then((r) => { setPayload(r.payload); onPurchased(r.payload); })
      .catch((e: unknown) => setErr(msgOf(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Overlay onClose={onClose}>
      <div style={modalCard(t)} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: t.t1 }}>{card.title}</div>
          <button onClick={onClose} style={ghostBtn(t)}>닫기</button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3, marginTop: 4, marginBottom: 12 }}>
          {card.kind === 'setup' ? '셋업' : '전략'} · {card.sellerPersona} · {card.gameFormat} · TRK {card.trackId} · ⬢ {card.priceCredits}
        </div>

        <Label t={t}>{owned ? '공개된 값 (구매 완료)' : '잠김 · 구매 후 공개'}</Label>
        {owned ? <PayloadView t={t} payload={payload} /> : (
          <div style={{ height: 40, borderRadius: 7, border: `1px dashed ${t.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', color: t.t3, marginBottom: 12 }}>
            ••• LOCKED
          </div>
        )}

        {!owned && (
          <button onClick={buy} disabled={busy}
            style={{ ...primaryBtn(t), width: '100%', opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer', marginBottom: 4 }}>
            {busy ? '구매 중…' : `⬢ ${card.priceCredits} 구매 · 언락`}
          </button>
        )}
        {err && <div style={{ fontSize: 11.5, color: '#e0392b', margin: '6px 0' }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <Label t={t}>리뷰</Label>
          {reviews == null ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>불러오는 중…</div>
          ) : reviews.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>아직 리뷰가 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reviews.map((r, i) => (
                <div key={i} style={{ padding: '8px 10px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: t.t1 }}>{r.author}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.accInk }}>{'★'.repeat(r.stars)}</span>
                  </div>
                  {r.body && <div style={{ fontSize: 11.5, color: t.t2, marginTop: 4 }}>{r.body}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {owned && (
          <ReviewForm t={t} market={market} listingId={card.id}
            onDone={() => market.listReviews(card.id).then(setReviews).catch(() => { /* keep */ })} />
        )}
      </div>
    </Overlay>
  );
}

function ReviewForm({ t, market, listingId, onDone }: { t: HubTheme; market: PlatformMarket; listingId: string; onDone: () => void }) {
  const [stars, setStars] = useState(5);
  const [perf, setPerf] = useState<PlatformReviewPerf>({ downforce: 70, topSpeed: 70, cornering: 70, tyre: 70, response: 70 });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = () => {
    setBusy(true); setMsg('');
    market.createReview(listingId, { stars, perf, body: body.trim() })
      .then(() => { setMsg('리뷰가 등록되었습니다.'); setBody(''); onDone(); })
      .catch((e: unknown) => setMsg(msgOf(e)))
      .finally(() => setBusy(false));
  };

  const axes: Array<[keyof PlatformReviewPerf, string]> = [
    ['downforce', '다운포스'], ['topSpeed', '최고속'], ['cornering', '코너링'], ['tyre', '타이어'], ['response', '반응'],
  ];
  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${t.line}`, paddingTop: 12 }}>
      <Label t={t}>리뷰 작성 (구매 인증)</Label>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18, color: n <= stars ? t.accInk : t.line2, padding: 0 }}>★</button>
        ))}
      </div>
      {axes.map(([k, label]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: t.t3, width: 52 }}>{label}</span>
          <input type="range" min={0} max={100} value={perf[k]} onChange={(e) => setPerf((s) => ({ ...s, [k]: Number(e.target.value) }))} style={{ flex: 1 }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: t.t2, width: 26, textAlign: 'right' }}>{perf[k]}</span>
        </div>
      ))}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} placeholder="간단한 후기 (선택)"
        style={{ ...inputStyle(t), minHeight: 52, resize: 'vertical', marginTop: 6 }} />
      {msg && <div style={{ fontSize: 11.5, color: t.t2, marginBottom: 6 }}>{msg}</div>}
      <button onClick={submit} disabled={busy} style={{ ...primaryBtn(t), width: '100%', opacity: busy ? 0.5 : 1 }}>{busy ? '등록 중…' : '리뷰 등록'}</button>
    </div>
  );
}

function PayloadView({ t, payload }: { t: HubTheme; payload: Payload }) {
  if (payload && isStintPayload(payload)) {
    return (
      <div style={{ display: 'flex', gap: 2, height: 30, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
        {payload.map((st, i) => (
          <div key={i} style={{ flex: st.laps, background: t.inset, border: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: t.t1 }}>{st.compound}·{st.laps}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: t.line, border: `1px solid ${t.line}`, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
      {Object.entries(payload ?? {}).map(([k, v]) => (
        <div key={k} style={{ background: t.inset, padding: '8px 4px', textAlign: 'center' }}>
          <div style={{ fontFamily: MONO, fontSize: 7.5, color: t.t3 }}>{k}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.t1, marginTop: 2 }}>{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

// --- owner side (3C) ---

function MyListingRow({ t, c, onOpen, onDelist }: { t: HubTheme; c: PlatformListingCard; onOpen: () => void; onDelist: () => void }) {
  const active = c.status === 'active';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8 }}>
      <span style={kindChip(t)}>{c.kind === 'setup' ? '셋업' : '전략'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.t1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 9.5, color: t.t3, marginTop: 2 }}>{c.gameFormat} · TRK {c.trackId}</div>
      </div>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: t.accInk }}>⬢ {c.priceCredits}</span>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: active ? t.ok : t.t3 }}>{active ? 'ACTIVE' : 'DELISTED'}</span>
      <button onClick={onOpen} style={ghostBtn(t)}>상세</button>
      {active && <button onClick={onDelist} style={dangerBtn(t)}>내리기</button>}
    </div>
  );
}

function SellModal({ t, market, defaultKind, onClose, onCreated }: {
  t: HubTheme; market: PlatformMarket; defaultKind: ListingKind; onClose: () => void; onCreated: () => void;
}) {
  const [races, setRaces] = useState<PlatformSellableRace[] | null>(null);
  const [sel, setSel] = useState<string>('');
  const [kind, setKind] = useState<ListingKind>(defaultKind);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('100');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { market.listMyRaces().then(setRaces).catch((e: unknown) => setErr(msgOf(e))); }, [market]);

  const selRace = races?.find((r) => r.sourceRaceId === sel) ?? null;
  const canSetup = !!selRace?.hasSetup;
  const canStrategy = (selRace?.lapCount ?? 0) >= MIN_STRATEGY_LAPS;
  const kindOk = kind === 'setup' ? canSetup : canStrategy;
  const priceNum = Number(price);
  const priceOk = Number.isInteger(priceNum) && priceNum >= 1 && priceNum <= 1_000_000;
  const canSubmit = !!selRace && kindOk && title.trim() !== '' && priceOk && !busy;

  const submit = () => {
    if (!selRace) return;
    setBusy(true); setErr('');
    market.createListing({ kind, sourceRaceId: selRace.sourceRaceId, title: title.trim(), priceCredits: priceNum })
      .then(() => onCreated())
      .catch((e: unknown) => { setErr(msgOf(e)); setBusy(false); });
  };

  return (
    <Overlay onClose={onClose}>
      <div style={modalCard(t)} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.t1, marginBottom: 4 }}>내 기록 판매</div>
        <div style={{ fontSize: 11.5, color: t.t3, marginBottom: 14 }}>본인 plausible 레이스의 셋업/전략을 불변 스냅샷으로 등록합니다.</div>

        <Label t={t}>레이스 선택</Label>
        {races == null ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3, padding: '8px 0' }}>불러오는 중…</div>
        ) : races.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3, padding: '8px 0' }}>판매 가능한 레이스가 없습니다 (plausible 기록 필요).</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflow: 'auto', marginBottom: 12 }}>
            {races.map((r) => {
              const on = r.sourceRaceId === sel;
              return (
                <button key={r.sourceRaceId} onClick={() => setSel(r.sourceRaceId)}
                  style={{ textAlign: 'left', background: on ? t.accSoft : t.inset, border: `1px solid ${on ? t.accBorder : t.line}`, borderRadius: 8, padding: '9px 11px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: t.t1 }}>{r.trackName || `TRK ${r.trackId}`}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: t.t2 }}>{r.bestLapMs ? msToTimeShort(r.bestLapMs) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                    <EligChip t={t} on={r.hasSetup} label="셋업" />
                    <EligChip t={t} on={r.lapCount >= MIN_STRATEGY_LAPS} label={`전략 (${r.lapCount}L)`} />
                    <span style={{ fontFamily: MONO, fontSize: 9, color: t.t3 }}>{r.gameFormat}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <Label t={t}>종류</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <KindTab t={t} on={kind === 'setup'} disabled={!canSetup} label="셋업" onClick={() => setKind('setup')} />
          <KindTab t={t} on={kind === 'strategy'} disabled={!canStrategy} label="전략" onClick={() => setKind('strategy')} />
        </div>

        <Label t={t}>제목</Label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="예: Bahrain 퀄리 셋업" style={inputStyle(t)} />

        <Label t={t}>가격 (크레딧)</Label>
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" style={inputStyle(t)} />

        {err && <div style={{ fontSize: 11.5, color: '#e0392b', marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={ghostBtn(t)}>취소</button>
          <button onClick={submit} disabled={!canSubmit}
            style={{ ...primaryBtn(t), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {busy ? '등록 중…' : '판매 등록'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function OwnerDetailModal({ t, data, onClose }: { t: HubTheme; data: { card: PlatformListingDetail; similar: PlatformListingCard[] }; onClose: () => void }) {
  const { card, similar } = data;
  return (
    <Overlay onClose={onClose}>
      <div style={modalCard(t)} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: t.t1 }}>{card.title}</div>
          <button onClick={onClose} style={ghostBtn(t)}>닫기</button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3, marginTop: 4, marginBottom: 12 }}>
          {card.kind === 'setup' ? '셋업' : '전략'} · {card.gameFormat} · TRK {card.trackId} · ⬢ {card.priceCredits} · {card.status}
        </div>
        <Label t={t}>{card.owned ? '공개된 값 (소유자)' : '잠김'}</Label>
        {card.owned && card.payload ? <PayloadView t={t} payload={card.payload} /> : (
          <div style={{ height: 40, borderRadius: 7, border: `1px dashed ${t.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', color: t.t3, marginBottom: 12 }}>
            ••• LOCKED
          </div>
        )}
        <Label t={t}>유사 리스팅</Label>
        {similar.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>유사 항목 없음</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {similar.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 7 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: t.t1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: t.t2 }}>{s.sellerPersona}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.accInk }}>⬢ {s.priceCredits}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}

// --- shared helpers ---

function openDetail(
  market: PlatformMarket, id: string,
  setDetail: (d: { card: PlatformListingDetail; similar: PlatformListingCard[] } | null) => void,
  setNote: (s: string) => void,
) {
  Promise.all([market.getListing(id), market.getSimilar(id)])
    .then(([card, similar]) => setDetail({ card, similar }))
    .catch((e: unknown) => setNote(msgOf(e)));
}

function doDelist(market: PlatformMarket, id: string, setNote: (s: string) => void, refresh: () => void) {
  market.delist(id).then(refresh).catch((e: unknown) => setNote(msgOf(e)));
}

function msgOf(e: unknown): string {
  return e instanceof ListingError ? e.message : '오류가 발생했습니다';
}

function Bar({ t, children }: { t: HubTheme; children: React.ReactNode }) {
  return <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>{children}</div>;
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      {children}
    </div>
  );
}

function Label({ t, children }: { t: HubTheme; children: React.ReactNode }) {
  return <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', color: t.t3, marginBottom: 6, marginTop: 2 }}>{children}</div>;
}

function EligChip({ t, on, label }: { t: HubTheme; on: boolean; label: string }) {
  return <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.04em', color: on ? t.ok : t.t3, border: `1px solid ${on ? t.ok : t.line2}`, borderRadius: 4, padding: '1px 5px', opacity: on ? 1 : 0.6 }}>{on ? '✓ ' : ''}{label}</span>;
}

function KindTab({ t, on, disabled, label, onClick }: { t: HubTheme; on: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, padding: '7px 14px', border: 0, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', background: on ? t.acc : t.inset, color: on ? t.onAcc : t.t2, opacity: disabled ? 0.4 : 1 }}>
      {label}
    </button>
  );
}

function kindChip(t: HubTheme): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.accInk, background: t.accSoft, border: `1px solid ${t.accBorder}`, borderRadius: 4, padding: '2px 6px' };
}
function modalCard(t: HubTheme): React.CSSProperties {
  return { background: t.panel, border: `1px solid ${t.line}`, borderRadius: 14, padding: 22, width: 'min(480px,92vw)', maxHeight: '86vh', overflow: 'auto' };
}
function inputStyle(t: HubTheme): React.CSSProperties {
  return { width: '100%', boxSizing: 'border-box', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, padding: '9px 11px', fontSize: 13, color: t.t1, marginBottom: 4, fontFamily: 'inherit' };
}
function ghostBtn(t: HubTheme): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 10.5, fontWeight: 600, padding: '6px 11px', border: `1px solid ${t.line}`, borderRadius: 7, background: t.panel, color: t.t2, cursor: 'pointer' };
}
function dangerBtn(t: HubTheme): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 10.5, fontWeight: 600, padding: '6px 11px', border: `1px solid ${t.line2}`, borderRadius: 7, background: t.inset, color: '#e0392b', cursor: 'pointer' };
}
function primaryBtn(t: HubTheme): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: '9px 16px', border: 0, borderRadius: 8, background: t.acc, color: t.onAcc, cursor: 'pointer' };
}
