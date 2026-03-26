const searchParams = new URLSearchParams(window.location.search);

export const isMockMode =
  import.meta.env.VITE_MOCK_MODE === '1' ||
  searchParams.get('mock') === '1';

export const isForcedRemoteMode =
  !!import.meta.env.VITE_SIGNALING_URL ||
  searchParams.has('remote');
