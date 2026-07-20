import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NavTabs } from '../../shell/NavTabs';
import { TelemetryWaitingActions } from '../../shell/TelemetryWaitingActions';
import type { ShellControls } from '../../shell/types';
import { useLapHistoryStore } from '../../store/lapHistoryStore';
import { useRaceMetaStore } from '../../store/raceMetaStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { deriveDriverCodes } from '../../utils/driverCodes';
import { getRaceStatus, getTrackCondition } from '../../utils/raceDisplay';
import { deriveLapCounter } from '../broadcast/derive/fieldDerivations';
import { wrapPct } from '../../ui/TrackStrip.derive';
import { COL_ORDER } from './columns';
import { deriveLeaderboardRows } from './derive/leaderboardRows';
import { deriveMyCar } from './derive/myCar';
import { deriveTyreDetail } from './derive/tyreDetail';
import { deriveWeather } from './derive/weather';
import { DisplaySettings } from './DisplaySettings';
import { DriverDetailModal } from './DriverDetailModal';
import { LeaderboardPanel } from './LeaderboardPanel';
import { MyCarPanel } from './MyCarPanel';
import { PitWallHeader } from './PitWallHeader';
import { StrategyGuidePanel } from './StrategyGuidePanel';
import { TyreDetailStrip } from './TyreDetailStrip';
import { TyrePredictorPanel } from './TyrePredictorPanel';
import { useDisplayPrefs } from './useDisplayPrefs';
import { type RequestFn, useStrategyGuide } from './useStrategyGuide';
import { WeatherPanel } from './WeatherPanel';

export interface PitWallViewProps {
  controls: ShellControls;
  request: RequestFn;
}

/**
 * Pit Wall(RACE) 뷰 유일 stateful 컨테이너. Broadcast(Phase 1) BroadcastView와 동일 패턴 —
 * positions(60Hz)는 구독하지 않고 drivers/session/playerIndex/gameFormat 슬라이스만
 * useShallow로 구독한다(Phase 1 comp-H1 교훈).
 */
