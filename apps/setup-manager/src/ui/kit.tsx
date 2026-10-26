import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import styles from "./kit.module.css";

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/** hub 카드: 제목(굵게) + 보조 설명 + 우측 액션. */
export function Panel({
  title,
  detail,
  actions,
  children,
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.panelTitle}>{title}</div>
          {detail ? <div className={styles.panelDetail}>{detail}</div> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

/** 패널 안의 하위 묶음. */
export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.card}>
      {title || aside ? (
        <div className={styles.cardHead}>
          {title ? <span className={styles.eyebrow}>{title}</span> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Hint({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className={styles.hint} style={style}>{children}</div>;
}

/** 등폭 컬럼 그리드. */
export function Grid({ cols, gap, children, style }: { cols: number | string; gap?: number; children: ReactNode; style?: CSSProperties }) {
  const template = typeof cols === "number" ? `repeat(${cols}, minmax(0, 1fr))` : cols;
  return (
    <div className={styles.grid} style={{ gridTemplateColumns: template, ...(gap !== undefined ? { gap } : null), ...style }}>
      {children}
    </div>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className={styles.row} style={style}>{children}</div>;
}

/** 좌우 양끝 정렬(설명 + 액션). */
export function Spread({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className={styles.spread} style={style}>{children}</div>;
}

/** primary = 액센트, secondary = 경고/오류, tertiary = 정상, neutral = 기본 글자색. */
export type Tone = "primary" | "secondary" | "tertiary" | "neutral";

const METRIC_TONE: Record<Tone, string> = {
  primary: styles.tonePrimary,
  secondary: styles.toneSecondary,
  tertiary: styles.toneTertiary,
  neutral: styles.toneNeutral,
};

/** hub 지표 타일: MONO 라벨 + 굵은 값. */
export function MetricTile({ label, value, tone = "neutral", note }: { label: string; value: string; tone?: Tone; note?: string }) {
  return (
    <div className={cx(styles.metric, METRIC_TONE[tone])}>
      <span className={styles.label}>{label}</span>
      <strong className={styles.metricValue} title={value}>{value}</strong>
      {note ? <small className={styles.metricNote}>{note}</small> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "go" | "danger" | "ghost";

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], size === "sm" && styles.sm, busy && styles.busy, className)}
      {...rest}
    />
  );
}

/** 선택형 타일 버튼. */
export function OptionButton({
  selected,
  title,
  meta,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  title: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={selected} className={cx(styles.option, selected && styles.optionSelected)} onClick={onClick} disabled={disabled}>
      <span className={styles.optionTitle}>{title}</span>
      {meta ? <span className={styles.optionMeta}>{meta}</span> : null}
      {children}
    </button>
  );
}

export function Field({ label, children, style }: { label: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className={styles.field} style={style}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(styles.input, className)} {...rest} />;
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(styles.input, className)} {...rest} />;
}

export function Range({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" className={cx(styles.range, className)} {...rest} />;
}

export function Check({
  checked,
  onChange,
  boxed = false,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  boxed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cx(styles.check, boxed && styles.checkBoxed)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export type NoticeTone = "error" | "info" | "success" | "warn";

const NOTICE_TONE: Record<NoticeTone, string> = {
  error: styles.toneError,
  info: styles.toneInfo,
  success: styles.toneSuccess,
  warn: styles.toneWarn,
};

export function Notice({
  tone,
  title,
  action,
  children,
}: {
  tone: NoticeTone;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx(styles.notice, NOTICE_TONE[tone])} role={tone === "error" ? "alert" : "status"}>
      <div style={{ minWidth: 0 }}>
        {title ? <div className={styles.noticeTitle}>{title}</div> : null}
        {children}
      </div>
      {action}
    </div>
  );
}

export type PillTone = "accent" | "lime" | "red" | "soft" | "muted";

const PILL_TONE: Record<PillTone, string> = {
  accent: styles.toneInfo,
  lime: styles.toneSuccess,
  red: styles.toneError,
  soft: styles.toneWarn,
  muted: styles.toneMuted,
};

/** 점 + MONO 라벨 상태 박스(hub TopBar 크레딧 박스 패턴). */
export function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span className={cx(styles.pill, PILL_TONE[tone])}>
      <span className={styles.pillDot} />
      <span className={styles.pillLabel}>{label}</span>
    </span>
  );
}

export function Badge({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <span className={styles.badge} style={color ? ({ "--tone": color } as CSSProperties) : undefined}>
      {children}
    </span>
  );
}

/** 낮을수록 좋은 값(타이어 마모 등)의 진행 막대. */
export function MetricBar({ value, min, max }: { value: number; min: number; max: number }) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
  const color = percent < 33 ? "var(--ok)" : percent < 66 ? "var(--warn)" : "var(--negRed)";
  return (
    <div className={styles.bar}>
      <div className={styles.barFill} style={{ width: `${percent}%`, background: color }} />
    </div>
  );
}

/** 전면 모달(페어링 게이트·강제 업데이트). */
export function Modal({ zIndex, children }: { zIndex: number; children: ReactNode }) {
  return (
    <div className={styles.overlay} style={{ zIndex }}>
      <div className={styles.modal}>{children}</div>
    </div>
  );
}
