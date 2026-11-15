import { useState, type ComponentType } from 'react';
import { viewState } from '../../lib/viewState';
import { Tabs } from '../../kit';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_KEY,
  isSettingsCategory,
  settingsCategoryLabel,
  type SettingsCategoryId,
} from './categories';
import { GeneralSettings } from './categories/GeneralSettings';
import { FavoritesSettings } from './categories/FavoritesSettings';
import { NotificationsSettings } from './categories/NotificationsSettings';
import { AppearanceSettings } from './categories/AppearanceSettings';
import { ModulesSettings } from './categories/ModulesSettings';
import { WatchSettings } from './categories/WatchSettings';
import { DataSettings } from './categories/DataSettings';
import { SourcesSettings } from './categories/SourcesSettings';
import { AboutSettings } from './categories/AboutSettings';
import './settings.css';

const SETTINGS_CONTENT: Record<SettingsCategoryId, ComponentType> = {
  general: GeneralSettings,
  favorites: FavoritesSettings,
  notifications: NotificationsSettings,
  appearance: AppearanceSettings,
  modules: ModulesSettings,
  watch: WatchSettings,
  data: DataSettings,
  sources: SourcesSettings,
  about: AboutSettings,
};

interface SettingsViewProps {
  /** Выбранная категория. Без пропа экран хранит выбор сам. */
  category?: SettingsCategoryId;
  onCategoryChange?: (id: SettingsCategoryId) => void;
}

export function SettingsView({ category, onCategoryChange }: SettingsViewProps = {}) {
  const [ownCategory, setOwnCategory] = useState<SettingsCategoryId>(() =>
    viewState.read<SettingsCategoryId>(SETTINGS_CATEGORY_KEY, 'general', isSettingsCategory),
  );
  const activeCategory = isSettingsCategory(category) ? category : ownCategory;
  const Content = SETTINGS_CONTENT[activeCategory];

  const chooseCategory = (id: SettingsCategoryId) => {
    if (category === undefined) {
      setOwnCategory(id);
      viewState.write(SETTINGS_CATEGORY_KEY, id);
    }
    onCategoryChange?.(id);
  };

  return (
    <div className="settings-view">
      <div className="settings-layout">
        <Tabs
          mode="nav"
          ariaLabel="Категории настроек"
          className="settings-categories"
          active={activeCategory}
          onChange={(id) => chooseCategory(id as SettingsCategoryId)}
          items={SETTINGS_CATEGORIES.map((item) => ({ id: item.id, label: item.label }))}
        />
        <section className="settings-category" aria-labelledby="settings-category-title">
          <h2 id="settings-category-title" className="ui-section-title">
            {settingsCategoryLabel(activeCategory)}
          </h2>
          <Content />
        </section>
      </div>
    </div>
  );
}

export default SettingsView;
