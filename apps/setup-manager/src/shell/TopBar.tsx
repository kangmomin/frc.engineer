// Driver Pack 상단 바 — PitHub TopBar처럼 왼쪽 MONO 컨텍스트 라벨, 오른쪽 상태 박스.
import type { ReactNode } from "react";
import styles from "./shell.module.css";

export function TopBar({ context, children }: { context: string; children?: ReactNode }) {
  return (
    <header className={styles.topBar}>
      <div className={styles.topContext}>{context}</div>
      <div className={styles.topStatus}>{children}</div>
    </header>
  );
}

/** hub 화면 머리말: 큰 제목 + 보조 설명(Profile 화면 패턴). */
export function ScreenHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.screenHead}>
      <div className={styles.screenTitle}>{title}</div>
      <div className={styles.screenDetail}>{detail}</div>
    </div>
  );
}
