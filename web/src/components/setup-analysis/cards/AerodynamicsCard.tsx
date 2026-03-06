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
  const setup = driver.setup;
  const dmg = driver.damage;
  const wingDmg = dmg ? Math.max(dmg.frontLeftWing, dmg.frontRightWing) : 0;
  const dynamicsLatest = driver.dynamics?.[driver.dynamics.length - 1];

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  // Wing damage feedback
  if (wingDmg > 20) {
    severity = 'red';
    recommendations.push(`Wing damage ${wingDmg}% — significant top speed loss`);
  } else if (wingDmg > 5) {
    severity = 'yellow';
    recommendations.push(`Minor wing damage ${wingDmg}%`);
  }

  // Dynamics-based aero balance feedback
  if (dynamicsLatest && setup) {
    if (dynamicsLatest.understeerPct > 15) {
      severity = severity === 'red' ? 'red' : 'yellow';
      recommendations.push(
        `Understeer ${dynamicsLatest.understeerPct.toFixed(1)}% — increase front wing (${setup.frontWing}) or reduce rear wing (${setup.rearWing})`
      );
    }
    if (dynamicsLatest.oversteerPct > 15) {
      severity = severity === 'red' ? 'red' : 'yellow';
      recommendations.push(
        `Oversteer ${dynamicsLatest.oversteerPct.toFixed(1)}% — increase rear wing (${setup.rearWing}) or reduce front wing (${setup.frontWing})`
      );
    }
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
          {setup && <SetupValue label="F Wing" value={setup.frontWing} />}
          {setup && <SetupValue label="R Wing" value={setup.rearWing} />}
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
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
