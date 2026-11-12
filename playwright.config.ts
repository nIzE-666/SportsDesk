import { defineConfig } from '@playwright/test';
import { E2E_ORIGIN, E2E_PORT } from './e2e/origin';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: E2E_ORIGIN,
    browserName: 'chromium',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yakutsk',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  },
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
