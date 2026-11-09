import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getString, setString } from '../football/storage';
import { F1_RADIO_KEY, F1_RADIO_NAME_KEY, RADIO_NAME_MAX } from './teamRadio';
import { useAtmosphere, writeAtmosphere, type MotionMode } from './atmosphereStore';
import { CELEBRATE_PREVIEW_EVENT } from './celebrationRules';
import './atmosphere.css';

export function AtmosphereSettings() {
  const s = useAtmosphere();
  const [radio, setRadio] = useState(() => getString(F1_RADIO_KEY) === '1');
  const [radioName, setRadioName] = useState(() => getString(F1_RADIO_NAME_KEY) ?? '');
  return (
    <section className="panel settings-section" aria-label="Игры и атмосфера">
      <div className="section-title">
        <h2>
          <Sparkles size={15} /> Игры и атмосфера
        </h2>
        <span className="chip">{s.enabled ? 'Включено' : 'Выключено'}</span>
      </div>
      <p className="muted small">
        Празднования, звуки и мини-игры. Всё выключается одним переключателем, звуки по умолчанию
        выключены. Эффекты не раскрывают скрытые результаты и не делают лишних запросов.
      </p>
      <label className="atmosphere-row">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => writeAtmosphere({ enabled: e.target.checked })}
        />
        Включить игры и атмосферу
      </label>
      <fieldset className="atmosphere-options" disabled={!s.enabled}>
        <label className="atmosphere-row">
          <input
            type="checkbox"
            checked={s.celebrations}
            onChange={(e) => writeAtmosphere({ celebrations: e.target.checked })}
          />
          Праздновать новые голы и финиш
        </label>
        <label className="atmosphere-row">
          <input
            type="checkbox"
            checked={s.sounds}
            onChange={(e) => writeAtmosphere({ sounds: e.target.checked })}
          />
          Короткие звуковые сигналы
        </label>
        <label className="atmosphere-row">
          Движение
          <select
            value={s.motion}
            onChange={(e) => writeAtmosphere({ motion: e.target.value as MotionMode })}
          >
            <option value="system">Как в системе</option>
            <option value="reduced">Спокойно, без частиц</option>
            <option value="full">Полная анимация</option>
          </select>
        </label>
        <label className="atmosphere-row">
          Громкость
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.volume * 100)}
            onChange={(e) => writeAtmosphere({ volume: Number(e.target.value) / 100 })}
          />
          <span className="muted small">{Math.round(s.volume * 100)}%</span>
        </label>
        <label className="atmosphere-row">
          <input
            type="checkbox"
            checked={radio}
            onChange={(e) => {
              setRadio(e.target.checked);
              setString(F1_RADIO_KEY, e.target.checked ? '1' : '0');
            }}
          />
          Командное радио F1: напоминания о сессиях в стиле радиосообщений
        </label>
        <label className="atmosphere-row">
          Обращение в радио
          <input
            type="text"
            maxLength={RADIO_NAME_MAX}
            placeholder="например, Макс"
            value={radioName}
            disabled={!radio}
            onChange={(e) => {
              setRadioName(e.target.value);
              setString(F1_RADIO_NAME_KEY, e.target.value);
            }}
          />
        </label>
        <p className="muted small">
          Реплики радио — оформление SportsDesk, а не настоящие записи команд или слова пилотов.
          Фильтры и тихие часы уведомлений действуют как обычно; сигнал звучит, только если включены
          короткие звуки.
        </p>
      </fieldset>
      <div className="settings-actions">
        <button
          className="ghost-btn"
          disabled={!s.enabled || !s.celebrations}
          onClick={() => window.dispatchEvent(new Event(CELEBRATE_PREVIEW_EVENT))}
        >
          Показать праздник гола
        </button>
      </div>
    </section>
  );
}
