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
    const frontMax = Math.max(latest.tempBalance[0], latest.tempBalance[1]);
    const rearMax = Math.max(latest.tempBalance[2], latest.tempBalance[3]);

    // Front inner > surface by >8 degrees C
    if (frontMax > 8) {
      severity = frontMax > 12 ? 'red' : 'yellow';
      recommendations.push(
        `Front inner temp delta ${frontMax.toFixed(1)}°C — reduce front camber (${setup?.frontCamber?.toFixed(2) ?? '?'}°)`
      );
    }
    // Rear inner > surface by >8 degrees C
    if (rearMax > 8) {
      severity = rearMax > 12 ? 'red' : severity === 'red' ? 'red' : 'yellow';
      recommendations.push(
        `Rear inner temp delta ${rearMax.toFixed(1)}°C — reduce rear camber (${setup?.rearCamber?.toFixed(2) ?? '?'}°)`
      );
    }

    // Overall high inner temps → pressure adjustment (complements Tyres card)
    const avgInner = latest.tempBalance.reduce((a, b) => a + b, 0) / 4;
    if (avgInner > 5 && avgInner <= 8) {
      recommendations.push(
        `Average inner-surface delta ${avgInner.toFixed(1)}°C — consider reducing tyre pressures`
      );
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
