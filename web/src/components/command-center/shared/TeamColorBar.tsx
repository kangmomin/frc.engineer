import { getTeamColor } from '../../../constants/teamColors';
import styles from './SharedComponents.module.css';

interface TeamColorBarProps {
  teamId: number;
  position?: 'left' | 'top';
}

export function TeamColorBar({ teamId, position = 'left' }: TeamColorBarProps) {
  const color = getTeamColor(teamId);

  return (
    <div
      className={`${styles.teamColorBar} ${styles[position]}`}
      style={{ backgroundColor: color }}
    />
  );
}
