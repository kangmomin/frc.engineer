import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import type { RaceAnalysisDetail as RaceAnalysisDetailValue, SectionCompleteness } from '../data/raceAnalysisTypes';
import { RaceAnalysisDetail } from './RaceAnalysisDetail';

const t = buildTheme('#e0a83d', 'light');
const complete: SectionCompleteness = { status: 'complete', reasons: [], capturedCount: 1, storedCount: 1 };
const detail: RaceAnalysisDetailValue = {
  id: 'race-a', track: { id: 1, name: 'Bahrain' }, sessionType: 'Race', gameFormat: 'F1 26',
  recordedAt: '2026-09-01T00:00:00Z', uploadedAt: '2026-09-01T01:00:00Z', finishPosition: 2,
  completedLaps: 2, bestLapMs: 90_000, schemaVersion: 2,
  laps: [{ lapNumber: 1, lapMs: 90_000, s1Ms: 30_000, s2Ms: 30_000, s3Ms: 30_000, tyre: 'Soft', valid: true }],
  stints: [{ compound: 'Soft', laps: 2, startLap: 1, endLap: 2, tireWearPct: 11 }],
  dynamics: [{ lapNumber: 1, understeerPct: 3, oversteerPct: 4, lockupCount: 1, spinCount: 0 }],
  penalties: { timePenaltySeconds: 5, warnings: 1, cornerCutWarnings: 0, unservedDriveThrough: 0, unservedStopGo: 0 },
  tyres: { finalCompound: 'Soft', finalAge: 2, averageWearPct: 10, peakWearPct: 12, finalSetWearPct: 11, lifeSpan: 20, usableLife: 18, lifeRemainingPct: 45 },
  events: [{ lap: 1, timestamp: 1_000, category: 'COLL', severity: 'warning', message: 'Contact', driverName: null }],
  pitMeasurement: { stops: 1, pitLaneTimeMs: 23_000, stationaryMs: 4_000 },
  trackOutline: null,
  incidents: [{ index: 0, sessionTimeMs: 1_000, windowStartMs: 0, frameIntervalMs: 50, lap: 1, collisions: [[0, 1]], participants: [{ idx: 0, name: 'Player', teamId: 0, isPlayer: true, minDistM: 1, damageBefore: null, damageAfter: null }], frameCount: 40, completeness: { status: 'partial', reasons: ['incident-window-truncated'], capturedParticipantCount: 1, storedParticipantCount: 1, capturedFrameCount: 50, storedFrameCount: 40 } }],
  sectionCompleteness: {
    laps: complete, sectors: complete, stints: complete, tyres: complete, dynamics: complete, penalties: complete,
    events: complete, pit: complete, trackOutline: { status: 'unavailable', reasons: ['track-outline-unavailable'], capturedCount: 0, storedCount: 0 },
    incidents: { status: 'partial', reasons: ['incident-window-truncated'], capturedCount: 1, storedCount: 1 },
  },
};

describe('RaceAnalysisDetail presentation', () => {
  it('renders every structured analysis section without an owner HTML iframe', () => {
    const html = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={detail} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    expect(html).toContain('Lap / sector');
    expect(html).toContain('Stints / tyres');
    expect(html).toContain('Dynamics');
    expect(html).toContain('Penalties / events');
    expect(html).toContain('Measured pit time');
    expect(html).toContain('Incidents');
    expect(html).toContain('partial');
    expect(html).not.toContain('<iframe');
  });

  it('calls a confirmed zero section zero rather than unavailable', () => {
    const zeroComplete: SectionCompleteness = { status: 'complete', reasons: [], capturedCount: 0, storedCount: 0 };
    const zero = { ...detail, events: [], sectionCompleteness: { ...detail.sectionCompleteness, events: zeroComplete } };
    expect(renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={zero} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />)).toContain('confirmed zero');
  });

  it('labels each mixed completeness notice with its exact section', () => {
    const mixed = {
      ...detail,
      sectionCompleteness: {
        ...detail.sectionCompleteness,
        laps: { ...complete, status: 'partial' as const, reasons: ['late-capture'] } as SectionCompleteness,
        sectors: { ...complete, status: 'unavailable' as const, reasons: ['source-missing'] } as SectionCompleteness,
        stints: { ...complete, status: 'unknown' as const, reasons: ['legacy-metadata-missing'] } as SectionCompleteness,
      },
    };
    const html = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={mixed} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    expect(html).toContain('Laps: partial data');
    expect(html).toContain('Sectors: unavailable');
    expect(html).toContain('Stints: unknown');
  });

  it('explains an empty incident list according to its own completeness status', () => {
    const empty = (incidents: SectionCompleteness) => ({
      ...detail,
      incidents: [],
      sectionCompleteness: { ...detail.sectionCompleteness, incidents },
    });
    const confirmed = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={empty({ ...complete, capturedCount: 0, storedCount: 0 })} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    const unavailable = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={empty({ status: 'unavailable', reasons: ['request-budget-dropped'], capturedCount: 1, storedCount: 0 })} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    const unknown = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={empty({ status: 'unknown', reasons: ['legacy-metadata-missing'], capturedCount: null, storedCount: null })} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    expect(confirmed).toContain('No incidents were confirmed for this race.');
    expect(unavailable).toContain('Incident clips are unavailable');
    expect(unavailable).toContain('clips were dropped for the request budget');
    expect(unknown).toContain('Incident availability is unknown for this legacy or unsupported analysis.');
  });

  it('wraps incident buttons in native list items instead of assigning listitem to buttons', () => {
    const html = renderToStaticMarkup(<RaceAnalysisDetail t={t} detail={detail} selectedIncidentIndex={null} onSelectIncident={vi.fn()} />);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>');
    expect(html).not.toMatch(/<button[^>]*role="listitem"/);
  });
});
