import { useMemo } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { DriverInfo } from '../../types/telemetry';
import styles from './DirectCombatAdvisor.module.css';

interface ActionCall {
  type: 'PUSH' | 'HOLD' | 'DEFEND' | 'LIFT' | 'WAIT';
  title: string;
  message: string;
  color: string;
}

const COMPOUND_PACE_PENALTY: Record<string, number> = {
  'soft': 0,
  'medium': 0.3,
  'hard': 0.6,
  'inter': 1.5,
  'wet': 3.0,
  'unknown': 0
};

export function DirectCombatAdvisor() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);

  const analysis = useMemo(() => {
    if (!pitwallState) return null;

    const { drivers, playerIndex, session } = pitwallState;
    const player = drivers[playerIndex];
    if (!player) return null;

    const ahead = drivers.find(d => d.position === player.position - 1);
    const behind = drivers.find(d => d.position === player.position + 1);

    const analyzeDriver = (target: DriverInfo, isAhead: boolean): ActionCall => {
      // 1. Temperature Check (Critical)
      const maxTyreTemp = Math.max(...player.tireSurfaceTemp);
      const maxBrakeTemp = Math.max(...player.brakeTemp);
      
      if (maxTyreTemp > 105 || maxBrakeTemp > 850) {
        return {
          type: 'LIFT',
          title: 'LIFT & COAST',
          message: `CRITICAL TEMPS: Tyre ${maxTyreTemp}°C / Brake ${maxBrakeTemp}°C. Cool down!`,
          color: 'var(--accent-purple, #9c27b0)'
        };
      }

      // 2. Pace & Tyre Analysis
      const myPaceBase = player.lastLapTime / 1000;
      const targetPaceBase = target.lastLapTime / 1000;
      
      if (myPaceBase === 0 || targetPaceBase === 0) {
        return { type: 'WAIT', title: 'ANALYZING', message: 'Waiting for representative lap times...', color: '#666' };
      }

      const myTyrePenalty = (player.tireAge * 0.08) + (COMPOUND_PACE_PENALTY[player.tireCompound] || 0);
      const targetTyrePenalty = (target.tireAge * 0.08) + (COMPOUND_PACE_PENALTY[target.tireCompound] || 0);
      
      // Relative advantage (negative means player is faster/fresher)
      const paceDelta = myPaceBase - targetPaceBase;
      const tyreAdvantage = targetTyrePenalty - myTyrePenalty;
      const totalScore = tyreAdvantage - paceDelta;

      if (isAhead) {
        if (totalScore > 0.4) {
          return {
            type: 'PUSH',
            title: 'PUSH NOW',
            message: `Tyre Advantage. Catching ${Math.abs(paceDelta).toFixed(2)}s/lap. Hunt him down!`,
            color: 'var(--accent-green, #4caf50)'
          };
        } else if (paceDelta > 0.3 && tyreAdvantage < -0.3) {
           return {
            type: 'HOLD',
            title: 'HOLD & MANAGE',
            message: `Tyre Deficit. Target lap ${session?.pitStopWindowIdealLap || 'N/A'}. Save rubber.`,
            color: 'var(--accent-yellow, #ffeb3b)'
          };
        } else {
          return {
            type: 'HOLD',
            title: 'MAINTAIN GAP',
            message: `Pace Equal. Keep pressure within 1.0s to force an error.`,
            color: 'var(--text-secondary, #aaa)'
          };
        }
      } else {
        // Target is BEHIND
        if (totalScore < -0.4 || paceDelta > 0.4) {
          return {
            type: 'DEFEND',
            title: 'DEFEND NOW',
            message: `Threat behind on ${target.tireAge}L ${target.tireCompound}s. Use ERS on straights!`,
            color: 'var(--accent-red, #f44336)'
          };
        } else {
          return {
            type: 'HOLD',
            title: 'STAY CALM',
            message: `Gap holding at ${((target.deltaToCarInFront ?? 0) / 1000).toFixed(1)}s. Manage ERS deployment.`,
            color: 'var(--text-secondary, #aaa)'
          };
        }
      }
    };

    return {
      ahead: ahead ? { driver: ahead, gap: (player.deltaToCarInFront ?? 0) / 1000, call: analyzeDriver(ahead, true) } : null,
      behind: behind ? { driver: behind, gap: (behind.deltaToCarInFront ?? 0) / 1000, call: analyzeDriver(behind, false) } : null,
    };
  }, [pitwallState]);

  if (!analysis) return null;

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeader}>⚔️ DIRECT COMBAT ADVISOR</div>
      
      <div className={styles.advisorGrid}>
        {analysis.ahead ? (
          <div className={`${styles.card} ${styles[analysis.ahead.call.type.toLowerCase()]}`}>
            <div className={styles.targetLabel}>TARGET AHEAD (P{analysis.ahead.driver.position})</div>
            <div className={styles.driverRow}>
              <span className={styles.driverName}>{analysis.ahead.driver.name}</span>
              <span className={styles.gapText}>+{analysis.ahead.gap.toFixed(2)}s</span>
            </div>
            <div className={styles.tyreInfo}>
              {analysis.ahead.driver.tireAge}L {analysis.ahead.driver.tireCompound.toUpperCase()}
            </div>
            <div className={styles.actionCall} style={{ color: analysis.ahead.call.color }}>
              {analysis.ahead.call.title}
            </div>
            <div className={styles.message}>{analysis.ahead.call.message}</div>
          </div>
        ) : (
          <div className={styles.noTarget}>NO TARGET AHEAD</div>
        )}

        {analysis.behind ? (
          <div className={`${styles.card} ${styles[analysis.behind.call.type.toLowerCase()]}`}>
            <div className={styles.targetLabel}>THREAT BEHIND (P{analysis.behind.driver.position})</div>
            <div className={styles.driverRow}>
              <span className={styles.driverName}>{analysis.behind.driver.name}</span>
              <span className={styles.gapText}>-{analysis.behind.gap.toFixed(2)}s</span>
            </div>
            <div className={styles.tyreInfo}>
              {analysis.behind.driver.tireAge}L {analysis.behind.driver.tireCompound.toUpperCase()}
            </div>
            <div className={styles.actionCall} style={{ color: analysis.behind.call.color }}>
              {analysis.behind.call.title}
            </div>
            <div className={styles.message}>{analysis.behind.call.message}</div>
          </div>
        ) : (
          <div className={styles.noTarget}>NO THREAT BEHIND</div>
        )}
      </div>
    </div>
  );
}
