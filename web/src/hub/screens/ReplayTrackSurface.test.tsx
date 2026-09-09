import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { boundaryMapPoints, incidentBoundaryPoints, loadTrackBoundaries, parseTrackBoundaries, type ReplayTrackBoundaries } from '../../constants/replayTrackBoundaries';
import { ReplayScaleBar, ReplayTrackSurface } from './ReplayTrackSurface';
import { makeReplayMap } from './analysisPlayback';
import { outlineFor } from './analysisTrack';
import type { IncidentReplay } from '../data/raceAnalysisTypes';

// Synthetic geometry for renderer verification only; never a circuit asset.
const fixture = (): ReplayTrackBoundaries => ({
  schemaVersion: 1, projection: 'single-surface-xz', trackId: 999, gameFormat: 'F1 26',
  provenance: { description: 'Synthetic test', gameVersion: 'test', verifiedAt: '2026-09-09' }, maxErrorM: null,
  segments: [{ id: 'road', sections: [
    { distance: 0, left: [-2, 0, 0], right: [8, 0, 0] },
    { distance: 10, left: [-3, 0, 10], right: [9, 0, 10] },
    { distance: 20, left: null, right: [10, 0, 20] },
    { distance: 30, left: [-3, 0, 30], right: [9, 0, 30] },
    { distance: 40, left: [-3, 0, 40], right: [9, 0, 40] },
  ] }, { id: 'bridge', sections: [
    { distance: 50, left: [30, 8, 10], right: [30, 8, 20] },
    { distance: 60, left: [40, 8, 10], right: [40, 8, 20] },
  ] }],
  features: [
    { kind: 'kerb', points: [[8, 0, 0], [9, 0, 10], [10, 0, 10], [9, 0, 0]] },
    { kind: 'wall', points: [[12, 0, 0], [12, 0, 40]] },
  ],
});
const project = (x: number, z: number) => ({ x: x * 10, y: -z * 10 });

