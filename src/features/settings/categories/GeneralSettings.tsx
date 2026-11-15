import { useState } from 'react';
import { Clock, Minimize2, Sparkles } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
import { Badge, Button, Field, Panel, PanelHeader, Switch } from '../../../kit';
import { getString, setString, STORAGE_KEYS } from '../../football/storage';
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
  const [timezone, setTimezone] = useState<string>(
    () => getString(STORAGE_KEYS.timezone) ?? 'Asia/Yakutsk',
  );
  const [trayMode, setTrayMode] = useState<boolean>(() => getString(STORAGE_KEYS.trayMode) !== '0');

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
