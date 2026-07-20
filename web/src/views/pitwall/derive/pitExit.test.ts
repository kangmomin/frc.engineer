import { describe, expect, it } from 'vitest';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { derivePitExit } from './pitExit';

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0,
    name: 'Test Driver',
    teamId: 0,
    aiControlled: false,
    position: 1,
    currentLapNum: 1,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 0,
    bestLapTime: 0,
    tireCompound: 'medium',
    tireAge: 0,
    tireWear: [],
    tireSurfaceTemp: [],
    tireInnerTemp: [],
    brakeTemp: [],
    brakeBias: 0,
    diffOnThrottle: 0,
    diffOffThrottle: 0,
    fuelInTank: 0,
    fuelRemainingLaps: 0,
    fuelMix: 0,
    ersStoreEnergy: 0,
    ersDeployMode: 0,
    ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0,
    ersEstimatePct: 0,
    ersEstimateReady: false,
    ersActualPct: 0,
    ersActualReady: false,
    sector1TimeMs: 0,
    sector2TimeMs: 0,
    currentSector: 0,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 0,
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    weather: 'clear',
    trackTemp: 30,
    airTemp: 20,
    safetyCar: 'none',
    sessionType: 'Race',
    totalLaps: 50,
    trackId: 0,
    trackName: 'Test Track',
    trackLength: 5000,
    ...overrides,
  };
}

const PIT_LOSS = 20_000;
const me = makeDriver({ index: 0, name: 'Me', position: 5 });

/** 온트랙 레이싱 라이벌(resultStatus=2·pitStatus=0·position>0)로 정규화한 rival. */
function rival(overrides: Partial<DriverInfo>): DriverInfo {
  return makeDriver({ resultStatus: 2, pitStatus: 0, position: 2, lapDistance: 100, ...overrides });
}

/** 표준 필드(A 30s 앞·1stop, B 5s 뒤·0stop, C 25s 뒤·1stop, D 22s 뒤·1stop). */
function standardField(): DriverInfo[] {
  return [
    me,
    rival({ index: 1, name: 'Alpha', deltaToPlayer: -30_000, numPitStops: 1 }),
    rival({ index: 2, name: 'Bravo', deltaToPlayer: 5_000, numPitStops: 0 }),
    rival({ index: 3, name: 'Charlie', deltaToPlayer: 25_000, numPitStops: 1 }),
    rival({ index: 4, name: 'Delta', deltaToPlayer: 22_000, numPitStops: 1 }),
  ];
}

describe('derivePitExit — guards', () => {
  it('returns null when player is null', () => {
    expect(derivePitExit(null, standardField(), PIT_LOSS, makeSession())).toBeNull();
  });
  it('returns null when pit-loss is missing / non-finite / non-positive', () => {
    const f = standardField();
    expect(derivePitExit(me, f, null, makeSession())).toBeNull();
    expect(derivePitExit(me, f, 0, makeSession())).toBeNull();
    expect(derivePitExit(me, f, Number.NaN, makeSession())).toBeNull();
    expect(derivePitExit(me, f, -1, makeSession())).toBeNull();
  });
  it('returns null when no racing rival has a usable gap', () => {
    const f = [me, rival({ index: 1, name: 'Alpha', deltaToPlayer: undefined })];
    expect(derivePitExit(me, f, PIT_LOSS, makeSession())).toBeNull();
  });
  it('ignores inactive (garage/DNF) and pitting rivals in the projection', () => {
    const f = [
      me,
      rival({ index: 1, name: 'Alpha', deltaToPlayer: 5_000, numPitStops: 0 }), // only real neighbor
      makeDriver({ index: 2, name: 'Bravo', deltaToPlayer: 1_000, resultStatus: 4 }), // DNF → ignored
      rival({ index: 3, name: 'Charlie', deltaToPlayer: 500, pitStatus: 2 }), // pitting → ignored
    ];
    const vm = derivePitExit(me, f, PIT_LOSS, makeSession())!;
    // Alpha proj = 5000-20000 = -15s → ahead; nothing behind
    expect(vm.ahead?.code).toBe('ALP');
    expect(vm.behind).toBeNull();
    // coverage complete over racing rivals only (Bravo/Charlie excluded, not holes)
    expect(vm.approximate).toBe(false);
  });
});

