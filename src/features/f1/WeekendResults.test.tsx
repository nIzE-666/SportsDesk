// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RaceResultsTable } from './WeekendResults';
import type { JolpicaResultEntry } from './types';

const row = (status: string): JolpicaResultEntry => ({
  position: '1',
  positionText: '1',
  points: '25',
  status,
  Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
  Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('RaceResultsTable statuses', () => {
  it('shows the common Jolpica statuses in Russian', async () => {
    await act(async () =>
      root.render(
        <RaceResultsTable
          rows={[row('Finished'), row('+2 Laps'), row('Accident'), row('Gearbox')]}
        />,
      ),
    );
    const cells = [...host.querySelectorAll('tbody tr td:last-child')].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual(['Финиш', '+2 круга', 'Авария', 'Коробка передач']);
  });

  it('keeps a status the map does not know', async () => {
    await act(async () => root.render(<RaceResultsTable rows={[row('Safety car finished')]} />));
    expect(host.querySelector('tbody tr td:last-child')?.textContent).toBe('Safety car finished');
  });
});
