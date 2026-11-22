import { useState } from 'react';
import { Clock, Minimize2, Sparkles } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
import { START_SECTION_KEY, type StartSection } from '../../../lib/navigation';
import { useModules } from '../../../lib/modules';
import { Badge, Button, Field, Panel, PanelHeader, Switch } from '../../../kit';
import { getString, getUserTimezone, setString, STORAGE_KEYS } from '../../football/storage';
import { HIDE_HOME_INTEREST_KEY } from '../../home/homePreferences';
import { ShortcutControl } from '../ShortcutControl';
import { openFirstRunWizard } from '../../onboarding/onboarding';

const TIMEZONES = [
  'Asia/Yakutsk',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'UTC',
];

export function GeneralSettings() {
  const [timezone, setTimezone] = useState(getUserTimezone);
  const [trayMode, setTrayMode] = useState<boolean>(() => getString(STORAGE_KEYS.trayMode) !== '0');
  const [startSection, setStartSection] = useState<StartSection>(() =>
    getString(START_SECTION_KEY) === 'home' ? 'home' : 'today',
  );
  const [hideInterest, setHideInterest] = useState(() => getString(HIDE_HOME_INTEREST_KEY) === '1');
  const modules = useModules();

  const onTimezoneChange = (value: string) => {
    setTimezone(value);
    setString(STORAGE_KEYS.timezone, value);
  };

  const setTray = async (enabled: boolean) => {
    setTrayMode(enabled);
    setString(STORAGE_KEYS.trayMode, enabled ? '1' : '0');
    try {
      await rpc('set_tray_mode', { enabled });
    } catch {
      /* dev bridge or non-Tauri: setting still persisted for native runs */
    }
  };

  return (
    <>
      {modules.home && (
        <Panel>
          <PanelHeader title="Главное" />
          <Field label="Стартовый экран" htmlFor="start-section-select" inline>
            <select
              id="start-section-select"
              value={startSection}
              onChange={(event) => {
                const value = event.target.value === 'home' ? 'home' : 'today';
                setStartSection(value);
                setString(START_SECTION_KEY, value);
              }}
            >
              <option value="today">Сегодня</option>
              <option value="home">Главное</option>
            </select>
          </Field>
          <Switch
            label="Скрывать значок интереса вместе со счётом"
            checked={hideInterest}
            onChange={(enabled) => {
              setHideInterest(enabled);
              setString(HIDE_HOME_INTEREST_KEY, enabled ? '1' : '0');
            }}
          />
        </Panel>
      )}
      <Panel>
        <PanelHeader
          title={
            <>
              <Clock size={16} aria-hidden /> Время
            </>
          }
        />
        <Field label="Часовой пояс" htmlFor="tz-select" inline>
          <select
            id="tz-select"
            value={timezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
          >
            {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
      </Panel>

      <Panel>
        <PanelHeader
          title={
            <>
              <Minimize2 size={16} aria-hidden /> Трей
            </>
          }
          action={<Badge>{trayMode ? 'Закрытие в трей' : 'Закрытие — выход'}</Badge>}
        />
        <Switch
          label="Скрывать в трей при закрытии"
          checked={trayMode}
          onChange={(enabled) => void setTray(enabled)}
        />
        <ShortcutControl />
      </Panel>

      <Panel>
        <PanelHeader title="Мастер настройки" />
        <div className="settings-actions">
          <Button icon={<Sparkles size={14} aria-hidden />} onClick={openFirstRunWizard}>
            Пройти мастер настройки
          </Button>
        </div>
      </Panel>
    </>
  );
}
