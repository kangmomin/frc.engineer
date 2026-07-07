const searchParams = new URLSearchParams(window.location.search);

export const isMockMode =
  import.meta.env.VITE_MOCK_MODE === '1' ||
  searchParams.get('mock') === '1';
