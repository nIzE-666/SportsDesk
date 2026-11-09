import { useEffect } from 'react';
import { isTauriRuntime } from '../../lib/bridge';
import { playRadioSignal } from './soundEngine';

/**
 * Радиосигнал к уже доставленному напоминанию F1. Rust присылает событие
 * только после показа уведомления, поэтому фильтры и тихие часы уже учтены.
 */
export function TeamRadioSignal() {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let off: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ radio?: boolean }>('sportsdesk://f1-reminder', (event) => {
        if (event.payload?.radio) playRadioSignal();
      }).then((unlisten) => {
        if (active) off = unlisten;
        else unlisten();
      }),
    );
    return () => {
      active = false;
      off?.();
    };
  }, []);
  return null;
}
