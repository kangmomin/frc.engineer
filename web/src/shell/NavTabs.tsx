import type { ViewId } from './viewNav';
import styles from './NavTabs.module.css';

/** 공통 헤더 nav — 각 뷰의 헤더 좌측에 임베드된다 (목업 구조). */

const TABS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'pitwall', label: 'RACE' },
  { id: 'qualifying', label: 'QUALI' },
  { id: 'broadcast', label: 'WORLD FEED' },
];

interface NavTabsProps {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  /** 특정 탭 비활성화 (예: 비-quali 세션에서 QUALI). active 탭은 항상 활성. */
  disabled?: Partial<Record<ViewId, boolean>>;
}

export function NavTabs({ active, onNavigate, disabled }: NavTabsProps) {
  return (
    <div className={styles.tabs}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const isDisabled = !isActive && Boolean(disabled?.[tab.id]);
        return (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tab} ${isActive ? styles.active : ''}`.trim()}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (!isActive && !isDisabled) onNavigate(tab.id);
            }}
            disabled={isDisabled}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
