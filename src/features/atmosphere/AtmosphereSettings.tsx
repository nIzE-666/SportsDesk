import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getString, setString } from '../football/storage';
import { F1_RADIO_KEY, F1_RADIO_NAME_KEY, RADIO_NAME_MAX } from './teamRadio';
import { toggleAmbient, useAmbientState } from './ambientEngine';
import {
  useAtmosphere,
  writeAtmosphere,
  type AmbientChoice,
  type AmbientHiddenPolicy,
  type AmbientVideoPolicy,
  type MotionMode,
} from './atmosphereStore';
import { CELEBRATE_PREVIEW_EVENT } from './celebrationRules';
import { FINISH_PREVIEW_EVENT } from './finishRules';
import { playGoalHorn } from './soundEngine';
import './atmosphere.css';

export function AtmosphereSettings() {
  const s = useAtmosphere();
  const ambient = useAmbientState();
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
          Короткие звуковые сигналы: рог при голе, радио F1
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
          Фоновый звук (стадион, двигатель): в верхней панели появится кнопка с динамиком
        </label>
        <fieldset className="atmosphere-subgroup" disabled={!s.ambient}>
          <label className="atmosphere-row">
            Звук
            <select
              value={s.ambientKind}
              onChange={(e) => writeAtmosphere({ ambientKind: e.target.value as AmbientChoice })}
            >
              <option value="auto">Автоматически: стадион в футболе, двигатель в F1</option>
              <option value="stadium">Всегда стадион</option>
              <option value="engine">Всегда двигатель</option>
            </select>
          </label>
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
          <label className="atmosphere-row">
            Пока играет видео со звуком
            <select
              value={s.ambientVideo}
              onChange={(e) =>
                writeAtmosphere({ ambientVideo: e.target.value as AmbientVideoPolicy })
              }
            >
              <option value="stop">Остановить фон</option>
              <option value="lower">Приглушить фон</option>
            </select>
          </label>
          <label className="atmosphere-row">
            Когда окно скрыто в трей или свёрнуто
            <select
              value={s.ambientHidden}
              onChange={(e) =>
                writeAtmosphere({ ambientHidden: e.target.value as AmbientHiddenPolicy })
              }
            >
              <option value="stop">Остановить фон</option>
              <option value="keep">Продолжать звучать</option>
            </select>
          </label>
          <p className="muted small">
            Фон включается только кнопкой с динамиком и никогда сам — ни при запуске, ни после
            обновления. Звук синтезируется приложением, записей нет; он не связан с ходом матча или
            гонки и не раскрывает результат. Тихие часы не прерывают фон, который вы включили сами.
          </p>
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
        <button
          className="ghost-btn"
          disabled={!s.enabled || !s.celebrations}
          onClick={() => window.dispatchEvent(new Event(FINISH_PREVIEW_EVENT))}
        >
          Показать клетчатый флаг
        </button>
        <button
          className="ghost-btn"
          disabled={!s.enabled || !s.sounds}
          onClick={() => playGoalHorn({ preview: true })}
        >
          Проверить рог
        </button>
        <button
          className="ghost-btn"
          disabled={!s.enabled || !s.ambient}
          onClick={() => toggleAmbient()}
        >
          {ambient.kind ? 'Остановить фон' : 'Прослушать фон'}
        </button>
      </div>
    </section>
  );
}
