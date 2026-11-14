import { useState } from 'react';
import { Clock, Minimize2 } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
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
      <section className="panel settings-section">
        <div className="section-title">
          <h3>
            <Clock size={15} /> Время
          </h3>
        </div>
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
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <h3>
            <Minimize2 size={15} /> Трей
          </h3>
          <span className="chip">{trayMode ? 'Закрытие в трей' : 'Закрытие — выход'}</span>
        </div>
        <div className="settings-actions">
          <button className="ghost-btn" onClick={() => void toggleTrayMode()}>
            {trayMode ? 'Закрывать приложение полностью' : 'Скрывать в трей при закрытии'}
          </button>
        </div>
        <ShortcutControl />
      </section>

      <section className="panel settings-section">
        <div className="settings-actions">
          <button className="ghost-btn" onClick={openFirstRunWizard}>
            Пройти мастер настройки
          </button>
        </div>
      </section>
    </>
  );
}
