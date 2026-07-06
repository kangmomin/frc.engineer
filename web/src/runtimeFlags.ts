const searchParams = new URLSearchParams(window.location.search);

const mockParam = searchParams.get('mock');

/** Mock 피드 시나리오. 'quali'는 Phase 3(Qualifying 뷰) 검증용 — 기존 '1'(race) 동작은 불변(additive). */
export type MockScenario = 'race' | 'quali';

export const mockScenario: MockScenario = mockParam === 'quali' ? 'quali' : 'race';

export const isMockMode =
  import.meta.env.VITE_MOCK_MODE === '1' ||
  mockParam === '1' ||
  mockParam === 'quali';

export const isForcedRemoteMode =
  !!import.meta.env.VITE_SIGNALING_URL ||
  searchParams.has('remote');
