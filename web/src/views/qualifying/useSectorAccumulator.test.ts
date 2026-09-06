import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../../types/telemetry';
import { createSectorAccumulator } from './useSectorAccumulator';

const driver = (values: Partial<DriverInfo>): DriverInfo => ({
  index: 0, currentLapNum: 1, currentSector: 0, lastLapTime: 0, lapInvalid: false,
  sector1TimeMs: 0, sector2TimeMs: 0, ...values,
} as DriverInfo);

describe('official qualifying sector records', () => {
  it('uses official bests on late join and replaces a lower provisional record', () => {
    const acc = createSectorAccumulator();
    acc.ingest([driver({ sector1TimeMs: 20000, sector2TimeMs: 25000 })], 'Q1');
    expect(acc.ingest([driver({ currentLapNum: 2, lastLapTime: 80000 })], 'Q1').get(0))
      .toEqual({ bestS1: 20000, bestS2: 25000, bestS3: 35000 });
    const authoritative = driver({ currentLapNum: 2, sessionHistoryAvailable: true, bestSector1Ms: 30000, bestSector2Ms: 31000, bestSector3Ms: 32000 });
    expect(acc.ingest([authoritative], 'Q1').get(0)).toEqual({ bestS1: 30000, bestS2: 31000, bestS3: 32000 });
    expect(createSectorAccumulator().ingest([authoritative], 'Q1').get(0)).toEqual({ bestS1: 30000, bestS2: 31000, bestS3: 32000 });
    expect(acc.ingest([driver({ currentLapNum: 2, sessionHistoryAvailable: true })], 'Q1').get(0))
      .toEqual({ bestS1: 0, bestS2: 0, bestS3: 0 });
  });

  it('does not retain sectors from a lap invalidated before completion', () => {
    const acc = createSectorAccumulator();
    acc.ingest([driver({ sector1TimeMs: 20000 })], 'Q1');
    acc.ingest([driver({ sector1TimeMs: 20000, sector2TimeMs: 25000, lapInvalid: true })], 'Q1');
    acc.ingest([driver({ sector1TimeMs: 20000, sector2TimeMs: 25000 })], 'Q1');
    expect(acc.ingest([driver({ currentLapNum: 2, lastLapTime: 80000 })], 'Q1').get(0))
      .toEqual({ bestS1: 0, bestS2: 0, bestS3: 0 });
  });

  it('clears previous bests on an empty frame with a new identity', () => {
    const acc = createSectorAccumulator();
    acc.ingest([driver({ bestSector1Ms: 30000 })], 'one');
    expect(acc.ingest([], 'two').size).toBe(0);
    expect(acc.ingest([driver({})], 'two').get(0)?.bestS1).toBe(0);
  });
});
