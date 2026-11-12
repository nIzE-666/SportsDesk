/**
 * Origin of the dev server Playwright starts. SPORTSDESK_E2E_PORT moves it off the default
 * 1421 so several checkouts can run their scenarios at the same time.
 */
export const E2E_PORT = Number(process.env.SPORTSDESK_E2E_PORT ?? 1421);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
