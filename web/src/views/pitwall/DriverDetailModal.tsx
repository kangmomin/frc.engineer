import { useEffect, useMemo, useState } from 'react';
import type { LapRecord } from '../../store/lapHistoryStore';
import type { DriverInfo } from '../../types/telemetry';
import { MetricTile, PanelTitle } from '../../ui';
import { deriveDriverCodes } from '../../utils/driverCodes';
import {
  deriveDetailCharts,
  deriveDetailHeader,
  deriveRecentLaps,
  deriveRivalsSelection,
  seriesColor,
  type ChartSeriesVM,
  type ChartView,
  type CompareMode,
  type DetailChartsVM,
} from './derive/driverDetail';

const raceFont: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 700 };
const mutedLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const RECENT_GRID = '28px 46px 46px 46px 58px minmax(0,1fr)';

export interface DriverDetailModalProps {
  focus: DriverInfo;
  /** position 정렬된 필드 (PitWallView의 drivers). */
  drivers: DriverInfo[];
  playerIndex: number;
  history: Map<number, LapRecord[]>;
  onClose: () => void;
}

/**
 * 리더보드 OPEN → 드라이버 상세 모달 (목업 PitWall.dc.html 349–510 이식).
 * Recent Laps 테이블 + Lap Trace/Tyre Wear 차트를 lapHistoryStore 축적 실데이터로 렌더.
 * dialog 패턴은 PostRaceDebrief 선례(role=dialog/aria-modal/Escape/백드롭/✕).
 */
