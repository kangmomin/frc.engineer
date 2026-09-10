import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import type { IncidentReplay as IncidentReplayValue } from '../data/raceAnalysisTypes';
import { IncidentReplay } from './IncidentReplay';
import { replayDriverColor } from './analysisDriverDisplay';

const t = buildTheme('#e0a83d', 'light');
const replay: IncidentReplayValue = {
  raceId: 'race-a', index: 0, schemaVersion: 2, sessionTimeMs: 1_000, windowStartMs: 0, frameIntervalMs: 50, lap: 1,
  collisions: [[0, 23]],
  participants: [
    { idx: 0, name: 'Player', teamId: 0, isPlayer: true, minDistM: 0.5, damageBefore: null, damageAfter: null },
    { idx: 23, name: '', teamId: 255, isPlayer: false, minDistM: 1, damageBefore: null, damageAfter: null },
  ],
  frames: [{
    tMs: 1_000,
    cars: [[1, 0, 2, 3, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1], [4, 0, 5, 0, 0, 0, 1, 0, 0, 212, 1, 0, -0.5, 6]],
    telemetryUnavailable: [],
  }, {
    tMs: 1_070,
    cars: [[2, 0, 4, 3, 0, 4, 0, 0, 0, 10, 0.1, 0.2, 0.3, 2], [4, 0, 5, 0, 0, 0, 1, 0, 0, 212, 1, 0, -0.5, 6]],
    telemetryUnavailable: [23],
  }],
  completeness: { status: 'complete', reasons: [], capturedParticipantCount: 2, storedParticipantCount: 2, capturedFrameCount: 2, storedFrameCount: 2 },
};

describe('IncidentReplay', () => {
  it('assigns all 24 car indices distinct colors and matches teammate cars to their trajectories', () => {
    expect(new Set(Array.from({ length: 24 }, (_, idx) => replayDriverColor(idx))).size).toBe(24);
    const teammates = { ...replay, participants: replay.participants.map((p) => ({ ...p, teamId: 0 })) };
    const html = renderToStaticMarkup(<IncidentReplay t={t} replay={teammates} trackOutline={null} />);
    for (const idx of [0, 23]) {
      expect(html).toContain(`fill="${replayDriverColor(idx)}" data-driver-color="${idx}"`);
      expect(html).toMatch(new RegExp(`data-driver-trajectory="${idx}"[^>]*stroke="${replayDriverColor(idx)}"`));
      expect(html).toContain(`data-driver-control="${idx}"`);
    }
    expect(html).toContain('차량 + 라인');
    expect(html).toContain('차량만');
    expect(html).toContain('모두 숨기기');
  });

  it('SSR-renders an explicit local metre grid, non-colour vehicle IDs, and accessible controls', () => {
    const html = renderToStaticMarkup(<IncidentReplay t={t} replay={replay} trackOutline={null} />);
    expect(html).toContain('Incident-local metre grid');
    expect(html).toContain('Player · Car #0');
    expect(html).toContain('Car #23');
    expect(html).toContain('No team');
    expect(html).toContain('aria-valuetext');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('0.25×');
    expect(html).toContain('Speed');
    expect(html).toContain('x1="156.5"');
    expect(html).toContain('y1="101.5"');
  });

  it('keeps v2 zero values visible but suppresses all legacy speed/input values', () => {
    const v2Html = renderToStaticMarkup(<IncidentReplay t={t} replay={replay} trackOutline={null} />);
    expect(v2Html).toContain('>0.000 km/h<');
    expect(v2Html).toContain('>100.000%<');
    expect(v2Html).toContain('>-0.500<');
    const legacy = { ...replay, schemaVersion: 1, frames: [{ ...replay.frames[0], telemetryUnavailable: null }] };
    const legacyHtml = renderToStaticMarkup(<IncidentReplay t={t} replay={legacy} trackOutline={null} />);
    expect(legacyHtml).toContain('legacy freshness unknown');
    expect(legacyHtml).toContain('>—<');
  });

  it('renders an actual recorded centreline when one is available', () => {
    const html = renderToStaticMarkup(<IncidentReplay t={t} replay={replay} trackOutline={{ points: [[0, 0], [10, 5]], bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 5 } }} />);
    expect(html).toContain('Recorded track centreline');
    expect(html).not.toContain('Incident-local metre grid');
  });

  it('paints clip-end damage by part and marks only increases from the first collision', () => {
    const damaged = { ...replay, participants: [
      { ...replay.participants[0], damageBefore: [0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0], damageAfter: [42, 0, 0, 10, 0, 0, 0, 0, 100, 0, 0, 0] },
      { ...replay.participants[1], damageBefore: null, damageAfter: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ] };
    const html = renderToStaticMarkup(<IncidentReplay t={t} replay={damaged} trackOutline={null} />);
    expect(html).toContain('aria-label="Incident vehicle damage"');
    expect(html).toMatch(new RegExp(`data-damage-part="tyre-rl"[^>]*fill="${t.damageScale[3]}"`));
    expect(html).toMatch(new RegExp(`data-damage-part="tyre-fl"[^>]*fill="${t.damageScale[0]}"`));
    expect(html).toMatch(new RegExp(`data-damage-part="wing-fl"[^>]*fill="${t.damageScale[1]}"`));
    expect(html).toMatch(/data-damage-row="tyre-rl".*?>100%<span[^>]*> 구간 중 \+100</);
    // Floor was repaired from 20 to 10: no increase badge and no fallback to 20.
    expect(html).toMatch(/data-damage-row="floor".*?<dd>10%<\/dd>/);
    expect(html).not.toContain('data-damage-driver="23"');
  });

  it('omits the damage panel when no captured part is damaged', () => {
    const html = renderToStaticMarkup(<IncidentReplay t={t} replay={replay} trackOutline={null} />);
    expect(html).not.toContain('Incident vehicle damage');
  });
});
