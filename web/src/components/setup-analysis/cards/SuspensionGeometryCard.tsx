import { SetupCard } from '../SetupCard';
import type { Severity } from '../SetupCard';
import { SetupValue } from '../shared/SetupValue';
import { RecommendationRow } from '../shared/RecommendationRow';
import type { DriverInfo } from '../../../types/telemetry';

interface Props {
  driver: DriverInfo;
  readOnly?: boolean;
}

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

export function SuspensionGeometryCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const setup = driver.setup;

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  if (latest) {
    // Front inner > surface by >8 degrees C
    if (latest.tempBalance[0] > 8 || latest.tempBalance[1] > 8) {
      severity = 'yellow';
      recommendations.push('Front inner temps high — reduce front camber');
    }
    // Rear inner > surface by >8 degrees C
    if (latest.tempBalance[2] > 8 || latest.tempBalance[3] > 8) {
      severity = 'yellow';
      recommendations.push('Rear inner temps high — reduce rear camber');
    }
    if (latest.tempBalance[0] > 12 || latest.tempBalance[1] > 12 || latest.tempBalance[2] > 12 || latest.tempBalance[3] > 12) {
      severity = 'red';
    }
  }

  return (
    <SetupCard
      title="Suspension Geometry"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          {WHEEL_LABELS.map((w, i) => (
            <SetupValue key={w} label={`${w} Δ°C`} value={latest?.tempBalance[i]?.toFixed(1) ?? '-'} color={latest && latest.tempBalance[i] > 8 ? '#ffcc00' : undefined} />
          ))}
          {setup && <SetupValue label="F Camber" value={setup.frontCamber.toFixed(2)} unit="°" />}
          {setup && <SetupValue label="R Camber" value={setup.rearCamber.toFixed(2)} unit="°" />}
          {setup && <SetupValue label="F Toe" value={setup.frontToe.toFixed(2)} unit="°" />}
          {setup && <SetupValue label="R Toe" value={setup.rearToe.toFixed(2)} unit="°" />}
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr><th>Lap</th>{WHEEL_LABELS.map((w) => <th key={w}>{w} Δ°C</th>)}</tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                {l.tempBalance.map((t, i) => <td key={i}>{t.toFixed(1)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