describe('derivePitExit — racing-rival status filter (blacklist)', () => {
  it('includes an on-track car even when resultStatus is unreported (0)', () => {
    // 실측: 온트랙 레이싱 차가 resultStatus=0(omitempty)로 오는 세션 존재. 물리 신호로 포함해야 한다.
    const f = [
      me,
      makeDriver({ index: 1, name: 'Alpha', resultStatus: 0, pitStatus: 0, position: 2, lapDistance: 100, deltaToPlayer: 5_000, numPitStops: 0 }),
    ];
    const vm = derivePitExit(me, f, PIT_LOSS, makeSession())!;
    expect(vm).not.toBeNull();
    // proj = 5000-20000 = -15s → ahead
    expect(vm.ahead?.code).toBe('ALP');
  });

  it('excludes only explicit out-of-race statuses (DNF/DSQ/NC/retired)', () => {
    for (const rs of [4, 5, 6, 7]) {
      const f = [
        me,
        makeDriver({ index: 1, name: 'Out', resultStatus: rs, pitStatus: 0, position: 2, lapDistance: 100, deltaToPlayer: 5_000 }),
      ];
      // 유일한 상대가 아웃 상태 → 투영 가능한 라이벌 0 → null
      expect(derivePitExit(me, f, PIT_LOSS, makeSession())).toBeNull();
    }
  });
});

describe('derivePitExit — projection', () => {
  it('computes nearest ahead/behind, exit position, and traffic', () => {
    const vm = derivePitExit(me, standardField(), PIT_LOSS, makeSession())!;
    expect(vm).not.toBeNull();
    expect(vm.pitting).toBe(false);
    // A(-50s), B(-15s) ahead → P3
    expect(vm.estPosition).toBe(3);
    expect(vm.approximate).toBe(false);
    // nearest ahead = B(-15s), nearest behind = D(+2s)
    expect(vm.ahead?.code).toBe('BRA');
    expect(vm.ahead?.gapText).toBe('15.0s');
    expect(vm.ahead?.neverStopped).toBe(true);
    expect(vm.behind?.code).toBe('DEL');
    expect(vm.behind?.gapText).toBe('2.0s');
    expect(vm.behind?.neverStopped).toBe(false);
    // nearest = 2.0s (== TRAFFIC_WINDOW) → traffic
    expect(vm.space).toBe('traffic');
    expect(vm.pitLossText).toBe('20.0s');
  });

  it('classifies clear air when both neighbors are beyond the traffic window', () => {
    const f = [
      me,
      rival({ index: 1, name: 'Alpha', deltaToPlayer: -30_000, numPitStops: 1 }),
      rival({ index: 2, name: 'Bravo', deltaToPlayer: 5_000, numPitStops: 0 }),
      rival({ index: 3, name: 'Charlie', deltaToPlayer: 25_000, numPitStops: 1 }),
    ];
    // ahead B(-15s), behind C(+5s) → nearest 5s > 2s → clear
    expect(derivePitExit(me, f, PIT_LOSS, makeSession())!.space).toBe('clear');
  });

  it('flags DRS-range proximity when nearest neighbor is within 1.0s', () => {
    const f = [...standardField(), rival({ index: 5, name: 'Echo', deltaToPlayer: 20_500, numPitStops: 1 })];
    // Echo proj = +0.5s → nearest behind → drs
    expect(derivePitExit(me, f, PIT_LOSS, makeSession())!.space).toBe('drs');
  });

  it('breaks neighbor ties deterministically by index', () => {
    const f = [
      me,
      rival({ index: 5, name: 'Echo', deltaToPlayer: 22_000, numPitStops: 1 }),
      rival({ index: 4, name: 'Delta', deltaToPlayer: 22_000, numPitStops: 1 }),
    ];
    // both proj +2s → lower index (4 = Delta) wins the behind slot
    expect(derivePitExit(me, f, PIT_LOSS, makeSession())!.behind?.code).toBe('DEL');
  });
});

describe('derivePitExit — coverage', () => {
  it('marks approximate and suppresses space when an ON-TRACK rival gap is missing', () => {
    // Foxtrot is racing (resultStatus 2) but dead-level → deltaToPlayer omitempty → undefined
    const f = [...standardField(), rival({ index: 6, name: 'Foxtrot', deltaToPlayer: undefined })];
    const vm = derivePitExit(me, f, PIT_LOSS, makeSession())!;
    expect(vm.approximate).toBe(true);
    expect(vm.space).toBeNull();
    // 여전히 파생 가능한 이웃은 표시한다
    expect(vm.ahead?.code).toBe('BRA');
  });
});

