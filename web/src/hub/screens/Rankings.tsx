// Rankings screen — Time Trial + Race Pace leaderboards (hub.dc.html:170-234).
import type { HubTheme } from '../theme';
import { teamColor } from '../theme';
import { msToTime, secFmt, sectorColor, lapColor, gapLabel, tyreColor, consistencyColor } from '../format';
import type { HubRankings, HubTTRow, HubPaceRow } from '../data/types';

const MONO = "'JetBrains Mono',monospace";
const TT_COLS = '46px minmax(150px,1fr) 82px 82px 82px 94px 84px 64px';
const PACE_COLS = '46px minmax(150px,1fr) 100px 64px 54px minmax(96px,1fr) 84px';

interface Props {
  t: HubTheme;
  data: HubRankings;
  tab: 'tt' | 'pace';
  onSetTab: (tab: 'tt' | 'pace') => void;
  rowPad: string;
}

export function Rankings({ t, data, tab, onSetTab, rowPad }: Props) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>Leaderboards</div>
          <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>
            <span style={{ color: t.ok, fontWeight: 600 }}>valid</span> 검증 세션만 집계 · game_format 파티션
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FilterChip t={t} label="TRACK" value="Silverstone GP" />
          <FilterChip t={t} label="SEASON" value="S3" />
          <FilterChip t={t} label="TEAM" value="All" />
        </div>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 9, padding: 4, width: 'fit-content' }}>
        <TabButton t={t} on={tab === 'tt'} label="TIME TRIAL" onClick={() => onSetTab('tt')} />
        <TabButton t={t} on={tab === 'pace'} label="RACE PACE" onClick={() => onSetTab('pace')} />
      </div>

      {tab === 'tt' ? <TTTable t={t} rows={data.tt} rowPad={rowPad} /> : <PaceTable t={t} rows={data.pace} rowPad={rowPad} />}
    </section>
  );
}

function TTTable({ t, rows, rowPad }: { t: HubTheme; rows: HubTTRow[]; rowPad: string }) {
  const s1 = extent(rows.map((r) => r.s1Ms));
  const s2 = extent(rows.map((r) => r.s2Ms));
  const s3 = extent(rows.map((r) => r.s3Ms));
  const lead = Math.min(...rows.map((r) => r.lapMs));

  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: TT_COLS, alignItems: 'center', gap: 10, padding: '12px 18px', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.13em', color: t.t3, borderBottom: `1px solid ${t.line}` }}>
        <div>POS</div><div>DRIVER / TEAM</div>
        <div style={{ textAlign: 'right' }}>S1</div><div style={{ textAlign: 'right' }}>S2</div><div style={{ textAlign: 'right' }}>S3</div>
        <div style={{ textAlign: 'right' }}>LAP</div><div style={{ textAlign: 'right' }}>GAP</div><div style={{ textAlign: 'right' }}>FMT</div>
      </div>
      {rows.map((r, i) => {
        const pos = i + 1;
        const posColor = r.you ? t.accInk : pos <= 3 ? t.topInk : t.t3;
        return (
          <div key={r.handle} style={{ borderLeft: `2px solid ${r.you ? t.acc : 'transparent'}`, background: r.you ? t.accSoft : 'transparent' }}>
            <div style={{ display: 'grid', gridTemplateColumns: TT_COLS, alignItems: 'center', gap: 10, padding: `${rowPad} 18px`, borderTop: `1px solid ${t.linesoft}` }}>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: posColor }}>{pos}</div>
              <DriverCell t={t} handle={r.handle} team={r.team} you={r.you} />
              <SectorCell t={t} ms={r.s1Ms} min={s1[0]} max={s1[1]} />
              <SectorCell t={t} ms={r.s2Ms} min={s2[0]} max={s2[1]} />
              <SectorCell t={t} ms={r.s3Ms} min={s3[0]} max={s3[1]} />
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, textAlign: 'right', color: lapColor(r.lapMs, lead, t) }}>{msToTime(r.lapMs)}</div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, textAlign: 'right', color: t.t2 }}>{gapLabel(r.lapMs, lead)}</div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontFamily: MONO, fontSize: 9, color: t.t2, border: `1px solid ${t.line2}`, borderRadius: 4, padding: '2px 5px' }}>{r.fmt.slice(-2)}</span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '13px 18px', borderTop: `1px solid ${t.line}`, fontFamily: MONO, fontSize: 10, letterSpacing: '.05em', color: t.t3 }}>
        <LegendDot color={t.sbest} label="SESSION BEST" />
        <LegendDot color={t.ok} label="PERSONAL BEST" />
        <LegendDot color={t.warn} label="OFF PACE" />
      </div>
    </div>
  );
}

