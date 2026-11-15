import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw } from 'lucide-react';
import { Button, IconButton } from '../../kit';
import {
  moveHomeWidget,
  resetHomeLayout,
  setHomeWidgetHidden,
  homeWidgetMeta,
  useHomeLayout,
  type HomeDesign,
  type HomeLayoutScope,
} from './homeLayout';
import './homeLayout.css';

/** Панель настройки главной: порядок и видимость блоков кнопками (без перетаскивания). */
export function HomeLayoutEditor({
  design,
  scope = 'dashboard',
  onClose,
}: {
  design: HomeDesign;
  scope?: HomeLayoutScope;
  onClose: () => void;
}) {
  const layout = useHomeLayout(design, scope);
  const last = layout.order.length - 1;
  return (
    <section
      className="panel home-layout-editor"
      aria-label={scope === 'today' ? 'Настройка блоков «Сегодня»' : 'Настройка главной'}
    >
      <div className="section-title">
        <h2>
          <LayoutGrid size={16} /> {scope === 'today' ? 'Блоки «Сегодня»' : 'Блоки главной'}
        </h2>
        <Button variant="quiet" onClick={onClose}>
          Готово
        </Button>
      </div>
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
                <IconButton
                  small
                  aria-label={`Выше: ${meta.label}`}
                  title="Выше"
                  disabled={index === 0}
                  onClick={() => moveHomeWidget(design, id, -1, scope)}
                  icon={<ArrowUp size={14} />}
                />
                <IconButton
                  small
                  aria-label={`Ниже: ${meta.label}`}
                  title="Ниже"
                  disabled={index === last}
                  onClick={() => moveHomeWidget(design, id, 1, scope)}
                  icon={<ArrowDown size={14} />}
                />
                <Button
                  small
                  aria-label={`${hidden ? 'Показать' : 'Скрыть'}: ${meta.label}`}
                  onClick={() => setHomeWidgetHidden(design, id, !hidden, scope)}
                >
                  {hidden ? <Eye size={14} /> : <EyeOff size={14} />}{' '}
                  {hidden ? 'Показать' : 'Скрыть'}
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="home-layout-foot">
        <Button onClick={() => resetHomeLayout(scope)} disabled={!layout.custom}>
          <RotateCcw size={14} /> Восстановить стандартное расположение
        </Button>
      </div>
    </section>
  );
}
