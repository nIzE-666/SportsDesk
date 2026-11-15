import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Bell, EyeOff, Inbox, Search, Star } from 'lucide-react';
import '@fontsource-variable/manrope';
import '../src/tokens.css';
import '../src/kit/kit.css';
import './kitGallery.css';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  MatchRow,
  Panel,
  PanelHeader,
  SearchSelect,
  SegmentedControl,
  Skeleton,
  StatTile,
  Tabs,
  Toast,
  Tooltip,
} from '../src/kit';
import TeamBadge from '../src/components/TeamBadge';

type Scheme = 'dark' | 'light';
type Density = 'default' | 'compact';

function initialFromQuery(): { scheme: Scheme; density: Density } {
  const params = new URLSearchParams(window.location.search);
  return {
    scheme: params.get('scheme') === 'light' ? 'light' : 'dark',
    density: params.get('density') === 'compact' ? 'compact' : 'default',
  };
}

const TABLE_ROWS = [
  { place: 1, team: 'Арсенал', played: 12, wins: 9, draws: 2, losses: 1, goals: 24, points: 29 },
  { place: 2, team: 'Ливерпуль', played: 12, wins: 8, draws: 3, losses: 1, goals: 22, points: 27 },
  {
    place: 3,
    team: 'Манчестер Сити',
    played: 12,
    wins: 7,
    draws: 3,
    losses: 2,
    goals: 21,
    points: 24,
  },
  { place: 4, team: 'Челси', played: 12, wins: 6, draws: 4, losses: 2, goals: 18, points: 22 },
  { place: 5, team: 'Тоттенхэм', played: 12, wins: 5, draws: 4, losses: 3, goals: 16, points: 19 },
  { place: 6, team: 'Ньюкасл', played: 12, wins: 4, draws: 4, losses: 4, goals: 14, points: 16 },
];

const SEARCH_OPTIONS = [
  { value: 'arsenal', label: 'Арсенал', group: 'Англия' },
  { value: 'chelsea', label: 'Челси', group: 'Англия' },
  { value: 'liverpool', label: 'Ливерпуль', group: 'Англия' },
  { value: 'barcelona', label: 'Барселона', group: 'Испания' },
  { value: 'real', label: 'Реал Мадрид', group: 'Испания' },
];

