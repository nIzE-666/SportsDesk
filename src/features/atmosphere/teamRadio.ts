import { isModuleOn } from '../../lib/modules';
import { getString } from '../football/storage';

/** Командное радио F1: оформление напоминаний о сессиях (по умолчанию выключено). */
export const F1_RADIO_KEY = 'sportsdesk.notifications.f1.radio';
export const F1_RADIO_NAME_KEY = 'sportsdesk.notifications.f1.radioName';
export const RADIO_NAME_MAX = 24;

/** Короткое обращение без управляющих символов. */
export function cleanRadioName(raw: string | null | undefined): string {
  return Array.from(raw ?? '')
    .filter((ch) => ch >= ' ')
    .join('')
    .trim()
    .slice(0, RADIO_NAME_MAX);
}

/** Что уходит в Rust: радио работает только при включённом модуле атмосферы. */
export function readTeamRadio(): { f1Radio: boolean; f1RadioName: string } {
  const f1Radio = isModuleOn('atmosphere') && getString(F1_RADIO_KEY) === '1';
  return { f1Radio, f1RadioName: f1Radio ? cleanRadioName(getString(F1_RADIO_NAME_KEY)) : '' };
}
