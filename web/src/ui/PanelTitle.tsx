import type { ReactNode } from 'react';
import type { Tone } from './types';
import styles from './PanelTitle.module.css';
import toneStyles from './tone.module.css';

export interface PanelTitleProps {
  title: string;
  tone: Tone;
  detail?: string;
  endContent?: ReactNode;
}

export function PanelTitle({ title, tone, detail, endContent }: PanelTitleProps) {
  return (
    <div className={styles.panelTitle}>
      <div>
        <span className={`${styles.panelEyebrow} ${toneStyles[tone]}`}>{title}</span>
        {detail && <span className={styles.panelDetail}>{detail}</span>}
      </div>
      <div className={styles.panelTitleAside}>
        {endContent}
        <span className={`${styles.panelMarker} ${toneStyles[tone]}`} />
      </div>
    </div>
  );
}
