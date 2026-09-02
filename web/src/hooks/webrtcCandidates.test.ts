import { describe, expect, it } from 'vitest';
import { enqueueBoundedCandidate, parseSignalingNegotiationId, takeCandidatesForGeneration } from './webrtcCandidates';

describe('remote candidate queue', () => {
  it('bounds candidates and flushes only the active PC/negotiation generation in order', () => {
    let queue = enqueueBoundedCandidate([], { generation: { pc: 1, negotiation: 1, signaling: 7 }, candidate: 'first' }, 3)!;
    queue = enqueueBoundedCandidate(queue, { generation: { pc: 2, negotiation: 1, signaling: 7 }, candidate: 'stale-pc' }, 3)!;
    queue = enqueueBoundedCandidate(queue, { generation: { pc: 1, negotiation: 1, signaling: 7 }, candidate: 'second' }, 3)!;

    const drained = takeCandidatesForGeneration(queue, { pc: 1, negotiation: 1, signaling: 7 });
    expect(drained.candidates).toEqual(['first', 'second']);
    expect(drained.remaining).toEqual([{ generation: { pc: 2, negotiation: 1, signaling: 7 }, candidate: 'stale-pc' }]);

    expect(enqueueBoundedCandidate(queue, { generation: { pc: 1, negotiation: 2, signaling: 8 }, candidate: 'next' }, 3)).toBeNull();
    expect(enqueueBoundedCandidate([], { generation: { pc: 1, negotiation: 2, signaling: 8 }, candidate: 'next' }, 0)).toBeNull();
  });

  it('accepts only legacy zero/omitted or a positive safe signaling generation', () => {
    expect(parseSignalingNegotiationId(undefined)).toBe(0);
    expect(parseSignalingNegotiationId(0)).toBe(0);
    expect(parseSignalingNegotiationId(42)).toBe(42);
    expect(parseSignalingNegotiationId(-1)).toBeNull();
    expect(parseSignalingNegotiationId(1.5)).toBeNull();
    expect(parseSignalingNegotiationId('42')).toBeNull();
  });
});
