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

  let severity: Severity = 'green';
  let recommendation: string | null = null;

  if (latest && latest.wheelspinPct > 25) {
    severity = 'red';
    recommendation = 'Excessive wheelspin — lower on-throttle differential';
  } else if (latest && latest.wheelspinPct > 15) {
    severity = 'yellow';
    recommendation = 'Moderate wheelspin — consider lowering on-throttle differential';
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
      recommendation={recommendation ? <RecommendationRow severity={severity} text={recommendation} /> : undefined}
    />
  );
}
