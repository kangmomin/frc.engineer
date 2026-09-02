export interface CandidateGeneration {
  pc: number;
  negotiation: number;
  signaling: number;
}

export interface QueuedCandidate<T> {
  generation: CandidateGeneration;
  candidate: T;
}

export function enqueueBoundedCandidate<T>(
  queue: QueuedCandidate<T>[],
  candidate: QueuedCandidate<T>,
  limit: number,
): QueuedCandidate<T>[] | null {
  if (!Number.isInteger(limit) || limit <= 0 || queue.length >= limit) {
    return null;
  }
  return [...queue, candidate];
}

export function takeCandidatesForGeneration<T>(
  queue: QueuedCandidate<T>[],
  generation: CandidateGeneration,
): { candidates: T[]; remaining: QueuedCandidate<T>[] } {
  const candidates: T[] = [];
  const remaining: QueuedCandidate<T>[] = [];
  for (const entry of queue) {
    if (entry.generation.pc === generation.pc
      && entry.generation.negotiation === generation.negotiation
      && entry.generation.signaling === generation.signaling) {
      candidates.push(entry.candidate);
    } else {
      remaining.push(entry);
    }
  }
  return { candidates, remaining };
}

/** Zero/omitted is the legacy sender path; positive safe integers are correlated offers. */
export function parseSignalingNegotiationId(value: unknown): number | null {
  if (value === undefined || value === 0) return 0;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
