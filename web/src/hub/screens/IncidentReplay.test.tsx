import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import type { IncidentReplay as IncidentReplayValue } from '../data/raceAnalysisTypes';
import { IncidentReplay } from './IncidentReplay';

const t = buildTheme('#e0a83d', 'light');
const replay: IncidentReplayValue = {
  raceId: 'race-a', index: 0, schemaVersion: 2, sessionTimeMs: 1_000, windowStartMs: 0, frameIntervalMs: 50, lap: 1,
  collisions: [[0, 23]],
  participants: [
    { idx: 0, name: 'Player', teamId: 0, isPlayer: true, minDistM: 0.5 },
    { idx: 23, name: '', teamId: 255, isPlayer: false, minDistM: 1 },
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
    expect(v2Html).toContain('0 km/h');
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
});
