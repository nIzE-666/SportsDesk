import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it
  .runIf(process.platform === 'win32')
  .each([
    'verification-failure',
    'same-version',
    'publish-failure',
    'first-release',
    'missing-artifact',
    'restore-failure',
    'destination-conflict',
    'local-only',
  ])('keeps release files consistent: %s', (scenario) => {
  const output = execFileSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-File',
      fileURLToPath(new URL('../scripts/release-artifacts.test.ps1', import.meta.url)),
      '-Scenario',
      scenario,
    ],
    { encoding: 'utf8', timeout: 15_000 },
  );
  expect(output).toContain(`PASS ${scenario}`);
});
