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

export function TyresCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const setup = driver.setup;

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  if (latest) {
    for (let i = 0; i < 4; i++) {
      if (latest.avgTyreInnerTemp[i] > 105) {
        severity = 'red';
        recommendations.push(`${WHEEL_LABELS[i]} inner temp very high — reduce tyre pressure`);
        break;
      } else if (latest.avgTyreInnerTemp[i] > 100) {
        severity = severity === 'red' ? 'red' : 'yellow';
        if (recommendations.length === 0) {
          recommendations.push('Inner temps high — consider reducing tyre pressure');
        }
      }
    }
  }

  return (
    <SetupCard
      title="Tyres"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          <SetupValue label="Compound" value={driver.tireCompound} />
          <SetupValue label="Age" value={driver.tireAge} unit="laps" />
          {WHEEL_LABELS.map((w, i) => (
            <SetupValue key={`p${w}`} label={`${w} PSI`} value={setup?.tyrePressures[i]?.toFixed(1) ?? '-'} />
          ))}
          {WHEEL_LABELS.map((w, i) => (
            <SetupValue key={`t${w}`} label={`${w} Inner`} value={driver.tireInnerTemp[i]} unit="°C" color={driver.tireInnerTemp[i] > 100 ? '#ffcc00' : undefined} />
          ))}
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Lap</th>
              {WHEEL_LABELS.map((w) => <th key={`p${w}`}>{w} PSI</th>)}
              {WHEEL_LABELS.map((w) => <th key={`t${w}`}>{w} °C</th>)}
            </tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                {l.avgTyrePressure.map((p, i) => <td key={`p${i}`}>{p.toFixed(1)}</td>)}
                {l.avgTyreInnerTemp.map((t, i) => <td key={`t${i}`}>{t.toFixed(0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
