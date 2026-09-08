import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { msToTime } from '../format';
import type { PlatformMySetupParams } from '../data/platform';
import { SETUP_FIELDS } from '../data/setupFields';
import type { HubTheme } from '../theme';
import type {
  RaceAnalysisDetail as RaceAnalysisDetailValue,
  SectionCompleteness,
} from '../data/raceAnalysisTypes';
import { participantName, teamIdentity } from './analysisPlayback';
import { completenessReasonText, sectionPresentation } from './raceAnalysisState';
import styles from './Analysis.module.css';

interface Props {
  t: HubTheme;
  detail: RaceAnalysisDetailValue;
  selectedIncidentIndex: number | null;
  onSelectIncident: (index: number) => void;
  incidentPanel?: ReactNode;
  actions?: ReactNode;
  setup?: PlatformMySetupParams;
}

const TABS = [
  { id: 'laps', label: '랩 / 섹터' }, { id: 'tyres', label: '스틴트 / 타이어' },
  { id: 'dynamics', label: '주행 분석' }, { id: 'events', label: '페널티 / 이벤트' },
  { id: 'pit', label: '피트' }, { id: 'incidents', label: '사고 리플레이' },
];

export function RaceAnalysisDetail({ t, detail, selectedIncidentIndex, onSelectIncident, incidentPanel, actions, setup }: Props) {
  const [activeTab, setActiveTab] = useState('laps');
  const prefix = useId();
  const tabs = setup ? [...TABS, { id: 'setup', label: '셋업' }] : TABS;
  const incidentCount = ['unknown', 'unavailable'].includes(detail.sectionCompleteness.incidents.status) ? '—' : detail.incidents.length;
  const panelProps = (id: string) => ({ id: `${prefix}-panel-${id}`, labelledBy: `${prefix}-tab-${id}`, hidden: activeTab !== id });
  return (
    <article className={styles.detail} aria-labelledby="race-analysis-detail-title" style={{ color: t.t1 }}>
      <div className={styles.detailHeader}>
        <div>
          <h2 id="race-analysis-detail-title">{detail.track.name} · {detail.sessionType}</h2>
          <p className={styles.meta}>{detail.gameFormat} · {new Date(detail.recordedAt ?? detail.uploadedAt).toLocaleString('ko-KR')}{detail.recordedAt === null ? ' 업로드' : ''}</p>
        </div>
        {actions}
      </div>
      <dl className={styles.summaryMetrics}>
        <div><dt>FINISH POSITION</dt><dd>{detail.finishPosition === null ? '—' : `P${detail.finishPosition}`}</dd></div>
        <div><dt>COMPLETED LAPS</dt><dd>{detail.completedLaps ?? '—'}</dd></div>
        <div><dt>BEST LAP</dt><dd>{detail.bestLapMs === null ? '—' : msToTime(detail.bestLapMs)}</dd></div>
        <div><dt>INCIDENTS</dt><dd>{incidentCount}</dd></div>
      </dl>
      <div className={styles.tabs} role="tablist" aria-label="레이스 분석 데이터" onKeyDown={(event) => {
        const index = tabs.findIndex((tab) => tab.id === activeTab);
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        setActiveTab(tabs[next].id);
        document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus();
      }}>
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${prefix}-tab-${tab.id}`} aria-controls={`${prefix}-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.id === 'incidents' && <span>{incidentCount}</span>}</button>)}
      </div>
      <div className={styles.tabContent}>
        <AnalysisSection title="Lap / sector" {...panelProps('laps')} notices={[
          { label: 'Laps', completeness: detail.sectionCompleteness.laps, dataCount: detail.laps.length },
          { label: 'Sectors', completeness: detail.sectionCompleteness.sectors, dataCount: detail.laps.filter((lap) => lap.s1Ms !== null && lap.s2Ms !== null && lap.s3Ms !== null).length },
        ]}>
          {detail.laps.length === 0 ? <Empty>랩 데이터가 없습니다.</Empty> : (
            <div className={styles.tableWrap} tabIndex={0}>
              <table className={styles.table}>
                <thead><tr><th>Lap</th><th>Lap time</th><th>S1</th><th>S2</th><th>S3</th><th>Tyre</th><th>Valid</th></tr></thead>
                <tbody>{detail.laps.map((lap) => <tr key={lap.lapNumber}>
                  <td>{lap.lapNumber}</td><td>{msToTime(lap.lapMs)}</td><td>{timeOrDash(lap.s1Ms)}</td><td>{timeOrDash(lap.s2Ms)}</td><td>{timeOrDash(lap.s3Ms)}</td><td>{lap.tyre ?? '—'}</td><td>{lap.valid ? 'yes' : 'no'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </AnalysisSection>

        <AnalysisSection title="Stints / tyres" {...panelProps('tyres')} notices={[
          { label: 'Stints', completeness: detail.sectionCompleteness.stints, dataCount: detail.stints.length },
          { label: 'Tyres', completeness: detail.sectionCompleteness.tyres, dataCount: detail.tyres ? 1 : 0 },
        ]}>
          {detail.stints.length === 0 ? <Empty>스틴트 데이터가 없습니다.</Empty> : (
            <div className={styles.tableWrap} tabIndex={0}>
              <table className={styles.table}>
                <thead><tr><th>Compound</th><th>Laps</th><th>Start / end</th><th>Wear</th></tr></thead>
                <tbody>{detail.stints.map((stint, index) => <tr key={`${stint.compound}-${index}`}>
                  <td>{stint.compound || '—'}</td><td>{stint.laps}</td><td>{numberOrDash(stint.startLap)} / {numberOrDash(stint.endLap)}</td><td>{percentOrDash(stint.tireWearPct)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          {detail.tyres && <KeyValues values={[
            ['Final compound', detail.tyres.finalCompound ?? '—'], ['Final age', numberOrDash(detail.tyres.finalAge)],
            ['Average wear', percentOrDash(detail.tyres.averageWearPct)], ['Peak wear', percentOrDash(detail.tyres.peakWearPct)],
            ['Final-set wear', percentOrDash(detail.tyres.finalSetWearPct)], ['Life remaining', percentOrDash(detail.tyres.lifeRemainingPct)],
          ]} />}
        </AnalysisSection>

        <AnalysisSection title="Dynamics" {...panelProps('dynamics')} notices={[
          { label: 'Dynamics', completeness: detail.sectionCompleteness.dynamics, dataCount: detail.dynamics.length },
        ]}>
          {detail.dynamics.length === 0 ? <Empty>다이내믹스 데이터가 없습니다.</Empty> : (
            <div className={styles.tableWrap} tabIndex={0}>
              <table className={styles.table}>
                <thead><tr><th>Lap</th><th>Understeer</th><th>Oversteer</th><th title="Brake >90% above 80 km/h; wheel lockup unconfirmed">Heavy braking (lockup unconfirmed)</th><th>Spins</th></tr></thead>
                <tbody>{detail.dynamics.map((row) => <tr key={row.lapNumber}>
                  <td>{row.lapNumber}</td><td>{percentOrDash(row.understeerPct)}</td><td>{percentOrDash(row.oversteerPct)}</td><td>{row.lockupCount}</td><td>{row.spinCount}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </AnalysisSection>

        <AnalysisSection title="Penalties / events" {...panelProps('events')} notices={[
          { label: 'Penalties', completeness: detail.sectionCompleteness.penalties, dataCount: detail.penalties ? 1 : 0 },
          { label: 'Events', completeness: detail.sectionCompleteness.events, dataCount: detail.events.length },
        ]}>
          {detail.penalties ? <KeyValues values={[
            ['Time penalty', `${detail.penalties.timePenaltySeconds.toFixed(3)}s`], ['Warnings', String(detail.penalties.warnings)],
            ['Corner-cut warnings', String(detail.penalties.cornerCutWarnings)], ['Unserved drive-through', String(detail.penalties.unservedDriveThrough)],
            ['Unserved stop-go', String(detail.penalties.unservedStopGo)],
          ]} /> : <Empty>페널티 요약이 없습니다.</Empty>}
          {detail.events.length === 0 ? <Empty>이벤트가 없습니다.</Empty> : (
            <div className={styles.tableWrap} tabIndex={0} style={{ marginTop: 10 }}>
              <table className={styles.table}>
                <thead><tr><th>Lap</th><th>Category</th><th>Severity</th><th>Message</th><th>Driver</th></tr></thead>
                <tbody>{detail.events.map((event, index) => <tr key={`${event.timestamp ?? 'none'}-${index}`}>
                  <td>{numberOrDash(event.lap)}</td><td>{event.category}</td><td>{event.severity}</td><td>{event.message}</td><td>{event.driverName ?? '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </AnalysisSection>

        <AnalysisSection title="Measured pit time" {...panelProps('pit')} notices={[
          { label: 'Pit', completeness: detail.sectionCompleteness.pit, dataCount: detail.pitMeasurement ? 1 : 0 },
        ]}>
          {detail.pitMeasurement ? <KeyValues values={[
            ['Stops', String(detail.pitMeasurement.stops)],
            ['Pit-lane time', timeOrDash(detail.pitMeasurement.pitLaneTimeMs)],
            ['Stationary time', timeOrDash(detail.pitMeasurement.stationaryMs)],
          ]} /> : <Empty>측정된 피트 시간은 없습니다. 순 레이스 손실을 추정하지 않습니다.</Empty>}
        </AnalysisSection>

        <AnalysisSection title="Incidents" {...panelProps('incidents')} notices={[
          { label: 'Incidents', completeness: detail.sectionCompleteness.incidents, dataCount: detail.incidents.length },
          { label: 'Track outline', completeness: detail.sectionCompleteness.trackOutline, dataCount: detail.trackOutline?.points.length ?? 0 },
        ]}>
          {detail.incidents.length === 0 ? <Empty>{emptyIncidentMessage(detail.sectionCompleteness.incidents)}</Empty> : (
            <ul className={styles.incidentList}>
              {detail.incidents.map((incident) => {
                const active = selectedIncidentIndex === incident.index;
                const names = incident.participants.map((person) => `${participantName(person.name, person.idx)} (${teamIdentity(person.teamId).label})`).join(', ');
                return <li key={incident.index}><button type="button" className={`${styles.incidentButton} ${active ? styles.incidentSelected : ''}`} aria-pressed={active} onClick={() => onSelectIncident(incident.index)}>
                  <strong>Incident {incident.index + 1} · {relativeIncidentTime(incident.sessionTimeMs)}</strong>
                  <span className={styles.incidentPeople}>{incident.lap === null ? 'Lap —' : `Lap ${incident.lap}`} · {incident.frameCount} stored frames · {names || 'participants unavailable'}</span>
                  <CompletenessNotice section={`Incident ${incident.index + 1}`} completeness={incident.completeness} dataCount={incident.frameCount} inline />
                </button></li>;
              })}
            </ul>
          )}
          {activeTab === 'incidents' && incidentPanel}
        </AnalysisSection>
        {setup && <AnalysisSection title="Shared setup" {...panelProps('setup')} notices={[]}>
          <KeyValues values={SETUP_FIELDS.map((field) => [field.label, `${Number.isInteger(setup[field.key]) ? setup[field.key] : setup[field.key].toFixed(3)}${field.unit ? ` ${field.unit}` : ''}`])} />
        </AnalysisSection>}
      </div>
    </article>
  );
}

function AnalysisSection({ title, notices, id, labelledBy, hidden, children }: {
  title: string;
  notices: Array<{ label: string; completeness: SectionCompleteness; dataCount: number }>;
  id: string;
  labelledBy: string;
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section} role="tabpanel" id={id} aria-labelledby={labelledBy} hidden={hidden} tabIndex={0}>
      <div className={styles.sectionHeader}><h3>{title}</h3></div>
      {notices.map(({ label, completeness, dataCount }) => <CompletenessNotice key={label} section={label} completeness={completeness} dataCount={dataCount} />)}
      {children}
    </section>
  );
}

export function CompletenessNotice({ section, completeness, dataCount, inline = false }: { section?: string; completeness: Pick<SectionCompleteness, 'status' | 'reasons'>; dataCount: number; inline?: boolean }) {
  const presentation = sectionPresentation(completeness, dataCount);
  const explanation = completenessReasonText(presentation.reasons);
  const text = presentation.kind === 'confirmed-zero'
    ? 'confirmed zero'
    : presentation.kind === 'complete'
      ? 'complete'
      : presentation.kind === 'partial'
        ? 'partial data'
        : presentation.kind === 'unavailable'
          ? 'unavailable'
          : 'unknown';
  const contents = <><span className={styles.badge}>{section ? `${section}: ${text}` : text}</span>{explanation ? ` · ${explanation}` : ''}</>;
  return inline
    ? <span className={styles.notice} data-kind={presentation.kind} style={{ display: 'block' }}>{contents}</span>
    : <p className={styles.notice} data-kind={presentation.kind}>{contents}</p>;
}

function KeyValues({ values }: { values: Array<[string, string]> }) {
  return <dl className={styles.keyValues}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function emptyIncidentMessage(completeness: Pick<SectionCompleteness, 'status' | 'reasons'>): string {
  const reason = completenessReasonText(completeness.reasons);
  switch (completeness.status) {
    case 'complete':
      return 'No incidents were confirmed for this race.';
    case 'partial':
      return `No incident clips are available; incident capture is partial${reason ? `: ${reason}.` : '.'}`;
    case 'unavailable':
      return `Incident clips are unavailable for this race${reason ? `: ${reason}.` : '.'}`;
    case 'unknown':
      return 'Incident availability is unknown for this legacy or unsupported analysis.';
  }
}

function timeOrDash(value: number | null): string {
  return value === null ? '—' : msToTime(value);
}

function numberOrDash(value: number | null): string {
  return value === null ? '—' : String(value);
}

function percentOrDash(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(3)}%`;
}

function relativeIncidentTime(sessionTimeMs: number): string {
  return `${(sessionTimeMs / 1000).toFixed(3)}s`;
}
