import { useSyncExternalStore } from 'react';
import { getString, setString } from '../features/football/storage';

/**
 * Temporary U2.2 flag: `1` turns the five-section frame on, anything else keeps
 * the current frame. The key is not part of the profile and is removed in U2.11
 * together with the old frame.
 */
export const SHELL_PREVIEW_KEY = 'sportsdesk.preview.shell';

export function readShellPreview(): boolean {
  return getString(SHELL_PREVIEW_KEY) === '1';
}

export function writeShellPreview(enabled: boolean): void {
  setString(SHELL_PREVIEW_KEY, enabled ? '1' : '0');
}

function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === SHELL_PREVIEW_KEY || event.key === null) changed();
  };
  const local = (event: Event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (!key || key === SHELL_PREVIEW_KEY) changed();
  };
  window.addEventListener('storage', storage);
  window.addEventListener('sportsdesk-storage-changed', local);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('sportsdesk-storage-changed', local);
  };
}

export function useShellPreview(): boolean {
  return useSyncExternalStore(subscribe, readShellPreview, () => false);
}
