import type { Page, Route } from '@playwright/test';

/** TEST DATA ONLY: invented channels for the «Смотреть» catalog, no real streams. */
export const WATCH_CHANNELS = [
  { id: 1, title: 'OKKO Football' },
  { id: 2, title: 'Матч ТВ' },
  { id: 3, title: 'Sky Sports F1' },
  { id: 4, title: 'Football 1' },
  { id: 5, title: 'OKKO Sport' },
  { id: 6, title: 'Дом кино' },
];

export const WATCH_FAVORITES = [1, 2];
export const WATCH_RECENT = [3, 6];

/** A stream address that the fixture answers with a picture, so HLS fails honestly. */
export const WATCH_FAILING_CHANNEL = {
  id: 99,
  title: 'Тестовый поток',
  url: 'https://streams.test/fail.m3u8',
};

export type WatchRouteHandler = (route: Route) => Promise<void>;

/**
 * Answers the Kino commands on top of the shared visual fixture; every other
 * command falls through to that fixture. No secret store is read.
 */
export async function mockWatchAccount(
  page: Page,
  signedIn: boolean,
  channels: readonly { id: number; title: string; logo?: string; url?: string }[] = WATCH_CHANNELS,
): Promise<WatchRouteHandler> {
  const handler: WatchRouteHandler = async (route) => {
    const body = route.request().postDataJSON() as { command?: string } | null;
    switch (body?.command) {
      case 'secret_status':
        return route.fulfill({ json: { pitch: true, kino: signedIn } });
      case 'kino_channels':
        return route.fulfill({ json: channels });
      case 'kino_logout':
        return route.fulfill({ json: { ok: true } });
      case 'kino_begin_auth':
        return route.fulfill({ json: { sessionId: 'watch-e2e' } });
      case 'kino_start_auth':
        return route.fulfill({
          json: {
            code: 'device',
            userCode: 'E2E-CODE',
            verificationUri: 'https://kino.watch/device',
            expiresIn: 300,
            interval: 60,
          },
        });
      case 'kino_poll_auth':
        return route.fulfill({ json: { pending: true } });
      default:
        return route.fallback();
    }
  };
  await page.route('**/bridge/command', handler);
  return handler;
}

/** Puts the signed-in fixture preferences in place before the screen mounts. */
export async function seedWatchPreferences(page: Page): Promise<void> {
  await page.addInitScript(
    ({ favorites, recent }) => {
      localStorage.setItem('sportsdesk.watch.favorites', JSON.stringify(favorites));
      localStorage.setItem('sportsdesk.watch.recent', JSON.stringify(recent));
      localStorage.setItem('sportsdesk.watch.view', 'grid');
    },
    { favorites: WATCH_FAVORITES, recent: WATCH_RECENT },
  );
}