describe('replay road boundaries', () => {
  it.each([
    [0, 'Melbourne'], [2, 'shanghai'], [3, 'Bahrain'], [4, 'Catalunya'], [5, 'Monaco'], [6, 'Montreal'],
    [7, 'Great Britain'], [8, 'Hungaroring'], [9, 'Spa Francorchamps'], [10, 'Monza'], [11, 'Singapore'],
    [12, 'Suzuka'], [13, 'Abu Dhabi'], [14, 'USA'], [16, 'Brazil'], [17, 'Austria'], [19, 'Mexico'],
    [20, 'Baku'], [23, 'Zandvoort'], [24, 'Imola'], [25, 'Jeddah'], [26, 'Miami'], [27, 'Qatar'], [28, 'Las Vegas'],
  ] as const)('loads canonical track %i as %s through strict geometry validation', async (id, name) => {
    const data = await loadTrackBoundaries(id, 'F1 25');
    expect(data?.provenance.description).toBe(`EA RaceNet · ${name} · 본선 흰선`);
    expect(data?.maxErrorM).toBeNull();
    expect(await loadTrackBoundaries(id, 'F1 26')).toBeNull();
    if (id !== 12 && id !== 28) {
      expect(data?.coverage).toBe('main-circuit');
      expect(data?.segments).toHaveLength(1);
    }
  });

  it('keeps both Suzuka overpass levels and malformed Vegas normals out of separate continuous runs', async () => {
    const suzuka = (await loadTrackBoundaries(12, 'F1 25'))!;
    const vegas = (await loadTrackBoundaries(28, 'F1 25'))!;
    for (const data of [suzuka, vegas]) {
      expect(data.coverage).toBe('main-circuit-partial');
      for (let i = 1; i < data.segments.length; i++) {
        const previous = data.segments[i - 1].sections;
        expect(data.segments[i].sections[0].distance).toBeGreaterThan(previous[previous.length - 1].distance);
      }
      const html = renderToStaticMarkup(<svg><ReplayTrackSurface boundaries={data} project={project} /></svg>);
      expect(html.match(/data-road-surface/g)).toHaveLength(data.trackId === 12 ? 354 : 330);
      expect(html).not.toMatch(/NaN|Infinity/);
    }
    expect(suzuka.segments.map(({ sections }) => sections.length - 1)).toEqual([168, 133, 53]);
    expect(vegas.segments.map(({ sections }) => sections.length - 1)).toEqual([94, 236]);
  });

  it('loads the audited Silverstone main road with signed, asymmetric white-line offsets and explicit closure', async () => {
    const data = await loadTrackBoundaries(7, 'F1 25');
    expect(data).not.toBeNull();
    expect(data!.coverage).toBe('main-circuit');
    expect(data!.maxErrorM).toBeNull();
    expect(data!.features).toEqual([]);
    expect(data!.segments).toHaveLength(1);
    const sections = data!.segments[0].sections;
    expect(sections).toHaveLength(342); // all 341 source main-route links, no pit links
    expect(sections[sections.length - 1].left).toEqual(sections[0].left);
    expect(sections[sections.length - 1].right).toEqual(sections[0].right);
    // Source gate 0 follows the closing link 340 -> 0. Its left offset is
    // positive; centering a guessed width or forcing it negative is incorrect.
    const gate = sections[1];
    expect(gate.left![0]).toBeCloseTo(-461.034 + 0.81029 * 0.0733297, 5);
    expect(gate.left![2]).toBeCloseTo(342.011 + 0.586029 * 0.0733297, 5);
    expect(gate.right![0]).toBeCloseTo(-461.034 + 0.81029 * 14.2949, 5);
    const widths = sections.map(({ left, right }) => Math.hypot(...left!.map((v, i) => v - right![i])));
    expect(Math.min(...widths)).toBeCloseTo(11.86112, 4);
    expect(Math.max(...widths)).toBeCloseTo(17.13918, 4);
    const html = renderToStaticMarkup(<svg><ReplayTrackSurface boundaries={data!} project={project} /></svg>);
    expect(html.match(/data-road-surface/g)).toHaveLength(341);
    expect(html).not.toMatch(/data-road-wall|NaN|Infinity/);
    expect(await loadTrackBoundaries(7, 'F1 26')).toBeNull();
    expect(parseTrackBoundaries(data, 5, 'F1 25')).toBeNull();
  });

  it('requires exact track and game identity and preserves missing sides and heights', () => {
    const data = fixture();
    expect(parseTrackBoundaries(data, 999, 'F1 26')).toEqual(data);
    expect(parseTrackBoundaries(data, 999, 'F1 25')).toBeNull();
    expect(parseTrackBoundaries(data, 5, 'F1 26')).toBeNull();
    expect(boundaryMapPoints(data)).toContainEqual([40, 20]);
    expect(data.segments[1].sections[0].left?.[1]).toBe(8);
  });

  it('rejects malformed, reversed and crossing sections without inventing repairs', () => {
    const nonfinite = fixture(); nonfinite.segments[0].sections[0].left![0] = NaN;
    expect(parseTrackBoundaries(nonfinite, 999, 'F1 26')).toBeNull();
    const reversed = fixture(); reversed.segments[0].sections[1].distance = 0;
    expect(parseTrackBoundaries(reversed, 999, 'F1 26')).toBeNull();
    const crossing = fixture();
    [crossing.segments[0].sections[1].left, crossing.segments[0].sections[1].right] = [crossing.segments[0].sections[1].right, crossing.segments[0].sections[1].left];
    expect(parseTrackBoundaries(crossing, 999, 'F1 26')).toBeNull();
    const empty = fixture(); empty.segments.forEach(({ sections }) => sections.forEach((section) => { section.left = null; section.right = null; }));
    expect(parseTrackBoundaries(empty, 999, 'F1 26')).toBeNull();
    expect(parseTrackBoundaries({ ...fixture(), provenance: {} }, 999, 'F1 26')).toBeNull();
    expect(parseTrackBoundaries({ ...fixture(), maxErrorM: -1 }, 999, 'F1 26')).toBeNull();
  });

  it('draws asymmetric variable width at world scale, keeping coverage gaps and branches separate', () => {
    const html = renderToStaticMarkup(<svg><ReplayTrackSurface boundaries={fixture()} project={project} /></svg>);
    expect(html.match(/data-road-surface/g)).toHaveLength(3);
    expect(html).toContain('M-20,0 L-30,-100 L90,-100 L80,0 Z');
    expect(html).toContain('data-boundary-segment="bridge"');
    expect(html.match(/data-road-wall/g)).toHaveLength(1);
    expect(html).not.toMatch(/NaN|Infinity/);
    const zoomed = renderToStaticMarkup(<svg><ReplayTrackSurface boundaries={fixture()} project={(x, z) => ({ x: x * 20 + 100, y: -z * 20 + 50 })} /></svg>);
    expect(zoomed).toContain('M60,50 L40,-150 L280,-150 L260,50 Z');
    // Gap rows have no surface, and the separated bridge never gains a joining polygon.
    expect(zoomed.match(/data-road-surface/g)).toHaveLength(3);
  });

  it('rejects actual overlapping road levels and zero-width surfaces', () => {
    const data = fixture();
    data.segments[1].sections = [
      { distance: 50, left: [-10, 8, 3], right: [-10, 8, 7] },
      { distance: 60, left: [20, 8, 3], right: [20, 8, 7] },
    ];
    expect(parseTrackBoundaries(data, 999, 'F1 26')).toBeNull();
    const zeroWidth = fixture();
    zeroWidth.segments[0].sections.forEach((section) => { section.right = section.left; });
    expect(parseTrackBoundaries(zeroWidth, 999, 'F1 26')).toBeNull();
    expect(parseTrackBoundaries({ ...fixture(), projection: 'layered' }, 999, 'F1 26')).toBeNull();
    // Adjacent measured patches may share a cross-section without overlapping.
    const continuous = fixture(); continuous.segments[0].sections[2].left = [-3, 0, 20];
    expect(parseTrackBoundaries(continuous, 999, 'F1 26')).not.toBeNull();
  });

  it('fits both road edges around a stationary car without fitting the whole circuit or moving the car', () => {
    const data = fixture();
    const points = incidentBoundaryPoints(data, [[0, 0, 0]]);
    expect(points).toContainEqual([-2, 0]);
    expect(points).toContainEqual([9, 10]);
    expect(points).not.toContainEqual([40, 20]);
    const incident: IncidentReplay = {
      raceId: 'test', index: 0, schemaVersion: 2, sessionTimeMs: 0, windowStartMs: 0, frameIntervalMs: 50,
      lap: 1, collisions: [], participants: [],
      completeness: { status: 'complete', reasons: [], capturedParticipantCount: 1, storedParticipantCount: 1, capturedFrameCount: 1, storedFrameCount: 1 },
      frames: [{ tMs: 0, cars: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]], telemetryUnavailable: [] }],
    };
    const outline = outlineFor(boundaryMapPoints(data));
    const local = makeReplayMap(incident, outline, 'incident', points);
    expect(local.bounds.minX).toBeLessThan(-3);
    expect(local.bounds.maxX).toBeGreaterThan(9);
    expect(local.bounds.maxX).toBeLessThan(30);
    expect(makeReplayMap(incident, outline, 'track').bounds.maxX).toBeGreaterThan(40);
    const offTrack = structuredClone(incident); offTrack.frames[0].cars[0]![0] = -100;
    expect(makeReplayMap(offTrack, outline, 'incident', incidentBoundaryPoints(data, [[-100, 0, 0]])).bounds.minX).toBeLessThan(-100);
    expect(offTrack.frames[0].cars[0]![0]).toBe(-100);
    expect(incidentBoundaryPoints(data, [])).toEqual([]);
  });

  it('shows a metre scale derived from the current camera, independent of pan', () => {
    const html = renderToStaticMarkup(<svg><ReplayScaleBar project={project} height={300} /></svg>);
    expect(html).toContain('data-scale-metres="5"');
    expect(html).toContain('M16,-4 V0 H66 V-4');
    const panned = renderToStaticMarkup(<svg><ReplayScaleBar project={(x, z) => ({ x: x * 10 + 200, y: -z * 10 + 200 })} height={300} /></svg>);
    expect(panned).toEqual(html);
  });

  it('reports unavailable rather than manufacturing a width for an unregistered circuit', async () => {
    expect(await loadTrackBoundaries(999, 'F1 26')).toBeNull();
    expect(await loadTrackBoundaries(5, 'unknown')).toBeNull();
  });
});
