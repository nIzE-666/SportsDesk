// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { writeAtmosphere } from './atmosphereStore';
import { F1_RADIO_KEY, F1_RADIO_NAME_KEY, cleanRadioName, readTeamRadio } from './teamRadio';
import { playRadioSignal } from './soundEngine';

beforeEach(() => localStorage.clear());

it('radio is off by default and needs the atmosphere block', () => {
  expect(readTeamRadio()).toEqual({ f1Radio: false, f1RadioName: '' });
  localStorage.setItem(F1_RADIO_KEY, '1');
  localStorage.setItem(F1_RADIO_NAME_KEY, '  Макс  ');
  expect(readTeamRadio()).toEqual({ f1Radio: true, f1RadioName: 'Макс' });
  writeAtmosphere({ enabled: false });
  expect(readTeamRadio()).toEqual({ f1Radio: false, f1RadioName: '' });
});

it('cleans the radio address', () => {
  expect(cleanRadioName('\u0007 Лео\n')).toBe('Лео');
  expect(cleanRadioName('x'.repeat(40))).toHaveLength(24);
  expect(cleanRadioName(null)).toBe('');
});

it('never plays a signal while sounds are off', () => {
  expect(playRadioSignal()).toBe(false);
});
