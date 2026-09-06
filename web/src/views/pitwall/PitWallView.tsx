import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NavTabs } from '../../shell/NavTabs';
import { TelemetryWaitingActions } from '../../shell/TelemetryWaitingActions';
import type { ShellControls } from '../../shell/types';
import { useDisplayedLapHistory, useDisplayedSourceKey } from '../../store/replayDerivedStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { cornersFor, nextCornerNumber } from '../../constants/trackCorners';
import { deriveDriverCodes } from '../../utils/driverCodes';
import { getRaceStatus, getTrackCondition } from '../../utils/raceDisplay';
import { deriveLapCounter } from '../broadcast/derive/fieldDerivations';
import { buildCornerMarks, wrapPct } from '../../ui/TrackStrip.derive';
import { COL_ORDER } from './columns';
import { deriveLeaderboardRows } from './derive/leaderboardRows';
import { deriveMyCar } from './derive/myCar';
import { derivePitExit, pitExitUnavailableReason, type PitLossSource } from './derive/pitExit';
import { deriveTyreDetail } from './derive/tyreDetail';
import { deriveWeather } from './derive/weather';
import { DisplaySettings } from './DisplaySettings';
import { DriverDetailModal } from './DriverDetailModal';
import { LeaderboardPanel } from './LeaderboardPanel';
import { MyCarPanel } from './MyCarPanel';
import { PitExitPanel } from './PitExitPanel';
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
  const lapHistory = useDisplayedLapHistory((s) => s.history);
  const sourceKey = useDisplayedSourceKey();
  const [selection, setSelection] = useState<{ sourceKey: string; index: number } | null>(null);
  const openDriverIdx = selection?.sourceKey === sourceKey ? selection.index : null;
  const openTriggerRef = useRef<HTMLElement | null>(null);
  const openDriver = openDriverIdx !== null ? (drivers.find((d) => d.index === openDriverIdx) ?? null) : null;

  function openDriverDetail(index: number, triggerEl: HTMLElement) {
    openTriggerRef.current = triggerEl;
    setSelection({ sourceKey, index });
  }
  function closeDriverDetail() {
    setSelection(null);
    // 행 재정렬로 트리거가 사라졌을 수 있다 — 연결된 경우에만 포커스 복귀.
    if (openTriggerRef.current?.isConnected) openTriggerRef.current.focus();
    openTriggerRef.current = null;
  }
  // 표시 출처 변경이나 드라이버 소멸 시 같은 index가 다른 참가자를 가리키지 않도록 닫기.
  useEffect(() => {
    setSelection(null);
    openTriggerRef.current = null;
  }, [sourceKey]);
  useEffect(() => {
    if (openDriverIdx !== null && !drivers.some((d) => d.index === openDriverIdx)) {
      setSelection(null);
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
  const rows = useMemo(() => deriveLeaderboardRows(drivers, player, is2026, session, lapHistory), [drivers, player, is2026, session, lapHistory]);
  const myCar = useMemo(() => deriveMyCar(player, drivers, session), [player, drivers, session]);
  // 피트로스: 트랙 baseline(strategyGuide) 우선, 트랙값 부재가 '확정'(ready/unavailable)되면
  // 사용자 폴백값(초→ms)을 쓴다. 로딩 중(idle/loading)엔 null 유지 → 폴백값이 먼저 떴다가
  // 트랙값으로 점프하지 않는다. fallback 플래그로 출처를 pitExit VM에 전달(anti-fabrication 표기).
  const pitLoss = useMemo(() => {
    // 실측 최우선: 플레이어가 이미 피트했으면 마지막 스톱의 실측 레인 체류를 피트로스로 쓴다.
    const measured = player?.measuredPitLaneMs;
    if (measured != null && Number.isFinite(measured) && measured > 0) {
      return { ms: measured as number | null, source: 'measured' as PitLossSource };
    }
    const s = strategyGuide.data?.track.race_strategy?.pit_stop_time_lost_s;
    const trackMs = s != null && Number.isFinite(s) && s > 0 ? s * 1000 : null;
    if (trackMs != null) return { ms: trackMs as number | null, source: 'track' as PitLossSource };
    if (strategyGuide.status === 'ready' || strategyGuide.status === 'unavailable') {
      return { ms: prefs.pitLossSec * 1000, source: 'user' as PitLossSource };
    }
    return { ms: null as number | null, source: 'track' as PitLossSource };
  }, [player, strategyGuide.data, strategyGuide.status, prefs.pitLossSec]);
  const pitExit = useMemo(() => derivePitExit(player, drivers, pitLoss.ms, session, pitLoss.source), [player, drivers, pitLoss, session]);
  // Pit Exit 패널이 "Pit-loss data unavailable"로 뜨는 사유를 콘솔에 남긴다. 매 프레임 도배를
  // 피하려 pitExit이 null일 때의 사유가 '바뀔 때만' 로그한다(useMemo로 사유 문자열 안정화).
  const pitExitReason = useMemo(
    () => (pitExit == null ? pitExitUnavailableReason(player, drivers, pitLoss.ms) : null),
    [pitExit, player, drivers, pitLoss.ms],
  );
  useEffect(() => {
    if (pitExitReason) console.warn(`[PitExit] Pit-loss data unavailable — ${pitExitReason} (source=${pitLoss.source})`);
  }, [pitExitReason, pitLoss.source]);
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
    const nextCorner = nextCornerNumber(session?.trackId, player.lapDistance, len);
    // currentSector는 0-based(0=S1) — 1-based로 노출. 범위 밖(이상치)은 null로 미표시.
    const sec = player.currentSector;
    return {
      code: deriveDriverCodes(drivers).get(player.index) ?? '—',
      pct: wrapPct(player.lapDistance, len),
      sector: sec >= 0 && sec <= 2 ? sec + 1 : null,
      nextCornerText: nextCorner != null ? `→ T${nextCorner}` : null,
    };
  }, [player, drivers, session]);
  // 코너 마커는 트랙이 바뀔 때만 재계산 — deps를 프리미티브로 잡아 4Hz pitwallState
  // 객체 교체(참조 변경)마다 buildCornerMarks가 재실행되지 않게 한다.
  const trackId = session?.trackId;
  const trackLength = session?.trackLength;
  const cornerMarks = useMemo(() => {
    const cs = cornersFor(trackId, trackLength);
    return cs && trackLength ? buildCornerMarks(cs, trackLength) : null;
  }, [trackId, trackLength]);

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
          pitLossSec={prefs.pitLossSec}
          onChangePitLossSec={prefs.setPitLossSec}
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
            cornerMarks={cornerMarks}
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
          {prefs.panels.pitExit && <PitExitPanel vm={pitExit} />}
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
