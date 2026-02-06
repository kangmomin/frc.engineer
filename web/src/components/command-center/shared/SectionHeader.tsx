import styles from './SharedComponents.module.css';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, rightContent }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeaderLeft}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {subtitle && <span className={styles.sectionSubtitle}>{subtitle}</span>}
      </div>
      {rightContent && (
        <div className={styles.sectionHeaderRight}>
          {rightContent}
        </div>
      )}
    </div>
  );
}
