import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import { WeatherIcon } from '../../ui';
import type { StatusTone } from '../../utils/raceDisplay';
import type { QualiSegmentVM } from './derive/qualiSegment';

const STATUS_COLOR: Record<StatusTone, string> = {
  green: 'var(--accent-lime)',
  formation: 'var(--accent)',
  safety: '#eab308',
  vsc: '#eab308',
  red: 'var(--accent-red)',
  info: 'var(--text-muted)',
};

const CLOCK_WARNING_SECONDS = 90;
const Q_SEGMENT_CHIPS = ['Q1', 'Q2', 'Q3'] as const;
const SS_SEGMENT_CHIPS = ['SS1', 'SS2', 'SS3'] as const;

/** 레거시 `formatTimeLeft`(QualifyingDashboard.tsx:500-505) 이식. */
function formatTimeLeft(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface QualifyingHeaderProps {
  controls: ShellControls;
  gpTitle: string;
  sessionType: string;
  segment: QualiSegmentVM;
  sessionTimeLeft: number | undefined;
  weather: { weather: string; condLabel: string; trackTemp: number; airTemp: number; iconColor: string };
  status: { label: string; tone: StatusTone };
  is2026: boolean;
}

/**
 * Qualifying 헤더(Phase3 Spec §5). Broadcast/PitWall 헤더와 동일한 3-column 패턴.
 * 세그먼트 지시자(Q1/Q2/Q3)와 버전칩은 유저 토글이 아니라 sessionType/gameFormat 실값
 * 지시자다(§9 anti-fabrication) — 클릭 핸들러가 없다.
 */
export function QualifyingHeader({ controls, gpTitle, sessionType, segment, sessionTimeLeft, weather, status, is2026 }: QualifyingHeaderProps) {
  const statusColor = STATUS_COLOR[status.tone];
  const clockWarning = sessionTimeLeft != null && sessionTimeLeft > 0 && sessionTimeLeft < CLOCK_WARNING_SECONDS;
  // 세그먼트 칩을 세그먼트 패밀리에 따라 동적화한다(scope M2) — 이전엔 Q1/Q2/Q3로 고정돼 있어
  // SS1/SS2/SS3(스프린트 슛아웃) 세션에서는 어떤 칩도 active로 매칭되지 않아 지시자가 먹통이었다.
  // segment.segment가 'SS'를 포함하면(SS1-3/Short SS/OSS) SS 칩을, 아니면 Q 칩을 보여준다 —
  // Short SS/OSS처럼 구조를 알 수 없는 포맷은 세 칩 중 어느 것도 active로 매칭되지 않는데, 이는
  // qualiSegment.ts의 "모르면 조작하지 않고 정직하게 degrade" 원칙과 일관된 동작이다.
  const segmentChips = segment.segment.includes('SS') ? SS_SEGMENT_CHIPS : Q_SEGMENT_CHIPS;

  return (
    <header
      style={{
        position: 'relative',
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 22,
        background: 'var(--bg-panel)',
        border: '1px solid var(--bg-panel-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '11px 18px',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      {/* LEFT: nav + GP title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {gpTitle}
          </div>
          <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Qualifying · {sessionType || '—'}
          </div>
        </div>
      </div>

      {/* CENTER: segment indicator(Q1/Q2/Q3, 실값 — 비인터랙티브) + clock + segInfo */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            role="group"
            aria-label="Qualifying segment"
            style={{ display: 'flex', gap: 3, background: 'rgba(14,14,15,.6)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-md)', padding: 3 }}
          >
            {segmentChips.map((chip) => {
              const active = segment.segment === chip;
              return (
                <span
                  key={chip}
                  aria-current={active ? 'true' : undefined}
                  style={{
                    fontFamily: 'var(--font-racing)',
                    fontWeight: 700,
                    fontSize: 11.5,
                    letterSpacing: '0.05em',
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#0c0c0d' : 'var(--text-muted)',
                  }}
                >
                  {chip}
                </span>
              );
            })}
          </div>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 22, lineHeight: 1, color: clockWarning ? 'var(--accent-red)' : 'var(--text-primary)' }}>
            {formatTimeLeft(sessionTimeLeft)}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>{segment.outLabel}</div>
      </div>

      {/* RIGHT: version chip(실값, 비토글) + weather 요약 + status pill */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 11px', borderRadius: 'var(--radius-md)', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)' }}>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 12, letterSpacing: '.04em', color: 'var(--accent)' }}>{is2026 ? 'F1 26' : 'F1 25'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ lineHeight: 1.2, textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13.5 }}>
              TRK {Math.round(weather.trackTemp)}° · AIR {Math.round(weather.airTemp)}°
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{weather.condLabel}</div>
          </div>
          <div style={{ flex: 'none', width: 22, height: 22, color: weather.iconColor }}>
            <WeatherIcon weather={weather.weather} />
          </div>
        </div>
        <div style={{ width: 1, height: 32, background: 'var(--bg-panel-border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(14,14,15,.55)', border: `1px solid color-mix(in srgb, ${statusColor} 38%, transparent)` }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}` }} />
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 12.5, letterSpacing: '0.1em', color: statusColor }}>{status.label}</span>
        </div>
      </div>
    </header>
  );
}
