import { useSyncExternalStore } from 'react';
import { getString, setString } from '../features/football/storage';

export type InterfaceDesign = 'classic' | 'broadcast';
export const DESIGN_KEY = 'sportsdesk.design';

export function readInterfaceDesign(): InterfaceDesign {
  return getString(DESIGN_KEY) === 'broadcast' ? 'broadcast' : 'classic';
}

function subscribe(changed: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === DESIGN_KEY || event.key === null) changed();
  };
  window.addEventListener('sportsdesk-appearance-changed', changed);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener('sportsdesk-appearance-changed', changed);
    window.removeEventListener('storage', storageChanged);
  };
}

export function setInterfaceDesign(value: InterfaceDesign) {
  setString(DESIGN_KEY, value);
  window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
}

export function useInterfaceDesign() {
  return useSyncExternalStore(subscribe, readInterfaceDesign, () => 'classic' as const);
}
