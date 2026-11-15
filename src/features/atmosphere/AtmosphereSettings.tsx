import { Button, Field, Switch } from '../../kit';
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
    <fieldset className="atmosphere-options" aria-label="Эффекты и звуки">
      <Switch
        label="Конфетти гола и клетчатый флаг"
        checked={s.celebrations}
        onChange={(value) => writeAtmosphere({ celebrations: value })}
      />
      <Switch
        label="Звуки гола и радио"
        checked={s.sounds}
        onChange={(value) => writeAtmosphere({ sounds: value })}
      />
      <Field label="Громкость сигналов" hint={`${Math.round(s.volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(s.volume * 100)}
          onChange={(e) => writeAtmosphere({ volume: Number(e.target.value) / 100 })}
        />
      </Field>
      <Switch
        label="Фоновый звук стадиона и двигателя"
        checked={s.ambient}
        onChange={(value) => writeAtmosphere({ ambient: value })}
      />
      <fieldset className="atmosphere-subgroup" disabled={!s.ambient}>
        <Field label="Звук" htmlFor="ambient-kind">
          <select
            id="ambient-kind"
            value={s.ambientKind}
            onChange={(e) => writeAtmosphere({ ambientKind: e.target.value as AmbientChoice })}
          >
            <option value="auto">Автоматически: стадион в футболе, двигатель в F1</option>
            <option value="stadium">Всегда стадион</option>
            <option value="engine">Всегда двигатель</option>
          </select>
        </Field>
        <Field label="Громкость фона" hint={`${Math.round(s.ambientVolume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.ambientVolume * 100)}
            onChange={(e) => writeAtmosphere({ ambientVolume: Number(e.target.value) / 100 })}
          />
        </Field>
        <Field label="Пока играет видео со звуком" htmlFor="ambient-video">
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
        </Field>
        <Field label="Когда окно скрыто в трей или свёрнуто" htmlFor="ambient-hidden">
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
        </Field>
      </fieldset>
      <Switch
        label="Радио Формулы-1"
        checked={radio}
        onChange={(value) => {
          setRadio(value);
          setString(F1_RADIO_KEY, value ? '1' : '0');
        }}
      />
      <Field label="Обращение в радио" htmlFor="radio-name" hint="Реплики вымышлены.">
        <input
          id="radio-name"
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
      </Field>
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
