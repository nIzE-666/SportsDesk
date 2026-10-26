/** Non-secret screen state, retained across unmounts within this app session. */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class ViewStateStore {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(
    private storage: () => ViewStorage | null = () =>
      typeof window === 'undefined' ? null : window.sessionStorage,
  ) {}
  read<T>(
    key: string,
    fallback: T,
    valid: (value: unknown) => boolean = (value) => typeof value === typeof fallback,
  ): T {
    if (this.values.has(key)) return this.values.get(key) as T;
    let value = fallback;
    try {
      const raw = this.storage()?.getItem(`sportsdesk.view.${key}`);
      if (raw !== null && raw !== undefined) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) value = parsed as T;
      }
    } catch {
      /* unavailable or malformed storage */
    }
    this.values.set(key, value);
    return value;
  }
  write<T>(key: string, value: T) {
    if (this.values.has(key) && Object.is(this.values.get(key), value)) return;
    this.values.set(key, value);
    try {
      this.storage()?.setItem(`sportsdesk.view.${key}`, JSON.stringify(value));
    } catch {
      /* memory state still works */
    }
    this.listeners.get(key)?.forEach((listener) => listener());
  }
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  reset() {
    this.values.clear();
    this.listeners.clear();
  }
}
export const viewState = new ViewStateStore();
