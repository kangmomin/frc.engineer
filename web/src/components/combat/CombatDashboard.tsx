import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTelemetryStore } from '../../store/telemetryStore';
import { getTyreColor, getTyreShortLabel, getWearStatusColor } from '../../constants/tyreCompounds';
import type { DriverInfo } from '../../types/telemetry';
import styles from './CombatDashboard.module.css';

const MAX_ERS_ENERGY = 4_000_000;
const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

interface CombatDashboardProps {
  onSwitchToCockpit?: () => void;
  onGoHome?: () => void;
  remoteAction?: { label: string; onClick: () => void; active: boolean };
}

export function CombatDashboard({ onSwitchToCockpit, onGoHome, remoteAction }: CombatDashboardProps) {
  const { pitwallState, battleAlerts } = useTelemetryStore(
    useShallow((state) => ({
      pitwallState: state.pitwallState,
      battleAlerts: state.battleAlerts,
    })),
  );

  const playerIndex = pitwallState?.playerIndex ?? -1;
  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );

  const player = useMemo(
    () => drivers.find((d) => d.index === playerIndex) ?? null,
    [drivers, playerIndex],
  );

  const carAhead = useMemo(() => {
    if (!player) return null;
    return drivers.find((d) => d.position === player.position - 1) ?? null;
  }, [drivers, player]);

  const carBehind = useMemo(() => {
    if (!player) return null;
    return drivers.find((d) => d.position === player.position + 1) ?? null;
  }, [drivers, player]);

  const aheadAlert = battleAlerts.find((a) => a.side === 'ahead');
  const behindAlert = battleAlerts.find((a) => a.side === 'behind');

  if (!player) {
    return (
      <div className={styles.shell}>
        <TopBar onSwitchToCockpit={onSwitchToCockpit} onGoHome={onGoHome} remoteAction={remoteAction} />
        <div className={styles.content}>
          <span className={styles.empty}>Waiting for session data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <TopBar onSwitchToCockpit={onSwitchToCockpit} onGoHome={onGoHome} remoteAction={remoteAction} />
      <div className={styles.content}>
        <CombatCard
          label="Target Ahead"
          driver={carAhead}
          tone="ahead"
          gapLabel={formatAheadGap(player)}
          paceLabel={formatPaceDelta(aheadAlert)}
        />

        <DrsCard player={player} aheadAlert={aheadAlert} />

        <CombatCard
          label="You"
          driver={player}
          tone="player"
          isPlayer
        />

        <CombatCard
          label="Chaser Behind"
          driver={carBehind}
          tone="behind"
          gapLabel={formatBehindGap(carBehind)}
          paceLabel={formatPaceDelta(behindAlert)}
        />
      </div>
    </div>
  );
}

function TopBar({
  onSwitchToCockpit,
  onGoHome,
  remoteAction,
}: {
  onSwitchToCockpit?: () => void;
  onGoHome?: () => void;
  remoteAction?: { label: string; onClick: () => void; active: boolean };
}) {
  return (
    <div className={styles.topBar}>
      <span className={styles.topBarTitle}>Combat View</span>
      <div className={styles.topBarActions}>
        {remoteAction && (
          <button type="button" className={styles.topBarBtn} onClick={remoteAction.onClick}>
            {remoteAction.label}
          </button>
        )}
        {onSwitchToCockpit && (
          <button type="button" className={styles.topBarBtn} onClick={onSwitchToCockpit}>
            Cockpit
          </button>
        )}
        {onGoHome && (
          <button type="button" className={styles.topBarBtn} onClick={onGoHome}>
            Home
          </button>
        )}
      </div>
    </div>
  );
}

