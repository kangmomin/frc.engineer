// Market screen — Setup + Strategy exchanges with similar-match panels
// (hub.dc.html:236-374).
import type { HubTheme } from '../theme';
import { teamColor } from '../theme';
import { condColor, msToTimeShort, signed } from '../format';
import { MiniRadar } from '../components/Radar';
import { avgPerf } from '../components/radar';
import type {
  HubMarketItem, HubSimilarSetup, HubStrategyItem, HubSimilarStrategy, HubReview, HubStint,
} from '../data/types';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  cat: 'setups' | 'strategy';
  onSetCat: (c: 'setups' | 'strategy') => void;
  setups: HubMarketItem[];
  setupSimilar: HubSimilarSetup[];
  strategies: HubStrategyItem[];
  strategySimilar: HubSimilarStrategy[];
  ownedMap: Record<string, boolean>;
  stratOwnedMap: Record<string, boolean>;
  myReviews: Record<string, HubReview[]>;
  onOpenSetup: (id: string) => void;
  onBuyStrategy: (id: string) => void;
}

export function Market(p: Props) {
  const { t, cat } = p;
  const setups = cat === 'setups';
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>{setups ? 'Setup Exchange' : 'Strategy Exchange'}</div>
          <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>
            {setups ? '유저 제작 셋업 · 불변 스냅샷 판매 · content_hash 검증 배지' : '크라우드소싱 레이스 전략 · valid 기록 기반 · 스틴트/피트 플랜'}
          </div>
        </div>
        <button style={{ background: t.acc, color: t.onAcc, border: 0, borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{setups ? '＋ 내 셋업 판매' : '＋ 내 전략 판매'}</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 9, padding: 4, width: 'fit-content' }}>
        <CatTab t={t} on={setups} label="셋업 · SETUPS" onClick={() => p.onSetCat('setups')} />
        <CatTab t={t} on={!setups} label="전략 · STRATEGY" onClick={() => p.onSetCat('strategy')} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <FilterPill t={t} label="ALL" active />
        <FilterPill t={t} label="DRY" />
        <FilterPill t={t} label="WET" />
        <FilterPill t={t} label="VERIFIED ✓" />
        <FilterPill t={t} label="SORT: 유사도 ▾" pushRight />
      </div>

      {setups ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
            {p.setups.map((c) => (
              <SetupCard key={c.id} t={t} c={c} owned={!!p.ownedMap[c.id]} myReviews={p.myReviews[c.id]} onOpen={() => p.onOpenSetup(c.id)} />
            ))}
          </div>
          <SetupSimilarPanel t={t} items={p.setupSimilar} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
            {p.strategies.map((g) => (
              <StrategyCard key={g.id} t={t} g={g} owned={!!p.stratOwnedMap[g.id]} onBuy={() => p.onBuyStrategy(g.id)} />
            ))}
          </div>
          <StrategySimilarPanel t={t} items={p.strategySimilar} />
        </div>
      )}
    </section>
  );
}

