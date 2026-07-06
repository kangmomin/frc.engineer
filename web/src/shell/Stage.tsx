import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 1600×900 고정 스테이지를 부모 크기에 맞춰 transform:scale 로 letterbox 피팅한다.
 * (Claude Design 목업의 fit() 로직 이식 — Broadcast/Pit Wall/Qualifying 공통)
 *
 * 주의: transform:scale 은 containing block 을 만들므로, 전역 오버레이(RemoteConnect,
 * PostRaceDebrief 등)는 Stage 의 자식이 아니라 형제로 렌더해야 뷰포트에 고정된다.
 */

const STAGE_W = 1600;
const STAGE_H = 900;

export function Stage({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastScaleRef = useRef(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;

    let raf = 0;
    const fit = () => {
      const vw = wrap.clientWidth || window.innerWidth;
      const vh = wrap.clientHeight || window.innerHeight;
      const k = Math.min(vw / STAGE_W, vh / STAGE_H);
      if (!k || k <= 0 || !Number.isFinite(k)) {
        raf = requestAnimationFrame(fit);
        return;
      }
      if (k === lastScaleRef.current) return;
      lastScaleRef.current = k;
      stage.style.transform = `scale(${k})`;
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0c0c0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={stageRef}
        style={{
          width: STAGE_W,
          height: STAGE_H,
          flex: 'none',
          transformOrigin: 'center center',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