function CombatCard({
  label,
  driver,
  tone,
  gapLabel,
  paceLabel,
  isPlayer,
}: {
  label: string;
  driver: DriverInfo | null;
  tone: 'ahead' | 'player' | 'behind';
  gapLabel?: string;
  paceLabel?: string;
  isPlayer?: boolean;
}) {
  const cardClass = tone === 'ahead' ? styles.cardAhead : tone === 'player' ? styles.cardPlayer : styles.cardBehind;

  if (!driver) {
    return (
      <div className={`${styles.card} ${cardClass}`}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>{label}</span>
          <span className={`${styles.cardDriver} ${styles[tone]}`}>--</span>
        </div>
      </div>
    );
  }

  const ersPct = Math.min(Math.max((driver.ersStoreEnergy / MAX_ERS_ENERGY) * 100, 0), 100);
  const ersEstPct = driver.ersEstimateReady ? driver.ersEstimatePct : null;
  const wear = driver.tireWear ?? [0, 0, 0, 0];

  return (
    <div className={`${styles.card} ${cardClass}`}>
      <div className={styles.cardHeader}>
        <span className={styles.cardLabel}>{label}</span>
        <span className={`${styles.cardDriver} ${styles[tone]}`}>
          {abbreviateDriver(driver.name, driver.index)} — P{driver.position}
        </span>
      </div>

      {!isPlayer && (gapLabel || paceLabel) && (
        <div className={styles.metricsRow}>
          {gapLabel && (
            <div className={styles.metric}>
              <span>Gap</span>
              <strong>{gapLabel}</strong>
            </div>
          )}
          {paceLabel && (
            <div className={styles.metric}>
              <span>Pace Delta</span>
              <strong>{paceLabel}</strong>
            </div>
          )}
          <div className={styles.metric}>
            <span>Lap</span>
            <strong>{driver.currentLapNum || '--'}</strong>
          </div>
        </div>
      )}

      <div className={styles.tyreRow}>
        <span className={styles.tyreCompound} style={{ color: getTyreColor(driver.tireCompound) }}>
          {getTyreShortLabel(driver.tireCompound)}
        </span>
        <span className={styles.tyreAge}>L{driver.tireAge}</span>
        <div className={styles.tyreWearGrid}>
          {WHEEL_LABELS.map((wl, i) => (
            <div key={wl} className={styles.tyreWheel}>
              <span>{wl}</span>
              <strong style={{ color: getWearStatusColor(wear[i] ?? 0) }}>
                {wear[i] ?? 0}%
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.ersRow}>
        <span className={styles.ersLabel}>ERS</span>
        <div className={styles.ersTrack}>
          <div className={styles.ersFill} style={{ width: `${ersPct}%` }} />
        </div>
        <span className={styles.ersPct}>{Math.round(ersPct)}%</span>
      </div>
      {ersEstPct != null && (
        <div className={styles.ersRow}>
          <span className={styles.ersLabel}>EST</span>
          <div className={styles.ersTrack}>
            <div className={styles.ersFill} style={{ width: `${ersEstPct}%` }} />
          </div>
          <span className={styles.ersPct}>{ersEstPct}%</span>
        </div>
      )}
    </div>
  );
}

function DrsCard({
  player,
  aheadAlert,
}: {
  player: DriverInfo;
  aheadAlert?: { gapSeconds: number; closingRatePerLap: number };
}) {
  const gap = player.deltaToCarInFront ?? 0;
  const armed = gap > 0 && gap <= 1000;
  const progress = gap > 0 ? Math.min(Math.max(100 - (gap / 1000) * 100, 0), 100) : 0;
  const combatLaps = formatCombatWindow(aheadAlert, player);

  return (
    <div className={styles.drsCard}>
      <div className={styles.drsHeader}>
        <span className={styles.drsLabel}>DRS Status</span>
        <span className={`${styles.drsStatus} ${armed ? styles.drsArmed : styles.drsLocked}`}>
          {armed ? 'ARMED' : 'LOCKED'}
        </span>
      </div>
      <div className={styles.drsTrack}>
        <div className={styles.drsFill} style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.drsFooter}>
        <span>Laps to Combat</span>
        <strong>{combatLaps}</strong>
      </div>
    </div>
  );
}

function abbreviateDriver(name: string, fallbackIndex?: number): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallbackIndex != null ? `P${fallbackIndex}` : '---';
  const parts = trimmed.split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : trimmed).slice(0, 3).toUpperCase();
}

function formatAheadGap(player: DriverInfo): string {
  if (!player.deltaToCarInFront || player.deltaToCarInFront <= 0) return '--';
  return `-${(player.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatBehindGap(behind: DriverInfo | null): string {
  if (!behind?.deltaToCarInFront || behind.deltaToCarInFront <= 0) return '--';
  return `+${(behind.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatPaceDelta(alert?: { closingRatePerLap: number } | null): string {
  if (!alert) return '--';
  return `${alert.closingRatePerLap > 0 ? '-' : '+'}${Math.abs(alert.closingRatePerLap).toFixed(2)}s`;
}

function formatCombatWindow(
  alert: { gapSeconds: number; closingRatePerLap: number } | undefined,
  player: DriverInfo | null,
): string {
  if (!alert || alert.closingRatePerLap <= 0 || !player) return '--';
  const laps = alert.gapSeconds / Math.max(alert.closingRatePerLap, 0.1);
  return laps.toFixed(1);
}
