import { useEffect } from 'react';
import { subscribePlaybackContext } from '../atmosphere/playbackContext';
import { usePollerSync } from './usePoller';
import { useProfileMirror } from '../settings/profileBackup';

/**
 * SportsNotifications is now a thin client of the Rust background poller.
 *
 * The native side (src-tauri/src/poller.rs):
 * - runs one shared tick (60s base, backoff up to 15min on errors),
 * - reuses the SQLite cache + TTLs + stale fallback of every other request,
 * - de-duplicates notifications persistently (survives restarts),
 * - sends native notifications itself, so delivery works while the window is
 *   hidden in the tray and does not depend on any screen being open.
 *
 * This component only pushes the user's settings (enabled + favourite team
 * names from localStorage) to Rust and listens for match-event pings so the
 * open UI can react (a light refresh signal for live views).
 */
export function SportsNotifications() {
  usePollerSync();
  useProfileMirror();

  useEffect(() => {
    const stopTrackingVisibility = subscribePlaybackContext(() => undefined);
    let unlisten: (() => void) | null = null;
    let active = true;

    const subscribe = async () => {
      try {
        const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
        if (!isTauri) return;
        const mod = await import('@tauri-apps/api/event');
        const stop = await mod.listen<{ title: string; body: string }>(
          'sportsdesk://match-event',
          () => {
            // Match data changed in the background; nudge live views to refresh.
            window.dispatchEvent(new CustomEvent('sportsdesk-live-refresh'));
          },
        );
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
      } catch {
        /* events unavailable in dev browser mode */
      }
    };

    void subscribe();
    return () => {
      active = false;
      unlisten?.();
      stopTrackingVisibility();
    };
  }, []);

  return null;
}

export default SportsNotifications;
