import { SetupCard } from '../SetupCard';
import type { Severity } from '../SetupCard';
import { SetupValue } from '../shared/SetupValue';
import { RecommendationRow } from '../shared/RecommendationRow';
import type { DriverInfo } from '../../../types/telemetry';

interface Props {
  driver: DriverInfo;
  readOnly?: boolean;
}

export function TransmissionCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const dynamicsLatest = driver.dynamics?.[driver.dynamics.length - 1];

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  // Wheelspin-based on-throttle diff feedback
  if (latest && latest.wheelspinPct > 25) {
    severity = 'red';
    recommendations.push(
      `Wheelspin ${latest.wheelspinPct.toFixed(1)}% — lower on-throttle diff (${driver.diffOnThrottle}%)`
    );
  } else if (latest && latest.wheelspinPct > 15) {
    severity = 'yellow';
    recommendations.push(
      `Wheelspin ${latest.wheelspinPct.toFixed(1)}% — consider lowering on-throttle diff (${driver.diffOnThrottle}%)`
    );
  }

  // Entry oversteer → increase off-throttle diff for rear stability
  if (dynamicsLatest && dynamicsLatest.oversteerPct > 15) {
    severity = severity === 'red' ? 'red' : 'yellow';
    recommendations.push(
      `Entry oversteer ${dynamicsLatest.oversteerPct.toFixed(1)}% — increase off-throttle diff (${driver.diffOffThrottle}%) for rear stability`
    );
  }

  return (
    <SetupCard
      title="Transmission"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          <SetupValue label="Diff On" value={driver.diffOnThrottle} unit="%" />
          <SetupValue label="Diff Off" value={driver.diffOffThrottle} unit="%" />
          <SetupValue label="Wheelspin" value={latest?.wheelspinPct?.toFixed(1) ?? '-'} unit="%" color={latest && latest.wheelspinPct > 15 ? '#ffcc00' : undefined} />
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr><th>Lap</th><th>Wheelspin %</th><th>Diff On</th><th>Diff Off</th></tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                <td>{l.wheelspinPct.toFixed(1)}</td>
                <td>{driver.diffOnThrottle}</td>
                <td>{driver.diffOffThrottle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