function SetupCard({ t, c, owned, myReviews, onOpen }: { t: HubTheme; c: HubMarketItem; owned: boolean; myReviews?: HubReview[]; onOpen: () => void }) {
  const listed = c.priceCredits != null;
  const perf = avgPerf([...(myReviews ?? []), ...c.reviews]) ?? c.perf;
  return (
    <div className="hubCard" onClick={onOpen} style={{ background: t.panel, border: `1px solid ${listed ? t.line : t.line2}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.t1, lineHeight: 1.25 }}>{c.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: teamColor(c.team) }} />
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.t2 }}>{c.creator}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: t.accInk }}>★ {c.rating}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>· 리뷰 {c.reviewCount}</span>
          </div>
        </div>
        <VerifyBadge t={t} verified={c.verified} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Tag t={t}>{c.track}</Tag>
        <Tag t={t} color={condColor(c.cond, t)}>{c.cond}</Tag>
        <Tag t={t}>{c.fmt}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 11, alignItems: 'stretch' }}>
        <MiniRadar t={t} perf={perf} />
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: t.line, border: `1px solid ${t.line}`, borderRadius: 7, overflow: 'hidden' }}>
          {c.params.slice(0, 3).map((prm) => (
            <div key={prm.k} style={{ background: t.inset, padding: '9px 4px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '.03em', color: t.t3 }}>{prm.k}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: owned ? t.t1 : t.t3, marginTop: 3, letterSpacing: '.08em' }}>{owned ? prm.v : '•••'}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.04em', color: owned ? t.green : t.t3 }}>{owned ? '✓ 공개됨' : 'LOCKED · 구매 후 공개'}</span>
        {listed ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 12, fontWeight: 700, color: t.accInk }}>⬢ {c.priceCredits}<span style={{ fontSize: 10, color: t.t3, fontWeight: 600 }}>상세 →</span></span>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.05em', color: t.t2, border: `1px dashed ${t.line2}`, borderRadius: 7, padding: '6px 11px' }}>참고 · 미판매</span>
        )}
      </div>
    </div>
  );
}

function compStyle(compound: HubStint['compound'], t: HubTheme): { c: string; text: string } {
  switch (compound) {
    case 'S': return { c: '#e0392b', text: '#ffffff' };
    case 'M': return { c: '#e8b923', text: '#3a2e00' };
    case 'H': return { c: t.compHard, text: '#2a2e35' };
    case 'I': return { c: '#2fae5f', text: '#04140b' };
    case 'W': return { c: '#2f7fd6', text: '#ffffff' };
  }
}

function pitOf(stints: HubStint[]): string {
  const out: string[] = [];
  let s = 0;
  for (let i = 0; i < stints.length - 1; i++) {
    s += stints[i].laps;
    out.push(`L${s}`);
  }
  return out.join(' · ');
}

function StrategyCard({ t, g, owned, onBuy }: { t: HubTheme; g: HubStrategyItem; owned: boolean; onBuy: () => void }) {
  const listed = g.priceCredits != null;
  const stops = g.stints.length - 1;
  return (
    <div style={{ background: t.panel, border: `1px solid ${listed ? t.line : t.line2}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.t1, lineHeight: 1.25 }}>{g.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: teamColor(g.team) }} />
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.t2 }}>{g.creator}</span>
          </div>
        </div>
        <VerifyBadge t={t} verified={g.verified} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Tag t={t} color={condColor(g.cond, t)}>{g.cond}</Tag>
        <Tag t={t}>{g.length}</Tag>
        <Tag t={t}>{g.fmt}</Tag>
      </div>
      <div>
        {owned ? (
          <div style={{ display: 'flex', gap: 2, height: 28, borderRadius: 6, overflow: 'hidden' }}>
            {g.stints.map((st, i) => {
              const cs = compStyle(st.compound, t);
              return (
                <div key={i} style={{ flex: st.laps, background: cs.c, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: cs.text, whiteSpace: 'nowrap' }}>{st.compound}·{st.laps}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ height: 28, borderRadius: 6, background: `repeating-linear-gradient(45deg,${t.inset},${t.inset} 7px,${t.panel2} 7px,${t.panel2} 14px)`, border: `1px dashed ${t.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.1em', color: t.t3 }}>◈ 스틴트 플랜 잠김</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.t3 }}>
          <span>{owned ? `${stops}-STOP` : 'LOCKED'}</span>
          <span>{owned ? `PIT ${pitOf(g.stints)}` : '구매 후 공개'}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: t.line, border: `1px solid ${t.line}`, borderRadius: 7, overflow: 'hidden' }}>
        <Metric t={t} label="AVG PACE" value={msToTimeShort(g.paceMs)} />
        <Metric t={t} label="표본" value={g.sample == null ? 'N=—' : `N=${g.sample}`} />
        <Metric t={t} label="예상 Δ" value={`${signed(g.gain)} pos`} valueColor={t.green} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>{g.conf}</div>
        {owned ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: t.ok, background: t.okSoft, borderRadius: 7, padding: '7px 11px' }}>✓ 보유 · 공개됨</span>
        ) : listed ? (
          <button onClick={onBuy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: t.acc, color: t.onAcc, border: 0, borderRadius: 7, padding: '8px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>⬢ {g.priceCredits} 구매</button>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '.05em', color: t.t2, border: `1px dashed ${t.line2}`, borderRadius: 7, padding: '7px 12px' }}>참고 · 미판매</span>
        )}
      </div>
    </div>
  );
}

function SetupSimilarPanel({ t, items }: { t: HubTheme; items: HubSimilarSetup[] }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18, position: 'sticky', top: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>유사 셋업 매칭</div>
      <div style={{ fontSize: 11.5, color: t.t3, marginTop: 7, lineHeight: 1.5 }}>내 현재 셋업(Mercedes · Silverstone · DRY)과 <span style={{ color: t.t1, fontWeight: 600 }}>핸들링 20차원</span> 거리 정렬</div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' }}>
        {items.map((s) => (
          <div key={s.handle} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 0', borderTop: `1px solid ${t.linesoft}` }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: teamColor(s.team), flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.t1 }}>{s.handle}</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: t.ok, marginTop: 2 }}>Δ {s.distPct}%</div>
            </div>
            {s.priceCredits != null ? (
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.accInk }}>⬢ {s.priceCredits}</span>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.t2, border: `1px dashed ${t.line2}`, borderRadius: 4, padding: '2px 6px' }}>미판매</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: '11px 13px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: 11, color: t.t2, lineHeight: 1.5 }}>가장 가까운 셋업이 <span style={{ color: t.t1 }}>미판매(listed=false)</span>일 수 있어요 — <span style={{ color: t.accInk }}>listed</span> 플래그로 구매 가능 여부를 구분합니다.</div>
    </div>
  );
}

function StrategySimilarPanel({ t, items }: { t: HubTheme; items: HubSimilarStrategy[] }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18, position: 'sticky', top: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>내 조건 매칭 전략</div>
      <div style={{ fontSize: 11.5, color: t.t3, marginTop: 7, lineHeight: 1.5 }}>Silverstone · DRY · 50% 기준 · <span style={{ color: t.t1, fontWeight: 600 }}>valid 기록</span> 크라우드소싱</div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' }}>
        {items.map((s) => (
          <div key={s.handle} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 0', borderTop: `1px solid ${t.linesoft}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.t1 }}>{s.handle}</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: t.t3, marginTop: 2 }}>{s.sample == null ? 'N—' : `N${s.sample}`} 표본</div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.ok }}>{signed(s.gain)}</span>
            {s.priceCredits != null ? (
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.accInk }}>⬢ {s.priceCredits}</span>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.t2, border: `1px dashed ${t.line2}`, borderRadius: 4, padding: '2px 6px' }}>미판매</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: '11px 13px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, fontSize: 11, color: t.t2, lineHeight: 1.5 }}>정적 트랙 가이드는 <span style={{ color: t.t1 }}>무료 참고</span> · 팀/차량별 실증 전략은 <span style={{ color: t.accInk }}>M4 크라우드소싱</span>으로 판매</div>
    </div>
  );
}