function PaceTable({ t, rows, rowPad }: { t: HubTheme; rows: HubPaceRow[]; rowPad: string }) {
  const lead = Math.min(...rows.map((r) => r.avgMs));
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: PACE_COLS, alignItems: 'center', gap: 10, padding: '12px 18px', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.13em', color: t.t3, borderBottom: `1px solid ${t.line}` }}>
        <div>POS</div><div>DRIVER / TEAM</div>
        <div style={{ textAlign: 'right' }}>AVG CLEAN</div><div style={{ textAlign: 'center' }}>TYRE</div>
        <div style={{ textAlign: 'right' }}>LAPS</div><div>CONSISTENCY</div><div style={{ textAlign: 'right' }}>GAP</div>
      </div>
      {rows.map((r, i) => {
        const pos = i + 1;
        const posColor = r.you ? t.accInk : pos <= 3 ? t.topInk : t.t3;
        const consPct = `${Math.round(r.consistency * 100)}%`;
        return (
          <div key={r.handle} style={{ borderLeft: `2px solid ${r.you ? t.acc : 'transparent'}`, background: r.you ? t.accSoft : 'transparent' }}>
            <div style={{ display: 'grid', gridTemplateColumns: PACE_COLS, alignItems: 'center', gap: 10, padding: `${rowPad} 18px`, borderTop: `1px solid ${t.linesoft}` }}>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: posColor }}>{pos}</div>
              <DriverCell t={t} handle={r.handle} team={r.team} you={r.you} />
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, textAlign: 'right', color: t.t1 }}>{msToTime(r.avgMs)}</div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: tyreColor(r.tyre, t) }}>{r.tyre}</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, textAlign: 'right', color: t.t2 }}>{r.laps}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 5, background: t.panel2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: consPct, background: consistencyColor(r.consistency, t.acc, t), borderRadius: 3 }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.t2, width: 32, textAlign: 'right' }}>{consPct}</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, textAlign: 'right', color: t.t2 }}>{gapLabel(r.avgMs, lead)}</div>
            </div>
          </div>
        );
      })}
      <div style={{ padding: '13px 18px', borderTop: `1px solid ${t.line}`, fontFamily: MONO, fontSize: 10, letterSpacing: '.05em', color: t.t3 }}>clean 랩 평균 (아웃·인·SC 랩 제외)</div>
    </div>
  );
}

function DriverCell({ t, handle, team, you }: { t: HubTheme; handle: string; team: string; you: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: teamColor(team), flex: 'none' }} />
      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: you ? t.accInk : t.t1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{handle}</span>
      {you && (
        <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', color: t.onAcc, background: t.acc, padding: '2px 5px', borderRadius: 4, flex: 'none' }}>YOU</span>
      )}
    </div>
  );
}

function SectorCell({ t, ms, min, max }: { t: HubTheme; ms: number; min: number; max: number }) {
  return <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, textAlign: 'right', color: sectorColor(ms, min, max, t) }}>{secFmt(ms)}</div>;
}

function FilterChip({ t, label, value }: { t: HubTheme; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '8px 13px', fontSize: 12, color: t.t1 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.1em', color: t.t3 }}>{label}</span> {value} <span style={{ color: t.t3 }}>▾</span>
    </div>
  );
}

function TabButton({ t, on, label, onClick }: { t: HubTheme; on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', padding: '8px 16px', border: 0, borderRadius: 6, cursor: 'pointer', background: on ? t.acc : 'transparent', color: on ? t.onAcc : t.t2 }}>{label}</button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />{label}
    </span>
  );
}

function extent(vals: number[]): [number, number] {
  return [Math.min(...vals), Math.max(...vals)];
}
