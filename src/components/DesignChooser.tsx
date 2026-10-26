import { LayoutTemplate } from 'lucide-react';
import { setInterfaceDesign, useInterfaceDesign } from '../lib/interfaceDesign';

export function DesignToggle() {
  const design = useInterfaceDesign();
  const enabled = design === 'broadcast';
  const label = enabled ? 'Вернуть классический дизайн' : 'Включить спортивную обложку';
  return (
    <button
      type="button"
      className="icon-button design-toggle"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={() => setInterfaceDesign(enabled ? 'classic' : 'broadcast')}
    >
      <LayoutTemplate size={18} />
    </button>
  );
}

export function DesignChooser() {
  const design = useInterfaceDesign();
  return (
    <fieldset className="design-chooser">
      <legend>Дизайн приложения</legend>
      <div className="design-options">
        {(
          [
            ['classic', 'Классический', 'Привычные цветные панели и баннеры.'],
            [
              'broadcast',
              'Спортивная обложка',
              'Нейтральные поверхности, акценты лиг и конкретное событие на обложке.',
            ],
          ] as const
        ).map(([value, title, description]) => (
          <label className={`design-option ${design === value ? 'selected' : ''}`} key={value}>
            <input
              type="radio"
              name="interface-design"
              value={value}
              checked={design === value}
              onChange={() => setInterfaceDesign(value)}
            />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="settings-note">
        Выбор применяется сразу и сохраняется. Быстро сравнить варианты можно кнопкой дизайна в
        шапке.
      </p>
    </fieldset>
  );
}