describe('derivePitExit — active pit suppresses computed gaps', () => {
  it('force-open mode: null gaps/space/scenarios, passes through game rejoin', () => {
    const pittingMe = makeDriver({ index: 0, name: 'Me', position: 5, pitStatus: 1 });
    const f = [pittingMe, ...standardField().slice(1)];
    const vm = derivePitExit(pittingMe, f, PIT_LOSS, makeSession({ pitStopRejoinPosition: 7 }))!;
    expect(vm.pitting).toBe(true);
    expect(vm.gameRejoin).toBe(7);
    expect(vm.ahead).toBeNull();
    expect(vm.behind).toBeNull();
    expect(vm.space).toBeNull();
    expect(vm.scenarios).toHaveLength(0);
  });
});

describe('derivePitExit — scenarios (honest what-ifs)', () => {
  it('pivots on the non-pitted neighbor and frames S1/S2/S3 honestly', () => {
    const vm = derivePitExit(me, standardField(), PIT_LOSS, makeSession())!;
    expect(vm.scenarios.map((s) => s.key)).toEqual(['s1', 's2', 's3']);
    const [s1, s2, s3] = vm.scenarios;
    // pivot = Bravo (numPitStops 0), current gap +5s behind, projected -15s ahead
    expect(s1.label).toBe('They stay out');
    expect(s1.outcome).toBe('BRA ends 15.0s ahead of you');
    expect(s1.estimate).toBe(true);
    expect(s2.outcome).toContain('BRA');
    expect(s2.outcome).toContain('5.0s behind');
    expect(s2.outcome).toContain('equal pit-loss');
    expect(s2.estimate).toBe(true);
    // S3 must carry NO fabricated undercut number — qualitative only
    expect(s3.estimate).toBe(false);
    expect(s3.outcome).toContain('undercut');
    expect(s3.outcome).toContain('not modeled');
  });

  it('emits no scenarios when every nearby rival has already pitted', () => {
    const f = [
      me,
      rival({ index: 1, name: 'Alpha', deltaToPlayer: 5_000, numPitStops: 1 }),
      rival({ index: 2, name: 'Bravo', deltaToPlayer: 25_000, numPitStops: 2 }),
    ];
    // still projects position/neighbors, but no non-pitted pivot → no what-ifs
    const vm = derivePitExit(me, f, PIT_LOSS, makeSession())!;
    expect(vm.ahead?.code).toBe('ALP');
    expect(vm.scenarios).toHaveLength(0);
  });

  it('passes through the game rejoin position when present', () => {
    const vm = derivePitExit(me, standardField(), PIT_LOSS, makeSession({ pitStopRejoinPosition: 4 }))!;
    expect(vm.gameRejoin).toBe(4);
  });
});

describe('derivePitExit — pit-loss source', () => {
  it('defaults pitLossSource to track', () => {
    const vm = derivePitExit(me, standardField(), PIT_LOSS, makeSession())!;
    expect(vm.pitLossSource).toBe('track');
  });

  it('propagates the caller-provided source (user / measured)', () => {
    const u = derivePitExit(me, standardField(), PIT_LOSS, makeSession(), 'user')!;
    expect(u.pitLossSource).toBe('user');
    expect(u.pitLossText).toBe('20.0s'); // 폴백값도 정상 표시된다
    const m = derivePitExit(me, standardField(), PIT_LOSS, makeSession(), 'measured')!;
    expect(m.pitLossSource).toBe('measured');
  });

  it('forces source back to track while pitting when pit-loss is invalid', () => {
    const pittingMe = makeDriver({ index: 0, name: 'Me', position: 5, pitStatus: 1 });
    const f = [pittingMe, ...standardField().slice(1)];
    const vm = derivePitExit(pittingMe, f, null, makeSession(), 'user')!;
    expect(vm.pitting).toBe(true);
    expect(vm.pitLossText).toBeNull();
    expect(vm.pitLossSource).toBe('track'); // pitLossText가 null이면 출처 표기도 억제
  });
});
