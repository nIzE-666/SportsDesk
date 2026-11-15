import { useState } from 'react';
import { Moon, Rows3, Sun } from 'lucide-react';
import { getString, setString } from '../../football/storage';
import { useAtmosphere, writeAtmosphere, type MotionMode } from '../../atmosphere/atmosphereStore';

export function AppearanceSettings() {
  const [lightTheme, setLightTheme] = useState<boolean>(
    () => getString('sportsdesk.scheme') === 'light',
  );
  const [compactTables, setCompactTables] = useState<boolean>(
    () => getString('sportsdesk.density') === 'compact',
  );
  const atmosphere = useAtmosphere();

  const setAppearance = (scheme: 'light' | 'dark') => {
    setString('sportsdesk.scheme', scheme);
    setLightTheme(scheme === 'light');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  const setDensity = (density: 'default' | 'compact') => {
    setString('sportsdesk.density', density);
    setCompactTables(density === 'compact');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  return (
    <section className="panel settings-section">
      <div className="settings-actions">
        <button className="ghost-btn" onClick={() => setAppearance(lightTheme ? 'dark' : 'light')}>
          {lightTheme ? <Moon size={14} /> : <Sun size={14} />}
          {lightTheme ? 'Перейти на тёмную' : 'Перейти на светлую'}
        </button>
        <button
          className="ghost-btn"
          onClick={() => setDensity(compactTables ? 'default' : 'compact')}
          aria-pressed={compactTables}
        >
          <Rows3 size={14} /> {compactTables ? 'Обычные таблицы' : 'Плотные таблицы'}
        </button>
      </div>
      <div className="settings-row settings-motion-row">
        <label htmlFor="motion-mode" className="muted small">
          Движение
        </label>
        <select
          id="motion-mode"
          value={atmosphere.motion}
          onChange={(e) => writeAtmosphere({ motion: e.target.value as MotionMode })}
        >
          <option value="system">Как в системе</option>
          <option value="reduced">Спокойно, без частиц</option>
          <option value="full">Полная анимация</option>
        </select>
      </div>
    </section>
  );
}
