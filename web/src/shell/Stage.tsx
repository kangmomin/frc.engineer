import { type ReactNode } from 'react';

/**
 * 뷰포트를 꽉 채우는 반응형 스테이지. 내부 뷰(Broadcast/Pit Wall/Qualifying)는 모두
 * width:100%/height:100% + flex/grid 로 짜여 있어, 스테이지가 뷰포트 전체를 차지하면
 * 각 뷰가 화면 비율과 무관하게 왜곡·크롭·레터박스 없이 리플로우한다.
 *
 * 주의: 전역 오버레이(RemoteConnect, PostRaceDebrief 등)는 스테이지의 자식이 아니라
 * 형제로 렌더해 뷰포트에 고정한다(AppShell 참조).
 */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {children}
    </div>
  );
}
