// Stub for "next/headers" — allows Vitest (jsdom) to import server modules
// that use cookies() / headers() without throwing a resolution error.
export const cookies = () => ({ getAll: () => [], set: () => {} });
export const headers = () => ({ get: () => null });