export function KitGallery() {
  const initial = initialFromQuery();
  const [scheme, setScheme] = useState<Scheme>(initial.scheme);
  const [density, setDensity] = useState<Density>(initial.density);
  const [tab, setTab] = useState('today');
  const [nav, setNav] = useState('buttons');
  const [period, setPeriod] = useState('today');
  const [dialogOpen, setDialogOpen] = useState(
    () => new URLSearchParams(window.location.search).get('dialog') === '1',
  );
  const [toastOpen, setToastOpen] = useState(true);
  const [player, setPlayer] = useState('arsenal');

  return (
    <div
      className="app-root kit-gallery"
      data-scheme={scheme}
      data-density={density}
      data-theme="epl"
    >
      <div className="kit-gallery-inner">
        <header className="kit-gallery-header">
          <h1>Базовые элементы SportsDesk</h1>
          <p className="kit-gallery-note">
            Одна страница для просмотра кита. Тёмная и светлая темы, обычная и плотная плотность.
          </p>
          <div className="kit-gallery-controls">
            <div className="kit-gallery-control">
              <span className="kit-gallery-control-label">Тема</span>
              <SegmentedControl
                ariaLabel="Тема"
                value={scheme}
                onChange={(id) => setScheme(id as Scheme)}
                items={[
                  { id: 'dark', label: 'Тёмная' },
                  { id: 'light', label: 'Светлая' },
                ]}
              />
            </div>
            <div className="kit-gallery-control">
              <span className="kit-gallery-control-label">Плотность</span>
              <SegmentedControl
                ariaLabel="Плотность"
                value={density}
                onChange={(id) => setDensity(id as Density)}
                items={[
                  { id: 'default', label: 'Обычная' },
                  { id: 'compact', label: 'Плотная' },
                ]}
              />
            </div>
          </div>
        </header>

        <section className="kit-gallery-section" id="kit-buttons">
          <h2>Кнопки</h2>
          <p className="kit-gallery-note">
            Обычная, главная, тихая, опасная, маленькая, значок. Главная — одна на экран или панель.
          </p>
          <div className="kit-gallery-row">
            <Button>Обычная</Button>
            <Button variant="primary">Главная</Button>
            <Button variant="quiet">Тихая</Button>
            <Button danger>Удалить</Button>
            <Button small>Маленькая</Button>
            <Button disabled>Недоступна</Button>
            <Button busy>Сохраняем</Button>
            <Button icon={<Star size={16} aria-hidden="true" />}>В избранное</Button>
            <IconButton aria-label="Уведомления" icon={<Bell size={16} aria-hidden="true" />} />
            <IconButton
              aria-label="Уведомления"
              small
              icon={<Bell size={16} aria-hidden="true" />}
            />
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-tabs">
          <h2>Вкладки и навигация</h2>
          <p className="kit-gallery-note">
            Вкладки страницы переключаются стрелками, Home и End. Полоса навигации отмечает текущую
            страницу.
          </p>
          <Tabs
            ariaLabel="Период"
            active={tab}
            onChange={setTab}
            items={[
              { id: 'today', label: 'Сегодня' },
              { id: 'week', label: 'Неделя' },
              { id: 'plan', label: 'Мой план' },
            ]}
          />
          <p className="kit-gallery-note">
            {tab === 'today'
              ? 'Выбрано «Сегодня».'
              : tab === 'week'
                ? 'Выбрана «Неделя».'
                : 'Выбран «Мой план».'}
          </p>
          <Tabs
            ariaLabel="Разделы кита"
            mode="nav"
            active={nav}
            onChange={setNav}
            items={[
              { id: 'buttons', label: 'Кнопки', href: '#kit-buttons' },
              { id: 'tabs', label: 'Вкладки', href: '#kit-tabs' },
              { id: 'matches', label: 'Матчи', href: '#kit-matches' },
              { id: 'table', label: 'Таблица', href: '#kit-table' },
            ]}
          />
        </section>

        <section className="kit-gallery-section" id="kit-segmented">
          <h2>Сегментированный переключатель</h2>
          <p className="kit-gallery-note">
            Радиогруппа с одной остановкой Tab. Стрелки, Home и End выбирают вариант.
          </p>
          <SegmentedControl
            ariaLabel="Период плана"
            value={period}
            onChange={setPeriod}
            items={[
              { id: 'today', label: 'Сегодня' },
              { id: 'week', label: 'Неделя' },
              { id: 'plan', label: 'Мой план' },
            ]}
          />
        </section>

        <section className="kit-gallery-section" id="kit-matches">
          <h2>Строка матча</h2>
          <p className="kit-gallery-note">
            Три размера. Время или состояние, команды с эмблемами, счёт, турнир и место для
            действий. Неизвестное значение — прочерк.
          </p>
          <div className="kit-gallery-stack">
            <MatchRow
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              time="21:30"
              status="scheduled"
              competition="Премьер-лига"
            />
            <MatchRow
              home={{ name: 'Ливерпуль' }}
              away={{ name: 'Манчестер Сити' }}
              status="live"
              minute={67}
              score={{ home: 2, away: 1 }}
              competition="Премьер-лига"
            />
            <MatchRow
              home={{ name: 'Тоттенхэм' }}
              away={{ name: 'Ньюкасл' }}
              status="finished"
              time="сб, 14 нояб."
              score={{ home: 1, away: 1 }}
              competition="Премьер-лига"
            />
            <MatchRow
              home={{ name: 'Барселона' }}
              away={{ name: 'Реал Мадрид' }}
              status="postponed"
              competition="Ла Лига"
            />
            <MatchRow
              home={{ name: 'Бавария' }}
              away={{ name: 'Боруссия' }}
              status="finished"
              score={{ home: 2, away: 1 }}
              hideScore
              competition="Бундеслига"
            />
            <MatchRow
              home={{ name: 'Атлетико' }}
              away={{ name: 'Севилья' }}
              score={{ home: null, away: null }}
              competition="Ла Лига"
            />
            <MatchRow
              size="compact"
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              time="21:30"
              status="scheduled"
              competition="Премьер-лига"
              actions={
                <>
                  <Button small variant="quiet">
                    Открыть
                  </Button>
                  <IconButton
                    aria-label="Скрыть результат"
                    small
                    icon={<EyeOff size={14} aria-hidden="true" />}
                  />
                </>
              }
            />
            <MatchRow
              size="large"
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              status="live"
              minute={12}
              score={{ home: 0, away: 0 }}
              competition="Премьер-лига"
            />
          </div>
          <div className="kit-gallery-narrow">
            <Panel aria-labelledby="kit-narrow-title">
              <PanelHeader id="kit-narrow-title" title="Узкая панель · 360 px" />
              <MatchRow
                home={{ name: 'Боруссия Мёнхенгладбах' }}
                away={{ name: 'Вулверхэмптон Уондерерс' }}
                time="21:30"
                status="scheduled"
                competition="Премьер-лига"
              />
              <MatchRow
                size="compact"
                home={{ name: 'Боруссия Мёнхенгладбах' }}
                away={{ name: 'Вулверхэмптон Уондерерс' }}
                status="live"
                minute={67}
                score={{ home: 2, away: 1 }}
                competition="Премьер-лига"
              />
            </Panel>
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-panels">
          <h2>Панели и заголовки</h2>
          <p className="kit-gallery-note">
            Заголовок страницы, крупного раздела и панели. У панели не больше одного действия.
          </p>
          <h1 className="ui-page-title">Заголовок страницы</h1>
          <h2 className="ui-section-title">Заголовок крупного раздела</h2>
          <div className="kit-gallery-panels">
            <Panel aria-labelledby="kit-panel-title">
              <PanelHeader
                id="kit-panel-title"
                title="Ближайшие матчи"
                action={
                  <Button variant="quiet" small>
                    Все матчи
                  </Button>
                }
              />
              <MatchRow
                size="compact"
                home={{ name: 'Арсенал' }}
                away={{ name: 'Челси' }}
                time="21:30"
                status="scheduled"
                competition="Премьер-лига"
              />
              <MatchRow
                size="compact"
                home={{ name: 'Ливерпуль' }}
                away={{ name: 'Манчестер Сити' }}
                status="live"
                minute={67}
                score={{ home: 2, away: 1 }}
                competition="Премьер-лига"
              />
            </Panel>
            <Panel>
              <PanelHeader
                title="Последние результаты"
                action={<Badge variant="live">Идёт</Badge>}
              />
              <p className="kit-gallery-note">
                Панель держит содержимое и один заголовок второго уровня.
              </p>
            </Panel>
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-table">
          <h2>Таблица</h2>
          <p className="kit-gallery-note">
            Закреплённая шапка, эмблемы, подсветка избранного. Числа справа, цифры одинаковой
            ширины. Плотность берётся из настройки приложения.
          </p>
          <div className="ui-table-scroll kit-gallery-table-scroll">
            <table className="ui-table">
              <thead>
                <tr>
                  <th className="ui-table__num">#</th>
                  <th>Команда</th>
                  <th className="ui-table__num">И</th>
                  <th className="ui-table__num">В</th>
                  <th className="ui-table__num">Н</th>
                  <th className="ui-table__num">П</th>
                  <th className="ui-table__num">ЗМ</th>
                  <th className="ui-table__num">О</th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row) => (
                  <tr key={row.team} className={row.place === 1 ? 'ui-table__favorite' : undefined}>
                    <td className="ui-table__num">{row.place}</td>
                    <td>
                      <span className="ui-table__team">
                        <TeamBadge name={row.team} size={18} />
                        <span className="ui-table__team-name">{row.team}</span>
                      </span>
                    </td>
                    <td className="ui-table__num">{row.played}</td>
                    <td className="ui-table__num">{row.wins}</td>
                    <td className="ui-table__num">{row.draws}</td>
                    <td className="ui-table__num">{row.losses}</td>
                    <td className="ui-table__num">{row.goals}</td>
                    <td className="ui-table__num">{row.points}</td>
                  </tr>
                ))}
                <tr>
                  <td className="ui-table__num">7</td>
                  <td>
                    <span className="ui-table__team">
                      <TeamBadge name="Астон Вилла" size={18} />
                      <span className="ui-table__team-name">Астон Вилла</span>
                    </span>
                  </td>
                  <td className="ui-table__num">12</td>
                  <td className="ui-table__num">4</td>
                  <td className="ui-table__num">3</td>
                  <td className="ui-table__num">5</td>
                  <td className="ui-table__num">—</td>
                  <td className="ui-table__num">15</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-stats">
          <h2>Плитки показателей</h2>
          <p className="kit-gallery-note">
            Плитка без значения не показывается. Ноль — настоящее значение и остаётся.
          </p>
          <div className="kit-gallery-stats">
            <StatTile label="Просмотров" value="12" />
            <StatTile label="Средняя оценка" value="7,5" note="оценено: 2" />
            <StatTile label="Схем" value={0} />
            <StatTile label="Матчей" />
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-empty">
          <h2>Пустое состояние</h2>
          <p className="kit-gallery-note">Один значок, одна фраза, не больше одного действия.</p>
          <EmptyState
            icon={<Inbox size={20} aria-hidden="true" />}
            message="На сегодня матчей нет."
            action={<Button variant="quiet">Обновить</Button>}
          />
        </section>

        <section className="kit-gallery-section" id="kit-badges">
          <h2>Метки</h2>
          <div className="kit-gallery-row">
            <Badge>Обычная</Badge>
            <Badge variant="live">Идёт</Badge>
            <Badge variant="win">Победа</Badge>
            <Badge variant="draw">Ничья</Badge>
            <Badge variant="loss">Поражение</Badge>
            <Badge variant="warning">Предупреждение</Badge>
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-tooltip">
          <h2>Подсказка</h2>
          <div className="kit-gallery-row kit-gallery-tooltip">
            <Tooltip label="Результат скрыт до явного показа">
              <Button variant="quiet" icon={<EyeOff size={16} aria-hidden="true" />}>
                Без спойлеров
              </Button>
            </Tooltip>
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-dialog">
          <h2>Диалог</h2>
          <p className="kit-gallery-note">
            Фокус остаётся внутри, Escape закрывает, после закрытия фокус возвращается на кнопку.
          </p>
          <Button
            className="kit-gallery-dialog-trigger"
            variant="primary"
            onClick={() => setDialogOpen(true)}
          >
            Открыть диалог
          </Button>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Подтверждение"
            footer={
              <>
                <Button variant="quiet" onClick={() => setDialogOpen(false)}>
                  Отмена
                </Button>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>
                  Продолжить
                </Button>
              </>
            }
          >
            <p>Одна короткая фраза о том, что произойдёт.</p>
          </Dialog>
        </section>

        <section className="kit-gallery-section" id="kit-toast">
          <h2>Уведомление</h2>
          <p className="kit-gallery-note">
            Один вариант. Родитель решает, когда уведомление исчезнет.
          </p>
          <div className="kit-gallery-row kit-gallery-toast">
            {toastOpen ? (
              <Toast
                message="Профиль сохранён"
                action={
                  <Button small variant="quiet">
                    Открыть
                  </Button>
                }
                onDismiss={() => setToastOpen(false)}
              />
            ) : (
              <Button variant="quiet" onClick={() => setToastOpen(true)}>
                Показать уведомление
              </Button>
            )}
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-skeleton">
          <h2>Скелетон</h2>
          <div className="kit-gallery-stack">
            <Skeleton />
            <Skeleton />
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-search">
          <h2>Выбор с поиском</h2>
          <p className="kit-gallery-note">
            Существующий SearchSelect: поиск без учёта регистра, группы и клавиатура.
          </p>
          <div className="kit-gallery-row">
            <SearchSelect
              ariaLabel="Клуб"
              value={player}
              onChange={setPlayer}
              options={SEARCH_OPTIONS}
              placeholder="Найти клуб"
            />
          </div>
          <p className="kit-gallery-note">
            <Search size={14} aria-hidden="true" /> Выбран: {player || 'ничего'}.
            <ArrowRight size={14} aria-hidden="true" /> Стрелки и Enter работают.
          </p>
        </section>

        <p className="kit-gallery-footer">
          Кит не подключён к экранам. Эта страница не входит в сборку приложения.
        </p>
      </div>
    </div>
  );
}

const root = document.getElementById('kit-root');
if (!root) throw new Error('Kit root not found');

createRoot(root).render(<KitGallery />);
