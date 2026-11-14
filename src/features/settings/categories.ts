/** Категории настроек: порядок и подписи заданы планом U2.8. */
export const SETTINGS_CATEGORIES = [
  { id: 'general', label: 'Основное' },
  { id: 'favorites', label: 'Избранное' },
  { id: 'notifications', label: 'Уведомления' },
  { id: 'appearance', label: 'Внешний вид' },
  { id: 'modules', label: 'Модули' },
  { id: 'watch', label: 'Просмотр' },
  { id: 'data', label: 'Данные' },
  { id: 'sources', label: 'Источники' },
  { id: 'about', label: 'О программе' },
] as const;

export type SettingsCategoryId = (typeof SETTINGS_CATEGORIES)[number]['id'];

export const SETTINGS_CATEGORY_KEY = 'settings.category';

const CATEGORY_IDS: ReadonlySet<string> = new Set(SETTINGS_CATEGORIES.map((item) => item.id));

export function isSettingsCategory(value: unknown): value is SettingsCategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

export function settingsCategoryLabel(id: SettingsCategoryId): string {
  return SETTINGS_CATEGORIES.find((item) => item.id === id)?.label ?? id;
}
