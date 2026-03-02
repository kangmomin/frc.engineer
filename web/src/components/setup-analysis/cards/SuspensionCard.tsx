import { SetupCard } from '../SetupCard';
import type { Severity } from '../SetupCard';
import { SetupValue } from '../shared/SetupValue';
import { RecommendationRow } from '../shared/RecommendationRow';
import type { DriverInfo } from '../../../types/telemetry';

interface Props {
  driver: DriverInfo;
  readOnly?: boolean;
}

export function SuspensionCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const setup = driver.setup;
  const floorDmg = driver.damage?.floor ?? 0;

  let severity: Severity = 'green';
  let recommendation: string | null = null;

  if (latest && latest.bottomingPct > 20) {
    severity = 'red';
    recommendation = 'Severe bottoming — increase ride height immediately';
  } else if (latest && latest.bottomingPct > 10) {
    severity = 'yellow';
    recommendation = 'Bottoming detected — consider raising ride height';
  }
  if (floorDmg > 20) {
    severity = 'red';
    recommendation = 'Floor damage from bottoming — raise ride height';
  }

  return (
    <SetupCard
      title="Suspension"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          {setup && <SetupValue label="F Height" value={setup.frontRideHeight} />}
          {setup && <SetupValue label="R Height" value={setup.rearRideHeight} />}
          {setup && <SetupValue label="F ARB" value={setup.frontAntiRollBar} />}
          {setup && <SetupValue label="R ARB" value={setup.rearAntiRollBar} />}
          <SetupValue label="Bottoming" value={latest?.bottomingPct?.toFixed(1) ?? '-'} unit="%" color={latest && latest.bottomingPct > 10 ? '#ffcc00' : undefined} />
          <SetupValue label="G Spikes" value={latest?.vertGSpikeCount ?? '-'} />
          {floorDmg > 0 && <SetupValue label="Floor Dmg" value={`${floorDmg}%`} color="#e10600" />}
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr><th>Lap</th><th>Bottoming %</th><th>G Spikes</th><th>Floor Dmg</th></tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                <td>{l.bottomingPct.toFixed(1)}</td>
                <td>{l.vertGSpikeCount}</td>
                <td>{floorDmg > 0 ? `${floorDmg}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendation ? <RecommendationRow severity={severity} text={recommendation} /> : undefined}
    />
  );
}
