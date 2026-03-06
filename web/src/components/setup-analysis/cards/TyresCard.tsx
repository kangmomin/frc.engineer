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
  const wear = driver.tireWear;

  let severity: Severity = 'green';
  const recommendations: string[] = [];

  if (latest && setup) {
    // Per-wheel inner temp + pressure feedback
    for (let i = 0; i < 4; i++) {
      if (latest.avgTyreInnerTemp[i] > 105) {
        severity = 'red';
        recommendations.push(
          `${WHEEL_LABELS[i]} inner temp ${latest.avgTyreInnerTemp[i].toFixed(0)}°C — reduce pressure (${setup.tyrePressures[i]?.toFixed(1) ?? '?'} PSI)`
        );
      } else if (latest.avgTyreInnerTemp[i] > 100) {
        severity = severity === 'red' ? 'red' : 'yellow';
        recommendations.push(
          `${WHEEL_LABELS[i]} inner temp ${latest.avgTyreInnerTemp[i].toFixed(0)}°C — consider lowering pressure (${setup.tyrePressures[i]?.toFixed(1) ?? '?'} PSI)`
        );
      }
    }

    // Front vs rear temperature balance
    const frontAvgTemp = (latest.avgTyreInnerTemp[0] + latest.avgTyreInnerTemp[1]) / 2;
    const rearAvgTemp = (latest.avgTyreInnerTemp[2] + latest.avgTyreInnerTemp[3]) / 2;
    const tempDiff = Math.abs(frontAvgTemp - rearAvgTemp);
    if (tempDiff > 10) {
      const hot = frontAvgTemp > rearAvgTemp ? 'Front' : 'Rear';
      recommendations.push(
        `${hot} tyres ${tempDiff.toFixed(0)}°C hotter than ${hot === 'Front' ? 'rear' : 'front'} — check ${hot.toLowerCase()} setup balance`
      );
    }
  } else if (latest) {
    // Fallback without setup data
    for (let i = 0; i < 4; i++) {
      if (latest.avgTyreInnerTemp[i] > 105) {
        severity = 'red';
        if (recommendations.length === 0) recommendations.push('Inner temps critical — reduce tyre pressure');
      } else if (latest.avgTyreInnerTemp[i] > 100) {
        severity = severity === 'red' ? 'red' : 'yellow';
        if (recommendations.length === 0) recommendations.push('Inner temps high — consider reducing tyre pressure');
      }
    }
  }

  // Tire wear feedback — F1 25 cliff at ~40-50%
  if (wear) {
    const maxWear = Math.max(...wear);
    if (maxWear > 50) {
      severity = 'red';
      const idx = wear.indexOf(maxWear);
      recommendations.push(`${WHEEL_LABELS[idx]} wear ${maxWear}% — puncture risk, pit immediately`);
    } else if (maxWear > 40) {
      severity = severity === 'red' ? 'red' : 'yellow';
      recommendations.push(`Tyre wear ${maxWear}% — approaching cliff, plan pit stop`);
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
          {wear && <SetupValue label="Max Wear" value={`${Math.max(...wear)}%`} color={Math.max(...wear) > 50 ? '#e10600' : Math.max(...wear) > 40 ? '#ffcc00' : undefined} />}
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
