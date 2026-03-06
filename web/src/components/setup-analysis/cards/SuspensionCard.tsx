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
  const recommendations: string[] = [];

  // Bottoming feedback with ride height values
  if (latest && latest.bottomingPct > 20) {
    severity = 'red';
    recommendations.push(
      `Bottoming ${latest.bottomingPct.toFixed(1)}% — raise ride height (F:${setup?.frontRideHeight ?? '?'} / R:${setup?.rearRideHeight ?? '?'})`
    );
  } else if (latest && latest.bottomingPct > 10) {
    severity = 'yellow';
    recommendations.push(
      `Bottoming ${latest.bottomingPct.toFixed(1)}% — consider raising ride height (F:${setup?.frontRideHeight ?? '?'} / R:${setup?.rearRideHeight ?? '?'})`
    );
  }

  // Floor damage
  if (floorDmg > 20) {
    severity = 'red';
    recommendations.push(`Floor damage ${floorDmg}% — raise ride height to prevent further damage`);
  }

  // G-spike based suspension stiffness feedback
  if (latest && latest.vertGSpikeCount > 10 && setup) {
    severity = severity === 'red' ? 'red' : 'yellow';
    recommendations.push(
      `${latest.vertGSpikeCount} G-spikes — soften suspension (F:${setup.frontSuspension} / R:${setup.rearSuspension}) or ARB (F:${setup.frontAntiRollBar} / R:${setup.rearAntiRollBar})`
    );
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
          {setup && <SetupValue label="F Susp" value={setup.frontSuspension} />}
          {setup && <SetupValue label="R Susp" value={setup.rearSuspension} />}
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
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
