import { msToTime } from '../format';
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
}

export function RaceAnalysisDetail({ t, detail, selectedIncidentIndex, onSelectIncident }: Props) {
  return (
    <article className={styles.detail} aria-labelledby="race-analysis-detail-title" style={{ color: t.t1 }}>
      <div className={styles.detailHeader}>
        <div>
          <h2 id="race-analysis-detail-title">{detail.track.name} · {detail.sessionType}</h2>
          <p className={styles.meta}>{detail.gameFormat} · {detail.completedLaps === null ? 'laps unknown' : `${detail.completedLaps} laps`} · {detail.bestLapMs === null ? 'best lap —' : `best ${msToTime(detail.bestLapMs)}`}</p>
        </div>
        <span className={styles.badge}>schema {detail.schemaVersion ?? 'legacy'}</span>
      </div>

      <div className={styles.sectionGrid}>
        <AnalysisSection title="Lap / sector" notices={[
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

        <AnalysisSection title="Stints / tyres" notices={[
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

        <AnalysisSection title="Dynamics" notices={[
          { label: 'Dynamics', completeness: detail.sectionCompleteness.dynamics, dataCount: detail.dynamics.length },
        ]}>
          {detail.dynamics.length === 0 ? <Empty>다이내믹스 데이터가 없습니다.</Empty> : (
            <div className={styles.tableWrap} tabIndex={0}>
              <table className={styles.table}>
                <thead><tr><th>Lap</th><th>Understeer</th><th>Oversteer</th><th title="Brake >90% above 80 km/h; wheel lockup unconfirmed">Heavy braking (lockup unconfirmed)</th><th>Spins</th></tr></thead>
                <tbody>{detail.dynamics.map((row) => <tr key={row.lapNumber}>
                  <td>{row.lapNumber}</td><td>{row.understeerPct}%</td><td>{row.oversteerPct}%</td><td>{row.lockupCount}</td><td>{row.spinCount}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </AnalysisSection>

        <AnalysisSection title="Penalties / events" notices={[
          { label: 'Penalties', completeness: detail.sectionCompleteness.penalties, dataCount: detail.penalties ? 1 : 0 },
          { label: 'Events', completeness: detail.sectionCompleteness.events, dataCount: detail.events.length },
        ]}>
          {detail.penalties ? <KeyValues values={[
            ['Time penalty', `${detail.penalties.timePenaltySeconds}s`], ['Warnings', String(detail.penalties.warnings)],
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

        <AnalysisSection title="Measured pit time" notices={[
          { label: 'Pit', completeness: detail.sectionCompleteness.pit, dataCount: detail.pitMeasurement ? 1 : 0 },
        ]}>
          {detail.pitMeasurement ? <KeyValues values={[
            ['Stops', String(detail.pitMeasurement.stops)],
            ['Pit-lane time', timeOrDash(detail.pitMeasurement.pitLaneTimeMs)],
            ['Stationary time', timeOrDash(detail.pitMeasurement.stationaryMs)],
          ]} /> : <Empty>측정된 피트 시간은 없습니다. 순 레이스 손실을 추정하지 않습니다.</Empty>}
        </AnalysisSection>

        <AnalysisSection title="Incidents" wide notices={[
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
        </AnalysisSection>
      </div>
    </article>
  );
}

function AnalysisSection({ title, notices, wide = false, children }: {
  title: string;
  notices: Array<{ label: string; completeness: SectionCompleteness; dataCount: number }>;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.section} ${wide ? styles.sectionWide : ''}`}>
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
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function relativeIncidentTime(sessionTimeMs: number): string {
  return `${(sessionTimeMs / 1000).toFixed(3)}s`;
}
