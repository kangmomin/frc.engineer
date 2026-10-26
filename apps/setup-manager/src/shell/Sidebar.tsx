// Driver Pack 사이드바 — PitHub Sidebar(web/src/hub/components/Sidebar.tsx)와 같은 구성:
// 로고, 번호가 붙은 MONO 내비게이션, 외부 링크, 하단 상태 블록.
import { DEFAULT_PLATFORM_BASE_URL } from "../lib/senderApi";
import styles from "./shell.module.css";

// hub Sidebar의 DISCORD_URL과 같은 공식 커뮤니티 서버.
const DISCORD_URL = "https://discord.gg/Vcxr49w4TX";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  short: string;
  idx: string;
}

export function Sidebar<T extends string>({
  items,
  active,
  onNav,
  senderConnected,
  senderMeta,
}: {
  items: ReadonlyArray<NavItem<T>>;
  active: T;
  onNav: (id: T) => void;
  senderConnected: boolean;
  senderMeta: string;
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandBars} aria-hidden="true">
          <span />
          <span />
        </div>
        <div className={styles.brandCopy}>
          <span className={styles.brandName}>frc</span>
          <span className={styles.brandDomain}>.engineer</span>
          <div className={styles.brandTag}>DRIVER PACK</div>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Driver Pack">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.navButton}${on ? ` ${styles.navActive}` : ""}`}
              onClick={() => onNav(item.id)}
              aria-current={on ? "page" : undefined}
              aria-label={item.label}
            >
              <span className={styles.navIndex}>{item.idx}</span>
              <span className={styles.navShort}>{item.short}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <a
        className={`${styles.navButton} ${styles.navLink}`}
        href={DEFAULT_PLATFORM_BASE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="PitHub 웹 허브 (브라우저에서 열림)"
      >
        <span className={styles.navIndex}>↗</span>
        <span className={styles.navShort}>PITHUB</span>
        <span className={styles.navLabel}>PITHUB</span>
      </a>
      <a
        className={`${styles.navButton} ${styles.navLink}`}
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="공식 디스코드 커뮤니티 (브라우저에서 열림)"
      >
        <span className={styles.navIndex}>↗</span>
        <span className={styles.navShort}>DISCORD</span>
        <span className={styles.navLabel}>DISCORD</span>
      </a>

      <div className={styles.footer} role="status">
        <div className={styles.footerDot} style={{ color: senderConnected ? "var(--ok)" : "var(--negRed)" }} aria-hidden="true">
          {senderConnected ? "◆" : "!"}
        </div>
        <div className={styles.footerCopy}>
          <div className={styles.footerTitle}>{senderConnected ? "Sender 연결됨" : "Sender 연결 끊김"}</div>
          <div className={styles.footerMeta} style={senderConnected ? { color: "var(--ok)" } : undefined}>
            {senderMeta}
          </div>
        </div>
      </div>
    </aside>
  );
}
