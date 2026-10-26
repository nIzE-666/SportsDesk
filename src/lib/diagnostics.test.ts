import { expect, it } from 'vitest';
import { sanitizeDetails } from './diagnostics';
it('redacts keys, authorization, quoted JSON credentials and URL credentials or queries', () => {
  const report = sanitizeDetails(
    `pk_test_EXAMPLE123 Bearer AUTH_VALUE {"api_key":"KEY_VALUE","refresh_token":"REFRESH_VALUE"} password=PASS_VALUE https://user:pw@service.invalid/video.m3u8?token=QUERY_VALUE&signature=SIGNED_VALUE`,
  );
  for (const value of [
    'EXAMPLE123',
    'AUTH_VALUE',
    'KEY_VALUE',
    'REFRESH_VALUE',
    'PASS_VALUE',
    'QUERY_VALUE',
    'SIGNED_VALUE',
    'user:pw',
  ])
    expect(report).not.toContain(value);
  expect(report).toContain('https://service.invalid/video.m3u8');
});
