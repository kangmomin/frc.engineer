import type { IncidentReplay } from '../data/raceAnalysisTypes';
import { participantName } from './analysisPlayback';
import { replayDriverColor, type DriverDisplayMode, type DriverVisibility } from './analysisDriverDisplay';
import styles from './Analysis.module.css';

export function ReplayDriverControls({ participants, visibility, onChange }: {
  participants: IncidentReplay['participants'];
  visibility: DriverVisibility;
  onChange: (visibility: DriverVisibility) => void;
}) {
  const visibleCount = participants.filter(({ idx }) => visibility[idx] !== 'hidden').length;
  const setAll = (mode: DriverDisplayMode) => onChange(Object.fromEntries(participants.map(({ idx }) => [idx, mode])));
  return <fieldset className={styles.driverControls}>
    <legend>드라이버 표시 · {visibleCount}/{participants.length}</legend>
    <div className={styles.controls}>
      <button type="button" onClick={() => setAll('full')}>모두 표시</button>
      <button type="button" onClick={() => onChange(Object.fromEntries(participants.map(({ idx }) => [idx, visibility[idx] === 'hidden' ? 'hidden' : 'car'])))}>라인 모두 끄기</button>
      <button type="button" onClick={() => setAll('hidden')}>모두 숨기기</button>
    </div>
    <div className={styles.driverList}>
      {participants.map((participant) => {
        const name = `${participantName(participant.name, participant.idx)} · #${participant.idx}`;
        return <label key={participant.idx} className={styles.driverControl} data-driver-control={participant.idx}>
          <span className={styles.driverName} title={name}>
            <span className={styles.driverSwatch} style={{ backgroundColor: replayDriverColor(participant.idx) }} aria-hidden="true" />
            <span>{name}{participant.isPlayer ? ' ★' : ''}</span>
          </span>
          <select aria-label={`${name} 표시`} value={visibility[participant.idx] ?? 'full'}
            onChange={(event) => onChange({ ...visibility, [participant.idx]: event.target.value as DriverDisplayMode })}>
            <option value="full">차량 + 라인</option>
            <option value="car">차량만</option>
            <option value="hidden">숨김</option>
          </select>
        </label>;
      })}
    </div>
    {visibleCount === 0 && <p className={styles.status} role="status">표시 중인 드라이버가 없습니다. 드라이버를 선택하거나 모두 표시를 눌러주세요.</p>}
  </fieldset>;
}