export function DriverDetailModal({ focus, drivers, playerIndex, history, onClose }: DriverDetailModalProps) {
  const hasPlayer = drivers.some((d) => d.index === playerIndex);
  const [view, setView] = useState<ChartView>('lap');
  const [delta, setDelta] = useState(false);
  const [exPit, setExPit] = useState(false);
  const [mode, setMode] = useState<CompareMode>(hasPlayer ? 'rivals' : 'solo');
  const [pick, setPick] = useState<ReadonlySet<number>>(() => new Set([focus.index]));
  const [highlight, setHighlight] = useState(-1);
  const [hoverLap, setHoverLap] = useState(-1);
  // ME+RIVALS 멤버십은 open 시점에 동결 — 이후 순위 변동에도 시리즈·색이 흔들리지 않는다.
  const [frozenRivals, setFrozenRivals] = useState<number[]>(() =>
    deriveRivalsSelection(focus.index, drivers, playerIndex),
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const codes = useMemo(() => deriveDriverCodes(drivers), [drivers]);
  const records = useMemo(() => history.get(focus.index) ?? [], [history, focus.index]);
  const header = useMemo(
    () => deriveDetailHeader(focus, records, codes.get(focus.index) ?? '—'),
    [focus, records, codes],
  );
  const recentLaps = useMemo(() => deriveRecentLaps(records), [records]);

  const seriesIndices = useMemo(() => {
    if (mode === 'solo') return [focus.index];
    if (mode === 'rivals') return frozenRivals;
    return pick.size > 0 ? [...pick] : [focus.index];
  }, [mode, focus.index, frozenRivals, pick]);

  const charts = useMemo(
    () => deriveDetailCharts({ seriesIndices, history, codes, view, delta, exPit, highlight, hoverLap }),
    [seriesIndices, history, codes, view, delta, exPit, highlight, hoverLap],
  );

  function switchMode(next: CompareMode) {
    if (next === 'rivals') setFrozenRivals(deriveRivalsSelection(focus.index, drivers, playerIndex));
    if (next === 'pick' && pick.size === 0) setPick(new Set([focus.index]));
    setMode(next);
  }

  const pickChips = useMemo(
    () =>
      [...drivers]
        .sort((a, b) => a.position - b.position)
        .map((d) => ({ index: d.index, code: codes.get(d.index) ?? `#${d.index}`, active: pick.has(d.index) })),
    [drivers, codes, pick],
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(6,6,7,.76)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <button
        type="button"
        aria-label="Close driver detail"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 'none', cursor: 'default' }}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="driver-detail-title"
        style={{
          position: 'relative',
          width: 1200,
          maxWidth: '100%',
          height: 648,
          maxHeight: '100%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--bg-panel-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-panel)',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 13,
        }}
      >
        {/* ── 헤더 ── */}
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ flex: 'none', width: 6, height: 42, background: header.teamColor, borderRadius: 3 }} />
          <div style={{ minWidth: 0 }}>
            <div
              id="driver-detail-title"
              style={{ ...raceFont, fontWeight: 800, fontStyle: 'italic', fontSize: 26, lineHeight: 1, color: 'var(--text-primary)' }}
            >
              {header.code} <span style={{ fontSize: 15, color: 'var(--accent)', fontStyle: 'normal' }}>{header.posLabel}</span>
            </div>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {header.teamName} · Recent form & tyre trace
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <MetricTile label="Last Lap" value={header.lastLap} tone="primary" compact />
            <MetricTile label="Best 6L" value={header.best6} tone="tertiary" compact />
            <MetricTile label="Δ Last" value={header.deltaLast} tone="secondary" compact />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '0 13px',
                background: 'rgba(14,14,15,.5)',
                border: '1px solid var(--bg-panel-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <span
                style={{
                  ...raceFont,
                  fontWeight: 800,
                  flex: 'none',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: `2.5px solid ${header.compoundColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  color: header.compoundColor,
                }}
              >
                {header.compound}
              </span>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tyre</div>
                <div style={{ ...raceFont, fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{header.tyreDetail}</div>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close driver detail"
            style={{
              flex: 'none',
              cursor: 'pointer',
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              border: '1px solid var(--bg-panel-border)',
              color: 'var(--text-secondary)',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── 차트 컨트롤 ── */}
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={mutedLabel}>Compare</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <Chip label="SOLO" active={mode === 'solo'} onClick={() => switchMode('solo')} />
              <Chip
                label="ME+RIVALS"
                active={mode === 'rivals'}
                onClick={() => switchMode('rivals')}
                disabled={!hasPlayer}
                title={hasPlayer ? undefined : 'No player car in this session'}
              />
              <Chip label="PICK" active={mode === 'pick'} onClick={() => switchMode('pick')} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={mutedLabel}>View</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['s1', 's2', 's3', 'lap'] as const).map((v) => (
                <Chip key={v} label={v.toUpperCase()} active={view === v} onClick={() => setView(v)} racing />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <Chip label="Δ DELTA" active={delta} onClick={() => setDelta((v) => !v)} activeColor="var(--accent-lime)" />
            <Chip label="EXCLUDE IN/OUT" active={exPit} onClick={() => setExPit((v) => !v)} activeColor="var(--accent-lime)" />
            {charts.highlightEnabled && highlight >= 0 && (
              <Chip label="CLEAR FOCUS" active={false} onClick={() => setHighlight(-1)} />
            )}
          </div>
        </div>
        {mode === 'pick' && (
          <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 56, overflow: 'auto', padding: 1 }}>
            {pickChips.map((chip) => (
              <button
                key={chip.index}
                type="button"
                onClick={() =>
                  setPick((prev) => {
                    const next = new Set(prev);
                    if (next.has(chip.index)) next.delete(chip.index);
                    else next.add(chip.index);
                    return next;
                  })
                }
                style={{
                  ...raceFont,
                  cursor: 'pointer',
                  fontSize: 10,
                  letterSpacing: '.03em',
                  padding: '4px 9px',
                  borderRadius: 999,
                  background: chip.active ? seriesColor(chip.index) : 'transparent',
                  color: chip.active ? '#0c0c0d' : 'var(--text-muted)',
                  border: `1px solid ${chip.active ? seriesColor(chip.index) : 'var(--bg-panel-border)'}`,
                }}
              >
                {chip.code}
              </button>
            ))}
          </div>
        )}

        {/* ── 본문: Recent Laps + 차트 ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '320px minmax(0,1fr)', gap: 13 }}>
          <div
            style={{
              minHeight: 0,
              background: 'rgba(14,14,15,.4)',
              border: '1px solid var(--bg-panel-border)',
              borderRadius: 'var(--radius-md)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <PanelTitle title="Recent Laps" tone="primary" detail="Sector splits & Δ" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: RECENT_GRID,
                alignItems: 'center',
                gap: 5,
                padding: '0 6px 5px',
                borderBottom: '1px solid var(--bg-panel-border)',
              }}
            >
              {['Lap', 'S1', 'S2', 'S3', 'Lap', 'Δ'].map((h, i) => (
                <span key={i} style={{ ...mutedLabel, letterSpacing: '.06em', textAlign: i === 0 ? 'left' : 'right' }}>
                  {h}
                </span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {recentLaps.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '0 10px', lineHeight: 1.5 }}>
                  No completed laps yet — data accumulates while connected.
                </div>
              ) : (
                recentLaps.map((row) => (
                  <div
                    key={row.lapLabel}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      display: 'grid',
                      gridTemplateColumns: RECENT_GRID,
                      alignItems: 'center',
                      gap: 5,
                      padding: '0 6px',
                      borderBottom: '1px solid rgba(132,147,150,.08)',
                    }}
                  >
                    <span style={{ ...raceFont, fontSize: 11.5, color: 'var(--text-muted)' }}>{row.lapLabel}</span>
                    <span style={{ ...raceFont, fontWeight: 600, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' }}>{row.s1}</span>
                    <span style={{ ...raceFont, fontWeight: 600, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' }}>{row.s2}</span>
                    <span style={{ ...raceFont, fontWeight: 600, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' }}>{row.s3}</span>
                    <span style={{ ...raceFont, fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', textAlign: 'right' }}>{row.lap}</span>
                    <span style={{ ...raceFont, fontWeight: 800, fontSize: 11.5, color: row.deltaColor, textAlign: 'right' }}>{row.delta}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            style={{
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(14,14,15,.4)',
              border: '1px solid var(--bg-panel-border)',
              borderRadius: 'var(--radius-md)',
              padding: 12,
              gap: 8,
            }}
          >
            {charts.empty ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
                No completed laps recorded yet.
                <br />
                Charts fill in as laps complete while you are connected.
              </div>
            ) : (
              <>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ ...raceFont, fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>Lap Trace</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>y: {charts.yUnit} · lower = faster</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '62%' }}>
                    {charts.lines.map((line) => (
                      <button
                        key={line.index}
                        type="button"
                        onClick={() => charts.highlightEnabled && setHighlight((h) => (h === line.index ? -1 : line.index))}
                        style={{
                          cursor: charts.highlightEnabled ? 'pointer' : 'default',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '3px 7px',
                          borderRadius: 4,
                          background: 'transparent',
                          border: '1px solid var(--bg-panel-border)',
                          opacity: line.opacity === 1 ? 1 : 0.4,
                        }}
                      >
                        <svg width="22" height="6" style={{ display: 'block', flex: 'none' }}>
                          <line x1="0" y1="3" x2="22" y2="3" stroke={line.color} strokeWidth="2.5" strokeDasharray={line.dash === 'none' ? undefined : line.dash} />
                        </svg>
                        <span style={{ ...raceFont, fontSize: 10.5, color: line.opacity === 1 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{line.code}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <ChartArea charts={charts} lines={charts.lines} yTicks={charts.yTicks} flex={1.35} minHeight={104} onHoverLap={setHoverLap} showTooltip />
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 3 }}>
                  <span style={{ ...raceFont, fontWeight: 800, fontSize: 12, color: 'var(--text-primary)' }}>Tyre Wear</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>y: % worn · same compare & toggles</span>
                </div>
                <ChartArea charts={charts} lines={charts.wearLines} yTicks={charts.wearYTicks} flex={1} minHeight={72} onHoverLap={setHoverLap} />
                <div style={{ flex: 'none', display: 'flex', gap: 6, height: 14 }}>
                  <div style={{ flex: 'none', width: 40 }} />
                  <div style={{ flex: 1, position: 'relative' }}>
                    {charts.xTicks.map((t) => (
                      <span key={t.label} style={{ position: 'absolute', left: `${t.leftPct}%`, transform: 'translateX(-50%)', fontSize: 9, color: 'var(--text-muted)' }}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, fontSize: 9, color: 'var(--text-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, background: 'var(--text-muted)', transform: 'rotate(45deg)' }} />
                    in / out lap
                  </span>
                  <span>hover: all drivers at that lap</span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ── 내부 소품 ──

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
  racing?: boolean;
  disabled?: boolean;
  title?: string;
}

function Chip({ label, active, onClick, activeColor = 'var(--accent)', racing, disabled, title }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: racing ? 'var(--font-racing)' : 'var(--font-body)',
        fontWeight: 700,
        fontSize: racing ? 11 : 10,
        letterSpacing: '.04em',
        padding: racing ? '5px 12px' : '5px 11px',
        borderRadius: 5,
        background: active ? activeColor : 'transparent',
        color: active ? '#0c0c0d' : 'var(--text-muted)',
        border: `1px solid ${active ? activeColor : 'var(--bg-panel-border)'}`,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

interface ChartAreaProps {
  charts: DetailChartsVM;
  lines: ChartSeriesVM[];
  yTicks: Array<{ label: string; topPct: number }>;
  flex: number;
  minHeight: number;
  onHoverLap: (lap: number) => void;
  /** hover 툴팁은 Lap Trace 차트에서만 (목업 456). */
  showTooltip?: boolean;
}

function ChartArea({ charts, lines, yTicks, flex, minHeight, onHoverLap, showTooltip }: ChartAreaProps) {
  return (
    <div style={{ flex, minHeight, display: 'flex', gap: 6 }}>
      <div style={{ flex: 'none', width: 40, position: 'relative' }}>
        {yTicks.map((t, i) => (
          <span key={i} style={{ position: 'absolute', right: 3, top: `${t.topPct}%`, transform: 'translateY(-50%)', fontSize: 9, color: 'var(--text-muted)' }}>
            {t.label}
          </span>
        ))}
      </div>
      <div onMouseLeave={() => onHoverLap(-1)} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {yTicks.map((t, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${t.topPct}%`, borderTop: '1px solid rgba(132,147,150,.12)' }} />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          {lines.map((line) =>
            line.segments.map((points, i) => (
              <polyline
                key={`${line.index}-${i}`}
                points={points}
                fill="none"
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                strokeDasharray={line.dash === 'none' ? undefined : line.dash}
                strokeOpacity={line.opacity}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
          )}
        </svg>
        {lines.map((line) =>
          line.markers.map((mk, i) => (
            <div
              key={`${line.index}-${i}`}
              style={{ position: 'absolute', left: `${mk.leftPct}%`, top: `${mk.topPct}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}
            >
              {mk.pit ? (
                <span title="in/out lap" style={{ display: 'block', width: 9, height: 9, background: mk.color, border: '1.5px solid #0c0c0d', transform: 'rotate(45deg)', boxShadow: `0 0 5px ${mk.color}` }} />
              ) : (
                <span style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', background: mk.color }} />
              )}
            </div>
          )),
        )}
        {charts.hover.active && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${charts.hover.leftPct}%`, width: 1, background: 'rgba(0,229,255,.5)', pointerEvents: 'none' }} />
        )}
        {charts.hoverCols.map((c) => (
          <div
            key={c.lap}
            onMouseEnter={() => onHoverLap(c.lap)}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${c.leftPct}%`, width: `${c.widthPct}%`, cursor: 'crosshair' }}
          />
        ))}
        {showTooltip && charts.hover.active && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: `${charts.hover.leftPct}%`,
              // 우측 랩 hover 시 패널 클리핑 방지 — 왼쪽으로 뒤집기
              ...(charts.hover.leftPct > 65
                ? { transform: 'translateX(-100%)', marginLeft: -8 }
                : { marginLeft: 8 }),
              zIndex: 6,
              background: 'rgba(6,6,7,.95)',
              border: '1px solid var(--bg-panel-border)',
              borderRadius: 6,
              padding: '7px 9px',
              minWidth: 118,
              pointerEvents: 'none',
            }}
          >
            <div style={{ ...raceFont, fontWeight: 800, fontSize: 11, color: 'var(--text-primary)', marginBottom: 4 }}>{charts.hover.title}</div>
            {charts.hover.rows.map((row) => (
              <div key={row.code} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <svg width="15" height="5" style={{ flex: 'none' }}>
                  <line x1="0" y1="2.5" x2="15" y2="2.5" stroke={row.color} strokeWidth="2.5" strokeDasharray={row.dash === 'none' ? undefined : row.dash} />
                </svg>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>{row.code}</span>
                <span style={{ ...raceFont, fontSize: 10.5, color: 'var(--text-primary)' }}>{row.value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{row.wear}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
