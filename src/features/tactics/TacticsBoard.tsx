import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Button, Panel } from '../../kit';
import { useViewState } from '../../lib/useViewState';
import type { LineupsPayload, MatchDetail } from '../football/types';
import {
  addArrow,
  appliesToMatch,
  isTacticScheme,
  movePlayer,
  resetScheme,
  schemeFromLineups,
  type Point,
  type TacticScheme,
} from './tacticsModel';
import { deleteScheme, saveScheme, useTactics } from './tacticsStore';
import './tactics.css';

const uuid = () => crypto.randomUUID();
const clamp = (n: number) => Math.max(0.025, Math.min(0.975, n));
const percent = (n: number) => Math.round(n * 1000) / 10;
const draftValid = (v: unknown) =>
  v === null ||
  (!!v &&
    typeof v === 'object' &&
    'title' in v &&
    typeof v.title === 'string' &&
    v.title.length <= 80 &&
    isTacticScheme({ ...v, title: v.title.trim() || 'Моя расстановка' }));
const sourceStatus = (v: boolean | null) =>
  v === true
    ? 'подтверждённый состав'
    : v === false
      ? 'предварительный состав'
      : 'статус состава не указан';

export function TacticsBoard({
  detail,
  payload,
  loading = false,
  error: sourceError,
}: {
  detail: MatchDetail;
  payload: LineupsPayload | null;
  loading?: boolean;
  error?: string;
}) {
  const saved = useTactics();
  const [draft, setDraft] = useViewState<TacticScheme | null>(
    `tactics.${detail.id}.draft`,
    null,
    draftValid,
  );
  const [past, setPast] = useState<TacticScheme[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [showAll, setShowAll] = useState(false);
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<'move' | 'arrow'>('move');
  const [arrowStart, setArrowStart] = useState<Point | null>(null);
  const [arrowForm, setArrowForm] = useState({ x1: '30', y1: '50', x2: '65', y2: '50' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null);
  const [preview, setPreview] = useState<{ key: string; point: Point } | null>(null);
  const drag = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const field = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, '');
  const currentSaved = saved.store.schemes.find((s) => s.id === draft?.id);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(currentSaved);
  const related = saved.store.schemes.filter((s) => appliesToMatch(s, detail));
  const library = showAll ? saved.store.schemes : related;
  const player = draft?.players.find((p) => p.key === selected);
  const attempt = (run: () => void) => {
    try {
      setError('');
      run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не удалось.');
    }
  };
  const replace = (next: TacticScheme) => {
    setDraft(next);
    setPast([]);
    setSelected('');
    setArrowStart(null);
    setCompare(false);
    setMessage('');
    setPending(null);
  };
  const requestReplace = (label: string, run: () => void) =>
    dirty ? setPending({ label, run }) : attempt(run);
  const change = (next: TacticScheme) => {
    if (!draft || JSON.stringify(next) === JSON.stringify(draft)) return;
    setPast((v) => [...v.slice(-49), draft]);
    setDraft(next);
    setMessage('');
    setError('');
  };
  const location = (event: MouseEvent | PointerEvent): Point | null => {
    const rect = field.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? {
          x: clamp((event.clientX - rect.left) / rect.width),
          y: clamp((event.clientY - rect.top) / rect.height),
        }
      : null;
  };
  const place = (point: Point) => {
    if (!draft || compare) return;
    if (mode === 'arrow') {
      if (arrowStart) {
        attempt(() => change(addArrow(draft, arrowStart, point, uuid())));
        setArrowStart(null);
      } else setArrowStart(point);
    } else if (selected) change(movePlayer(draft, selected, point));
  };
  const finishDrag = (event: PointerEvent) => {
    const active = drag.current;
    if (active?.moved && draft) {
      const point = location(event);
      if (point) change(movePlayer(draft, active.key, point));
      ignoreClick.current = true;
    }
    drag.current = null;
    setPreview(null);
  };
  const save = (copy = false) =>
    attempt(() => {
      if (!draft) return;
      const result = saveScheme(
        copy
          ? { ...draft, id: uuid(), title: `${draft.title.trim()} · копия`.slice(0, 80) }
          : draft,
      );
      setDraft(result);
      setPast([]);
      setMessage('Схема сохранена.');
    });
  return (
    <section className="tactics-workspace" aria-label="Тактическая доска">
      <header className="tactics-heading">
        <div>
          <h2>Мои схемы</h2>
          <p className="muted">Расставляйте игроков и рисуйте передачи.</p>
        </div>
        <Button
          small
          disabled={loading || !payload}
          onClick={() =>
            requestReplace('Создать новую доску без сохранения изменений?', () =>
              replace(schemeFromLineups(detail, payload, uuid())),
            )
          }
        >
          {loading ? 'Загружаем состав…' : 'Создать из состава'}
        </Button>
      </header>
      {sourceError && <p className="tactics-notice">{sourceError} · Сохранённые схемы доступны.</p>}
      {saved.error && (
        <p className="tactics-notice" role="alert">
          {saved.error}
        </p>
      )}
      {error && (
        <p className="tactics-notice" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="tactics-notice">
          {message}
        </p>
      )}
      {pending && (
        <Panel className="tactics-confirm" role="alert">
          <p>{pending.label}</p>
          <div className="tactics-actions">
            <Button
              small
              onClick={() => {
                const action = pending.run;
                setPending(null);
                attempt(action);
              }}
            >
              Продолжить
            </Button>
            <Button small variant="quiet" onClick={() => setPending(null)}>
              Остаться на доске
            </Button>
          </div>
        </Panel>
      )}
      {!draft ? (
        <Panel>
          <h3>Разберите свою расстановку</h3>
          <p>Создайте схему из состава или откройте сохранённую.</p>
        </Panel>
      ) : (
        <>
          <Panel className="tactics-editor" aria-label="Редактор схемы">
            <div className="tactics-properties">
              <label>
                Название схемы
                <input
                  aria-label="Название схемы"
                  maxLength={80}
                  value={draft.title}
                  onChange={(e) => change({ ...draft, title: e.target.value })}
                />
              </label>
              <label>
                Привязка
                <select
                  aria-label="Привязка схемы"
                  value={`${draft.binding.kind}:${draft.binding.id}`}
                  onChange={(e) => {
                    const kind = e.target.value.startsWith('match:') ? 'match' : 'team';
                    change({
                      ...draft,
                      binding: { kind, id: e.target.value.slice(kind.length + 1) },
                    });
                  }}
                >
                  <option value={`match:${draft.source.matchId}`}>
                    К матчу {draft.source.home.name} — {draft.source.away.name}
                  </option>
                  {[draft.source.home, draft.source.away].map((t) => (
                    <option key={t.id} value={`team:${t.id}`}>
                      К команде {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tactics-source">
              <strong>Исходный состав при создании схемы</strong>
              <span>
                {draft.source.home.name}: {sourceStatus(draft.source.homeConfirmed)}
                {draft.source.homeFormation && ` · ${draft.source.homeFormation}`}
              </span>
              <span>
                {draft.source.away.name}: {sourceStatus(draft.source.awayConfirmed)}
                {draft.source.awayFormation && ` · ${draft.source.awayFormation}`}
              </span>
              <p className="muted">Это ваша копия: исходный состав не меняется.</p>
            </div>
            <div className="tactics-actions">
              <Button
                small
                variant="quiet"
                disabled={!past.length || compare}
                onClick={() => {
                  const previous = past.at(-1);
                  if (previous) {
                    setDraft(previous);
                    setPast(past.slice(0, -1));
                    setMessage('');
                  }
                }}
              >
                Отменить действие
              </Button>
              <Button
                small
                variant="quiet"
                disabled={compare}
                onClick={() => change(resetScheme(draft))}
              >
                Сбросить доску
              </Button>
              <Button
                small
                variant="quiet"
                aria-pressed={compare}
                onClick={() => {
                  setCompare(!compare);
                  setArrowStart(null);
                  setPreview(null);
                  drag.current = null;
                }}
              >
                {compare ? 'Вернуться к моей схеме' : 'Сравнить с исходной'}
              </Button>
              <Button
                small
                variant="quiet"
                disabled={compare}
                aria-pressed={mode === 'arrow'}
                onClick={() => {
                  setMode(mode === 'arrow' ? 'move' : 'arrow');
                  setArrowStart(null);
                }}
              >
                Рисовать стрелки
              </Button>
              <Button
                small
                disabled={!saved.writable || !draft.title.trim()}
                onClick={() => save()}
              >
                Сохранить схему
              </Button>
              <Button
                small
                variant="quiet"
                disabled={!saved.writable || !draft.title.trim()}
                onClick={() => save(true)}
              >
                Сохранить копию
              </Button>
            </div>
            <p className="tactics-state" role="status">
              {compare
                ? 'Показан исходный состав: редактирование выключено.'
                : mode === 'arrow'
                  ? arrowStart
                    ? 'Выберите конец стрелки. Esc отменяет начало.'
                    : 'Выберите начало и конец стрелки на поле.'
                  : 'Выберите игрока: перетащите его или двигайте стрелками клавиатуры.'}
            </p>
            <div className="tactics-layout">
              <div>
                <div
                  className={`tactics-pitch ${compare ? 'comparing' : ''}`}
                  ref={field}
                  tabIndex={0}
                  role="group"
                  aria-label="Поле тактической доски"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setArrowStart(null);
                      drag.current = null;
                      setPreview(null);
                    }
                  }}
                  onClick={(e) => {
                    if (ignoreClick.current) {
                      ignoreClick.current = false;
                      return;
                    }
                    const point = location(e);
                    if (point) place(point);
                  }}
                  onPointerMove={(e) => {
                    const active = drag.current;
                    if (!active) return;
                    if (Math.hypot(e.clientX - active.x, e.clientY - active.y) > 4)
                      active.moved = true;
                    const point = location(e);
                    if (active.moved && point) setPreview({ key: active.key, point });
                  }}
                  onPointerUp={finishDrag}
                  onPointerCancel={() => {
                    drag.current = null;
                    setPreview(null);
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                    setPreview(null);
                  }}
                >
                  <svg viewBox="0 0 1050 680" className="tactics-field-lines" aria-hidden="true">
                    <g fill="none">
                      <rect x="15" y="15" width="1020" height="650" />
                      <path d="M525 15V665M15 140H165V540H15M1035 140H885V540H1035" />
                      <circle cx="525" cy="340" r="91" />
                    </g>
                  </svg>
                  {!compare && (
                    <svg viewBox="0 0 1050 680" className="tactics-arrows" aria-hidden="true">
                      <defs>
                        <marker
                          id={markerId}
                          markerWidth="10"
                          markerHeight="10"
                          refX="8"
                          refY="3"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M0,0 L0,6 L9,3 z" />
                        </marker>
                      </defs>
                      {draft.arrows.map((a) => (
                        <line
                          key={a.id}
                          x1={a.from.x * 1050}
                          y1={a.from.y * 680}
                          x2={a.to.x * 1050}
                          y2={a.to.y * 680}
                          markerEnd={`url(#${markerId})`}
                        />
                      ))}
                      {arrowStart && (
                        <circle cx={arrowStart.x * 1050} cy={arrowStart.y * 680} r="9" />
                      )}
                    </svg>
                  )}
                  {draft.players.map((p) => {
                    const point = compare
                      ? p.original
                      : preview?.key === p.key
                        ? preview.point
                        : p.position;
                    if (!point) return null;
                    return (
                      <button
                        key={p.key}
                        className={`tactics-player ${p.teamId === draft.source.home.id ? 'home' : 'away'} ${selected === p.key ? 'selected' : ''}`}
                        style={
                          {
                            '--player-position': `${point.y * 100}% auto auto ${point.x * 100}%`,
                          } as CSSProperties
                        }
                        aria-label={`Игрок ${p.name}, ${p.teamId === draft.source.home.id ? draft.source.home.name : draft.source.away.name}`}
                        aria-pressed={selected === p.key}
                        onClick={(e) => {
                          setSelected(p.key);
                          if (mode === 'move' || compare) {
                            ignoreClick.current = false;
                            e.stopPropagation();
                          }
                        }}
                        onPointerDown={(e) => {
                          if (compare || mode !== 'move' || e.button !== 0) return;
                          setSelected(p.key);
                          ignoreClick.current = false;
                          drag.current = { key: p.key, x: e.clientX, y: e.clientY, moved: false };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onKeyDown={(e) => {
                          const directions: Record<string, Point> = {
                            ArrowLeft: { x: -1, y: 0 },
                            ArrowRight: { x: 1, y: 0 },
                            ArrowUp: { x: 0, y: -1 },
                            ArrowDown: { x: 0, y: 1 },
                          };
                          const direction = directions[e.key];
                          if (!direction || compare) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setSelected(p.key);
                          const step = e.shiftKey ? 0.005 : 0.02;
                          change(
                            movePlayer(draft, p.key, {
                              x: clamp(point.x + direction.x * step),
                              y: clamp(point.y + direction.y * step),
                            }),
                          );
                        }}
                      >
                        <span>
                          {p.shirt ||
                            p.name
                              .trim()
                              .split(/\s+/)
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                        </span>
                        <small>{p.name.split(/\s+/).at(-1)}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="tactics-roster" aria-label="Игроки для размещения">
                <h3>Игроки на доске</h3>
                <label>
                  Выбранный игрок
                  <select
                    aria-label="Выбранный игрок"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Выберите игрока</option>
                    {draft.players.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name} ·{' '}
                        {p.teamId === draft.source.home.id
                          ? draft.source.home.name
                          : draft.source.away.name}
                        {!p.position ? ' · вне поля' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {player ? (
                  <div className="tactics-placement">
                    <strong>{player.name}</strong>
                    <span className="muted small">
                      {player.starter ? 'Стартовый состав' : 'Запасной'}
                      {!player.original ? ' · исходная позиция не указана' : ''}
                    </span>
                    <div className="tactics-coordinate-pair">
                      {(['x', 'y'] as const).map((axis) => (
                        <label key={axis}>
                          {axis === 'x' ? 'Вдоль поля, %' : 'Поперёк поля, %'}
                          <input
                            aria-label={axis === 'x' ? 'Вдоль поля, %' : 'Поперёк поля, %'}
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            disabled={compare}
                            value={player.position ? percent(player.position[axis]) : ''}
                            onChange={(e) => {
                              if (e.target.value === '') return;
                              const v = Number(e.target.value);
                              if (!Number.isFinite(v) || v < 0 || v > 100) return;
                              change(
                                movePlayer(draft, player.key, {
                                  ...(player.position ?? { x: 0.5, y: 0.5 }),
                                  [axis]: v / 100,
                                }),
                              );
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="tactics-actions">
                      <Button
                        small
                        variant="quiet"
                        disabled={compare}
                        onClick={() => change(movePlayer(draft, player.key, { x: 0.5, y: 0.5 }))}
                      >
                        Разместить в центре
                      </Button>
                      <Button
                        small
                        variant="quiet"
                        disabled={compare || !player.position}
                        onClick={() => change(movePlayer(draft, player.key, null))}
                      >
                        Убрать с поля
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="muted">Выберите игрока на поле или в списке.</p>
                )}
              </aside>
            </div>
            <details className="tactics-arrow-editor">
              <summary>Стрелки без мыши · {draft.arrows.length}</summary>
              <div className="tactics-coordinate-pair">
                {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
                  <label key={key}>
                    {
                      { x1: 'Начало X, %', y1: 'Начало Y, %', x2: 'Конец X, %', y2: 'Конец Y, %' }[
                        key
                      ]
                    }
                    <input
                      aria-label={key}
                      type="number"
                      min="0"
                      max="100"
                      value={arrowForm[key]}
                      disabled={compare}
                      onChange={(e) => setArrowForm({ ...arrowForm, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <Button
                small
                disabled={compare}
                onClick={() =>
                  attempt(() => {
                    const values = Object.values(arrowForm);
                    if (
                      values.some(
                        (v) =>
                          !v.trim() ||
                          !Number.isFinite(Number(v)) ||
                          Number(v) < 0 ||
                          Number(v) > 100,
                      )
                    )
                      throw new Error('Координаты стрелки должны быть от 0 до 100.');
                    change(
                      addArrow(
                        draft,
                        { x: Number(arrowForm.x1) / 100, y: Number(arrowForm.y1) / 100 },
                        { x: Number(arrowForm.x2) / 100, y: Number(arrowForm.y2) / 100 },
                        uuid(),
                      ),
                    );
                  })
                }
              >
                Добавить стрелку по координатам
              </Button>
              <ol>
                {draft.arrows.map((a, i) => (
                  <li key={a.id}>
                    Стрелка {i + 1}: {percent(a.from.x)}, {percent(a.from.y)} → {percent(a.to.x)},{' '}
                    {percent(a.to.y)} %{' '}
                    <Button
                      small
                      variant="quiet"
                      disabled={compare}
                      aria-label={`Удалить стрелку ${i + 1}`}
                      onClick={() =>
                        change({ ...draft, arrows: draft.arrows.filter((v) => v.id !== a.id) })
                      }
                    >
                      Удалить
                    </Button>
                  </li>
                ))}
              </ol>
            </details>
            <p className="muted small">
              {dirty ? 'Есть несохранённые изменения.' : 'Эта версия схемы сохранена.'}
            </p>
          </Panel>
        </>
      )}
      <Panel className="tactics-library" aria-label="Сохранённые схемы">
        <div className="tactics-heading">
          <h3>
            {showAll ? 'Все сохранённые схемы' : 'Схемы этого матча и команд'} · {library.length}
          </h3>
          <Button small variant="quiet" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Только этот матч и команды' : 'Показать все сохранённые схемы'}
          </Button>
        </div>
        {!library.length && <p className="muted">Сохранённых схем пока нет.</p>}
        <ul>
          {library.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.title}</strong>
                <small>
                  {s.binding.kind === 'match' ? 'Матч' : 'Команда'} · {s.source.home.name} —{' '}
                  {s.source.away.name}
                </small>
              </div>
              <div className="tactics-actions">
                <Button
                  small
                  onClick={() =>
                    requestReplace('Открыть другую схему без сохранения изменений?', () =>
                      replace(s),
                    )
                  }
                >
                  Открыть {s.title}
                </Button>
                <Button
                  small
                  variant="quiet"
                  onClick={() =>
                    setPending({
                      label: `Удалить сохранённую схему «${s.title}»?`,
                      run: () => {
                        deleteScheme(s.id);
                        if (draft?.id === s.id) {
                          setDraft(null);
                          setPast([]);
                        }
                        setMessage('Схема удалена.');
                      },
                    })
                  }
                >
                  Удалить {s.title}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}
