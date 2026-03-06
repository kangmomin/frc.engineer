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

export function BrakesCard({ driver, readOnly }: Props) {
  const laps = driver.setupAnalysis ?? [];
  const latest = laps[laps.length - 1];
  const setup = driver.setup;

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  if (latest) {
    const totalLockup = Math.max(latest.frontLockupPct, latest.rearLockupPct);
    if (totalLockup > 20) {
      severity = 'red';
    } else if (totalLockup > 10) {
      severity = 'yellow';
    }

    // Bias direction feedback
    if (latest.frontLockupPct > latest.rearLockupPct && latest.frontLockupPct > 10) {
      recommendations.push(
        `Front lockup ${latest.frontLockupPct.toFixed(1)}% > Rear ${latest.rearLockupPct.toFixed(1)}% — move bias rearward (${driver.brakeBias}%)`
      );
    } else if (latest.rearLockupPct > latest.frontLockupPct && latest.rearLockupPct > 10) {
      recommendations.push(
        `Rear lockup ${latest.rearLockupPct.toFixed(1)}% > Front ${latest.frontLockupPct.toFixed(1)}% — move bias forward (${driver.brakeBias}%)`
      );
    }

    // Overall lockup → brake pressure feedback
    if (totalLockup > 20 && setup) {
      recommendations.push(
        `High lockup — reduce brake pressure (${setup.brakePressure})`
      );
    }
  }

  return (
    <SetupCard
      title="Brakes"
      severity={severity}
      readOnly={readOnly}
      liveStrip={
        <>
          {WHEEL_LABELS.map((w, i) => (
            <SetupValue key={w} label={`${w} Temp`} value={driver.brakeTemp[i]} unit="°C" />
          ))}
          <SetupValue label="Bias" value={driver.brakeBias} unit="%" />
          {setup && <SetupValue label="Pressure" value={setup.brakePressure} />}
          <SetupValue label="F Lock" value={latest?.frontLockupPct?.toFixed(1) ?? '-'} unit="%" color={latest && latest.frontLockupPct > 10 ? '#ffcc00' : undefined} />
          <SetupValue label="R Lock" value={latest?.rearLockupPct?.toFixed(1) ?? '-'} unit="%" color={latest && latest.rearLockupPct > 10 ? '#ffcc00' : undefined} />
        </>
      }
      table={laps.length > 0 ? (
        <table>
          <thead>
            <tr><th>Lap</th><th>F Lockup %</th><th>R Lockup %</th><th>Bias</th></tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lapNum}>
                <td>{l.lapNum}</td>
                <td>{l.frontLockupPct.toFixed(1)}</td>
                <td>{l.rearLockupPct.toFixed(1)}</td>
                <td>{driver.brakeBias}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : undefined}
      recommendation={recommendations.length > 0 ? <>{recommendations.map((r, i) => <RecommendationRow key={i} severity={severity} text={r} />)}</> : undefined}
    />
  );
}