// ---- small shared bits ----
function VerifyBadge({ t, verified }: { t: HubTheme; verified: boolean }) {
  return verified ? (
    <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.04em', color: t.accInk, background: t.accSoft, border: `1px solid ${t.accBorder}`, borderRadius: 5, padding: '3px 7px' }}>✓ VERIFIED</span>
  ) : (
    <span style={{ flex: 'none', fontFamily: MONO, fontSize: 9, letterSpacing: '.04em', color: t.t2, border: `1px solid ${t.line2}`, borderRadius: 5, padding: '3px 7px' }}>미검증</span>
  );
}

function Tag({ t, color, children }: { t: HubTheme; color?: string; children: string }) {
  return <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: color ?? t.t2, background: t.inset, borderRadius: 4, padding: '3px 7px' }}>{children}</span>;
}

function Metric({ t, label, value, valueColor }: { t: HubTheme; label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: t.inset, padding: '8px 4px', textAlign: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: '.05em', color: t.t3 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: valueColor ?? t.t1, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function CatTab({ t, on, label, onClick }: { t: HubTheme; on: boolean; label: string; onClick: () => void }) {
  return <button onClick={onClick} style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.06em', padding: '8px 15px', border: 0, borderRadius: 6, cursor: 'pointer', background: on ? t.acc : 'transparent', color: on ? t.onAcc : t.t2 }}>{label}</button>;
}

function FilterPill({ t, label, active, pushRight }: { t: HubTheme; label: string; active?: boolean; pushRight?: boolean }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: active ? 600 : 400, letterSpacing: '.05em', padding: '7px 13px', borderRadius: 7, background: active ? t.acc : t.panel, border: active ? undefined : `1px solid ${t.line}`, color: active ? t.onAcc : t.t2, marginLeft: pushRight ? 'auto' : undefined }}>{label}</span>
  );
}
