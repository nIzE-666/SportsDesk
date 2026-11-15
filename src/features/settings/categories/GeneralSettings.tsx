import { useState } from 'react';
import { Clock, Minimize2 } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
import { Badge, Button, Panel, PanelHeader } from '../../../kit';
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

  const toggleTrayMode = async () => {
    const next = !trayMode;
    setTrayMode(next);
    setString(STORAGE_KEYS.trayMode, next ? '1' : '0');
    try {
      await rpc('set_tray_mode', { enabled: next });
    } catch {
      /* dev bridge or non-Tauri: setting still persisted for native runs */
    }
  };

  return (
    <>
      <Panel className="settings-section">
        <PanelHeader
          title={
            <>
              <Clock size={16} aria-hidden /> Время
            </>
          }
        />
        <div className="settings-row">
          <label htmlFor="tz-select" className="muted small">
            Часовой пояс
          </label>
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
        </div>
      </Panel>

      <Panel className="settings-section">
        <PanelHeader
          title={
            <>
              <Minimize2 size={16} aria-hidden /> Трей
            </>
          }
          action={<Badge>{trayMode ? 'Закрытие в трей' : 'Закрытие — выход'}</Badge>}
        />
        <div className="settings-actions">
          <Button onClick={() => void toggleTrayMode()}>
            {trayMode ? 'Закрывать приложение полностью' : 'Скрывать в трей при закрытии'}
          </Button>
        </div>
        <ShortcutControl />
      </Panel>

      <Panel className="settings-section">
        <div className="settings-actions">
          <Button onClick={openFirstRunWizard}>Пройти мастер настройки</Button>
        </div>
      </Panel>
    </>
  );
}
