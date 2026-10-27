import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1421',
    browserName: 'chromium',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yakutsk',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  },
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  webServer: {
    command: 'npm run dev -- --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