export function PitWallView({ controls, request }: PitWallViewProps) {
  const { driversRaw, session, playerIndex, gameFormat } = useTelemetryStore(
    useShallow((s) => ({
      driversRaw: s.pitwallState?.drivers,
      session: s.pitwallState?.session ?? null,
      playerIndex: s.pitwallState?.playerIndex ?? -1,
      gameFormat: s.pitwallState?.gameFormat,
    })),
  );

  const drivers = useMemo(() => [...(driversRaw ?? [])].sort((a, b) => a.position - b.position), [driversRaw]);
  const player = useMemo(() => drivers.find((d) => d.index === playerIndex) ?? null, [drivers, playerIndex]);
  const is2026 = gameFormat === 2026;

  const prefs = useDisplayPrefs();
  const strategyGuide = useStrategyGuide(request, session, gameFormat);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // ── 드라이버 상세 모달 (OPEN 버튼) ── openDriverIdx는 driver.index(안정 car index) 저장.
  const lapHistory = useLapHistoryStore((s) => s.history);
  const epoch = useRaceMetaStore((s) => s.epoch);
  const [openDriverIdx, setOpenDriverIdx] = useState<number | null>(null);
  const openTriggerRef = useRef<HTMLElement | null>(null);
  const openDriver = openDriverIdx !== null ? (drivers.find((d) => d.index === openDriverIdx) ?? null) : null;

  function openDriverDetail(index: number, triggerEl: HTMLElement) {
    openTriggerRef.current = triggerEl;
    setOpenDriverIdx(index);
  }
  function closeDriverDetail() {
    setOpenDriverIdx(null);
    // 행 재정렬로 트리거가 사라졌을 수 있다 — 연결된 경우에만 포커스 복귀.
    if (openTriggerRef.current?.isConnected) openTriggerRef.current.focus();
    openTriggerRef.current = null;
  }
  // 세션 리스타트(epoch)나 드라이버 소멸 시 같은 index가 다른 참가자를 가리키지 않도록 자동 닫기.
  useEffect(() => {
    setOpenDriverIdx(null);
  }, [epoch]);
  useEffect(() => {
    if (openDriverIdx !== null && !drivers.some((d) => d.index === openDriverIdx)) {
      setOpenDriverIdx(null);
    }
  }, [openDriverIdx, drivers]);
  // 팝오버를 닫을 때(Escape/× 클릭 모두) 트리거 버튼으로 포커스를 되돌린다(FIX-6, 비-모달
  // 팝오버 표준 패턴) — DisplaySettings 자신은 자기 트리거를 모르므로 여기서 처리한다.
  function closeSettings() {
    setSettingsOpen(false);
    settingsButtonRef.current?.focus();
  }

  // rows/myCar/lapCounter를 게이트 앞에서 useMemo로 고정한다(FIX-3/comp-H1) — 컬럼 리사이즈
  // 드래그·설정 팝오버 토글 등 이 값들과 무관한 리렌더마다 파생 전체를 재계산하지 않도록 한다.
  // 각 derive 함수는 session=null/drivers=[]에 안전하므로 게이트 이전에 호출해도 무방하다.
  const rows = useMemo(() => deriveLeaderboardRows(drivers, player, is2026, session), [drivers, player, is2026, session]);
  const myCar = useMemo(() => deriveMyCar(player, drivers, session), [player, drivers, session]);
  const tyreDetail = useMemo(() => deriveTyreDetail(player), [player]);
  const lapCounter = useMemo(() => deriveLapCounter(drivers, session), [drivers, session]);
  // WeatherPanel은 VM만 받는 순수 컴포넌트다(Spec §2 VM-only, FIX-4) — 컨테이너가 조립한다.
  const weather = useMemo(() => deriveWeather(session, prefs.weatherStep), [session, prefs.weatherStep]);
  // 리더보드 상단 현 위치 스트립 — 트랙 길이/거리 비유한 시 null(0% 마커 fabrication 금지).
  const trackPos = useMemo(() => {
    const len = session?.trackLength;
    if (!player || len === undefined || !Number.isFinite(len) || len <= 0 || !Number.isFinite(player.lapDistance)) {
      return null;
    }
    return {
      code: deriveDriverCodes(drivers).get(player.index) ?? '—',
      pct: wrapPct(player.lapDistance, len),
    };
  }, [player, drivers, session]);

  // ── 게이트(모든 hook 이후) ── Broadcast와 달리 비-Race 세션 게이트는 두지 않는다
  // (cockpit은 practice/race 모두 유효; quali는 QUALI 탭이 별도, Spec §1).
  if (!session || drivers.length === 0) {
    return <PitWallEmpty controls={controls} />;
  }

  // ── 순수 파생(메모이즈 대상 아님 — 저비용) ──
  const raceStatus = getRaceStatus(session);
  const cond = getTrackCondition(session.weather);
  const activeColCount = COL_ORDER.filter((k) => prefs.cols[k]).length;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <PitWallHeader
        controls={controls}
        gpTitle={(session.trackName ?? '').toUpperCase() || 'GRAND PRIX'}
        gpSubtitle={`Cockpit · ${session.sessionType}`}
        lap={lapCounter}
        weather={{
          weather: session.weather,
          condLabel: cond.label,
          trackTemp: session.trackTemp,
          airTemp: session.airTemp,
          iconColor: cond.tone === 'wet' ? 'var(--accent-soft)' : 'var(--accent)',
        }}
        status={raceStatus}
        is2026={is2026}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        settingsButtonRef={settingsButtonRef}
      />
      {settingsOpen && (
        <DisplaySettings
          cols={prefs.cols}
          onToggleCol={prefs.toggleCol}
          panels={prefs.panels}
          onTogglePanel={prefs.togglePanel}
          onResetWidths={prefs.resetWidths}
          is2026={is2026}
          onClose={closeSettings}
        />
      )}
      <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 306px', gap: 11 }}>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <LeaderboardPanel
            rows={rows}
            cols={prefs.cols}
            colW={prefs.colW}
            is2026={is2026}
            detail={`${drivers.length} Cars · ${activeColCount} fields · ${is2026 ? 'F1 26' : 'F1 25'}`}
            trackPos={trackPos}
            openDriverIndex={openDriverIdx}
            onOpenDriver={openDriverDetail}
            onResizeStart={prefs.startResize}
            onNudgeWidth={prefs.nudgeWidth}
          />
          {prefs.panels.tyres && tyreDetail && (
            <TyreDetailStrip detail={tyreDetail} driverName={player ? player.name : '—'} />
          )}
        </div>
        <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto' }}>
          {prefs.panels.myCar && <MyCarPanel car={myCar} detail={player ? player.name : '—'} />}
          {prefs.panels.predictor && <TyrePredictorPanel player={player} />}
          {prefs.panels.weather && (
            <WeatherPanel weather={weather} weatherStep={prefs.weatherStep} onStepChange={prefs.setWeatherStep} />
          )}
          {prefs.panels.strategy && <StrategyGuidePanel state={strategyGuide} is2026={is2026} />}
        </aside>
      </main>
      {openDriver && (
        <DriverDetailModal
          focus={openDriver}
          drivers={drivers}
          playerIndex={playerIndex}
          history={lapHistory}
          onClose={closeDriverDetail}
        />
      )}
    </div>
  );
}

function PitWallEmpty({ controls }: { controls: ShellControls }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: '11px 18px', boxShadow: 'var(--shadow-panel)' }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16 }}>RACE</div>
      </header>
      <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 18, color: 'var(--text-secondary)' }}>Waiting for telemetry stream…</div>
        <TelemetryWaitingActions controls={controls} />
      </div>
    </div>
  );
}
