import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw } from 'lucide-react';
import {
  moveHomeWidget,
  resetHomeLayout,
  setHomeWidgetHidden,
  homeWidgetMeta,
  useHomeLayout,
  type HomeDesign,
} from './homeLayout';
import './homeLayout.css';

/** Панель настройки главной: порядок и видимость блоков кнопками (без перетаскивания). */
export function HomeLayoutEditor({ design, onClose }: { design: HomeDesign; onClose: () => void }) {
  const layout = useHomeLayout(design);
  const last = layout.order.length - 1;
  return (
    <section className="panel home-layout-editor" aria-label="Настройка главной">
      <div className="section-title">
        <h2>
          <LayoutGrid size={16} /> Блоки главной
        </h2>
        <button className="text-link" onClick={onClose}>
          Готово
        </button>
      </div>
      <p className="muted small">
        Порядок и видимость сохраняются после перезапуска и входят в резервную копию профиля.
      </p>
      <ol className="home-layout-list">
        {layout.order.map((id, index) => {
          const meta = homeWidgetMeta(id);
          const hidden = layout.hidden.includes(id);
          return (
            <li key={id} className={hidden ? 'is-hidden' : undefined}>
              <span className="home-layout-name">
                <strong>{meta.label}</strong>
                <small>{hidden ? `Скрыт · ${meta.description}` : meta.description}</small>
              </span>
              <span className="home-layout-actions">
                <button
                  className="ghost-btn"
                  aria-label={`Выше: ${meta.label}`}
                  title="Выше"
                  disabled={index === 0}
                  onClick={() => moveHomeWidget(design, id, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="ghost-btn"
                  aria-label={`Ниже: ${meta.label}`}
                  title="Ниже"
                  disabled={index === last}
                  onClick={() => moveHomeWidget(design, id, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="ghost-btn"
                  aria-label={`${hidden ? 'Показать' : 'Скрыть'}: ${meta.label}`}
                  onClick={() => setHomeWidgetHidden(design, id, !hidden)}
                >
                  {hidden ? <Eye size={14} /> : <EyeOff size={14} />}{' '}
                  {hidden ? 'Показать' : 'Скрыть'}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="home-layout-foot">
        <button className="ghost-btn" onClick={resetHomeLayout} disabled={!layout.custom}>
          <RotateCcw size={14} /> Восстановить стандартное расположение
        </button>
      </div>
    </section>
  );
}
