import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { allowedProfileKey, PROFILE_EXACT_KEYS, PROFILE_KEY_PREFIXES } from './profileBackup';

// The app sends every key its own list allows, and the native side rejects
// the whole export or backup when it meets one key it does not know.
function rustList(name: string): string[] {
  const source = readFileSync(join(process.cwd(), 'src-tauri/src/profile.rs'), 'utf8');
  const body = source.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`))?.[1];
  if (body === undefined) throw new Error(`${name} is missing from profile.rs`);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
}

it('keeps the profile key lists of the app and the native side identical', () => {
  expect([...PROFILE_EXACT_KEYS].sort()).toEqual(rustList('EXACT_KEYS'));
  expect([...PROFILE_KEY_PREFIXES].sort()).toEqual(rustList('KEY_PREFIXES'));
});

it('exports the setup wizard state with the profile', () => {
  expect(allowedProfileKey('sportsdesk.onboarding')).toBe(true);
});
