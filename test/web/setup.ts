// Node 26 defines a global `localStorage` getter that yields undefined without
// --localstorage-file, which shadows jsdom's. Install a minimal in-memory Storage.
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
