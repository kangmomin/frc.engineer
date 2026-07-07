import { describe, expect, it } from 'vitest';
import { RACE_SUMMARY_SCHEMA_VERSION, resolveSummarySchema } from './telemetry';

describe('resolveSummarySchema', () => {
  it('treats an absent schemaVersion as legacy (pre-versioning summary)', () => {
    expect(resolveSummarySchema({ schemaVersion: undefined })).toBe('legacy');
  });

  it('treats schemaVersion 0 as legacy', () => {
    expect(resolveSummarySchema({ schemaVersion: 0 })).toBe('legacy');
  });

  it('classifies the current version as rich', () => {
    expect(resolveSummarySchema({ schemaVersion: RACE_SUMMARY_SCHEMA_VERSION })).toBe('rich');
  });

  it('classifies a higher, unknown version as unknownFuture', () => {
    expect(resolveSummarySchema({ schemaVersion: RACE_SUMMARY_SCHEMA_VERSION + 1 })).toBe('unknownFuture');
  });
});
