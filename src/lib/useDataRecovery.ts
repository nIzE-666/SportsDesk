import { useEffect, useRef } from 'react';

/** Refresh the mounted view after a background retry repairs its data resource. */
export function useDataRecovery(matches: (key: string) => boolean, reload: (key: string) => void) {
  const current = useRef({ matches, reload });
  current.current = { matches, reload };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const onRecovery = (event: Event) => {
      const key = (event as CustomEvent<{ key: string }>).detail?.key;
      if (!key || !current.current.matches(key)) return;
      pending.add(key);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const key of pending) if (current.current.matches(key)) current.current.reload(key);
        pending.clear();
      }, 0);
    };
    window.addEventListener('sportsdesk-data-recovered', onRecovery);
    return () => {
      window.removeEventListener('sportsdesk-data-recovered', onRecovery);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
