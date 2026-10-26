import { expect, it } from 'vitest';
import { portraitMap, portraitName } from './DriverPortraits';

it('matches full names across accents without borrowing a reused driver number', () => {
  const photos = portraitMap([
    {
      driver_number: 1,
      first_name: 'Max',
      last_name: 'VERSTAPPEN',
      headshot_url: 'https://cdn.example/max.png',
    },
    { driver_number: 5, first_name: 'Gabriel', last_name: 'Bortoleto', headshot_url: null },
  ]);
  expect(photos.get(portraitName('Max Verstappen'))).toContain('/max.png');
  expect(photos.get(portraitName('Sebastian Vettel'))).toBeUndefined();
  expect(portraitName('Nico Hülkenberg')).toBe(portraitName('Nico HULKENBERG'));
  expect(portraitName('Andrea Kimi Antonelli')).toBe(portraitName('Kimi Antonelli'));
});
it('rejects ambiguous names and unsafe image schemes', () => {
  const photos = portraitMap([
    { driver_number: 1, full_name: 'Same Name', headshot_url: 'https://cdn.example/a.png' },
    { driver_number: 2, full_name: 'Same Name', headshot_url: 'https://cdn.example/b.png' },
    { driver_number: 3, full_name: 'Unsafe Driver', headshot_url: 'javascript:alert(1)' },
  ]);
  expect(photos.size).toBe(0);
});
