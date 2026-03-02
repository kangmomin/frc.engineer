import { useState } from 'react';
import { SeverityDot } from './shared/SeverityDot';
import styles from './SetupCard.module.css';

export type Severity = 'green' | 'yellow' | 'red';

interface SetupCardProps {
  title: string;
  severity: Severity;
  defaultOpen?: boolean;
  liveStrip: React.ReactNode;
  table?: React.ReactNode;
  recommendation?: React.ReactNode;
  readOnly?: boolean;
}

export function SetupCard({ title, severity, defaultOpen = true, liveStrip, table, recommendation, readOnly }: SetupCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.card}>
      <div className={styles.header} onClick={() => setOpen((o) => !o)}>
        <SeverityDot severity={severity} />
        <span className={styles.title}>{title}</span>
        <span className={`${styles.toggle} ${open ? styles.toggleOpen : ''}`}>&#9654;</span>
      </div>
      {open && (
        <div className={styles.body}>
          {!readOnly && <div className={styles.liveStrip}>{liveStrip}</div>}
          {table && <div className={styles.tableWrap}>{table}</div>}
          {recommendation}
        </div>
      )}
    </div>
  );
}
