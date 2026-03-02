import { SetupCard } from '../SetupCard';
import type { Severity } from '../SetupCard';
import { SetupValue } from '../shared/SetupValue';
import { RecommendationRow } from '../shared/RecommendationRow';
import type { DriverInfo } from '../../../types/telemetry';

interface Props {
  driver: DriverInfo;
  readOnly?: boolean;
}

export function AerodynamicsCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const dmg = driver.damage;
  const wingDmg = dmg ? Math.max(dmg.frontLeftWing, dmg.frontRightWing) : 0;

  let severity: Severity = 'green';
  let recommendation: string | null = null;

  if (wingDmg > 20) {
    severity = 'red';
    recommendation = 'Front wing damage is reducing top speed';
  } else if (wingDmg > 5) {
    severity = 'yellow';
    recommendation = 'Minor wing damage detected';
  }

  return (
    <SetupCard
      title="Aerodynamics"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          <SetupValue label="Speed" value={driver.speed} unit="km/h" />
          <SetupValue label="Max Speed" value={latest?.maxStraightSpeed?.toFixed(0) ?? '-'} unit="km/h" />
          <SetupValue label="Avg Corner G" value={latest?.avgCorneringG?.toFixed(2) ?? '-'} />
          {driver.setup && <SetupValue label="F Wing" value={driver.setup.frontWing} />}
          {driver.setup && <SetupValue label="R Wing" value={driver.setup.rearWing} />}
          {wingDmg > 0 && <SetupValue label="Wing Dmg" value={`${wingDmg}%`} color={wingDmg > 20 ? '#e10600' : '#ffcc00'} />}
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr><th>Lap</th><th>Max Speed</th><th>Avg G</th><th>Wing Dmg</th></tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                <td>{l.maxStraightSpeed.toFixed(0)}</td>
                <td>{l.avgCorneringG.toFixed(2)}</td>
                <td>{wingDmg > 0 ? `${wingDmg}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendation ? <RecommendationRow severity={severity} text={recommendation} /> : undefined}
    />
  );
}
