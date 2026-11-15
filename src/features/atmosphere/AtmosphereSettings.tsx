import { Button } from '../../kit';
import { useState } from 'react';
import { getString, setString } from '../football/storage';
import { F1_RADIO_KEY, F1_RADIO_NAME_KEY, RADIO_NAME_MAX } from './teamRadio';
import { toggleAmbient, useAmbientState } from './ambientEngine';
import {
  useAtmosphere,
  writeAtmosphere,
  type AmbientChoice,
  type AmbientHiddenPolicy,
  type AmbientVideoPolicy,
} from './atmosphereStore';
import { CELEBRATE_PREVIEW_EVENT } from './celebrationRules';
import { FINISH_PREVIEW_EVENT } from './finishRules';
import { playGoalHorn } from './soundEngine';
import './atmosphere.css';

/** Параметры атмосферы. Показываются в «Настройках → Модули», пока модуль включён. */
export function AtmosphereSettings() {
  const s = useAtmosphere();
  const ambient = useAmbientState();
  const [radio, setRadio] = useState(() => getString(F1_RADIO_KEY) === '1');
  const [radioName, setRadioName] = useState(() => getString(F1_RADIO_NAME_KEY) ?? '');
  return (
    <fieldset className="atmosphere-options module-options" aria-label="Эффекты и звуки">
      <label className="atmosphere-row">
        <input
          type="checkbox"
          checked={s.celebrations}
          onChange={(e) => writeAtmosphere({ celebrations: e.target.checked })}
        />
        Конфетти гола и клетчатый флаг
      </label>
      <label className="atmosphere-row">
        <input
          type="checkbox"
          checked={s.sounds}
          onChange={(e) => writeAtmosphere({ sounds: e.target.checked })}
        />
        Звуки гола и радио
      </label>
      <label className="atmosphere-row">
        Громкость сигналов
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
          checked={s.ambient}
          onChange={(e) => writeAtmosphere({ ambient: e.target.checked })}
        />
        Фоновый звук стадиона и двигателя
      </label>
      <fieldset className="atmosphere-subgroup" disabled={!s.ambient}>
        <div className="atmosphere-row">
          <label htmlFor="ambient-kind">Звук</label>
          <select
            id="ambient-kind"
            value={s.ambientKind}
            onChange={(e) => writeAtmosphere({ ambientKind: e.target.value as AmbientChoice })}
          >
            <option value="auto">Автоматически: стадион в футболе, двигатель в F1</option>
            <option value="stadium">Всегда стадион</option>
            <option value="engine">Всегда двигатель</option>
          </select>
        </div>
        <label className="atmosphere-row">
          Громкость фона
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.ambientVolume * 100)}
            onChange={(e) => writeAtmosphere({ ambientVolume: Number(e.target.value) / 100 })}
          />
          <span className="muted small">{Math.round(s.ambientVolume * 100)}%</span>
        </label>
        <div className="atmosphere-row">
          <label htmlFor="ambient-video">Пока играет видео со звуком</label>
          <select
            id="ambient-video"
            value={s.ambientVideo}
            onChange={(e) =>
              writeAtmosphere({ ambientVideo: e.target.value as AmbientVideoPolicy })
            }
          >
            <option value="stop">Остановить фон</option>
            <option value="lower">Приглушить фон</option>
          </select>
        </div>
        <div className="atmosphere-row">
          <label htmlFor="ambient-hidden">Когда окно скрыто в трей или свёрнуто</label>
          <select
            id="ambient-hidden"
            value={s.ambientHidden}
            onChange={(e) =>
              writeAtmosphere({ ambientHidden: e.target.value as AmbientHiddenPolicy })
            }
          >
            <option value="stop">Остановить фон</option>
            <option value="keep">Продолжать звучать</option>
          </select>
        </div>
      </fieldset>
      <label className="atmosphere-row">
        <input
          type="checkbox"
          checked={radio}
          onChange={(e) => {
            setRadio(e.target.checked);
            setString(F1_RADIO_KEY, e.target.checked ? '1' : '0');
          }}
        />
        Радио Формулы-1
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
      <p className="muted small">Реплики вымышлены.</p>
      <div className="settings-actions">
        <Button
          small
          variant="quiet"
          disabled={!s.celebrations}
          onClick={() => window.dispatchEvent(new Event(CELEBRATE_PREVIEW_EVENT))}
        >
          Показать праздник гола
        </Button>
        <Button
          small
          variant="quiet"
          disabled={!s.celebrations}
          onClick={() => window.dispatchEvent(new Event(FINISH_PREVIEW_EVENT))}
        >
          Показать клетчатый флаг
        </Button>
        <Button
          small
          variant="quiet"
          disabled={!s.sounds}
          onClick={() => playGoalHorn({ preview: true })}
        >
          Проверить рог
        </Button>
        <Button small variant="quiet" disabled={!s.ambient} onClick={() => toggleAmbient()}>
          {ambient.kind ? 'Остановить фон' : 'Прослушать фон'}
        </Button>
      </div>
    </fieldset>
  );
}
