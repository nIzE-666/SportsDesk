import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, ArrowRight, Bell, EyeOff, Inbox, Search, Star } from 'lucide-react';
import '@fontsource-variable/manrope';
import '../src/kit/showcaseFonts';
import '../src/tokens.css';
import '../src/kit/kit.css';
import './kitGallery.css';
import {
  Badge,
  Button,
  Countdown,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  InterestMeter,
  MatchRow,
  MatchStrip,
  Panel,
  PanelHeader,
  SearchSelect,
  SegmentedControl,
  ShowcaseHero,
  ShowcaseShelf,
  Skeleton,
  StatTile,
  Switch,
  Tabs,
  Toast,
  Tooltip,
  WeekTrack,
  type MatchStripGoal,
  type WeekTrackEvent,
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

/* The «Витрина» demo: the current week with «сейчас» on Thursday evening. */
function showcaseWeek(): { weekStart: string; now: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  thursday.setHours(19, 30, 0, 0);
  return { weekStart: monday.toISOString(), now: thursday.toISOString() };
}

const SHOWCASE_WEEK = showcaseWeek();

function showcaseTime(day: number, hour: number, minute = 0): string {
  const date = new Date(SHOWCASE_WEEK.weekStart);
  date.setDate(date.getDate() + day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const SHOWCASE_EVENTS: WeekTrackEvent[] = [
  {
    id: 'showcase-mon',
    kind: 'match',
    start: showcaseTime(0, 20),
    interest: 3,
    label: 'Тоттенхэм — Ньюкасл, понедельник, 20:00',
  },
  {
    id: 'showcase-tue',
    kind: 'match',
    start: showcaseTime(1, 21, 30),
    interest: 5,
    label: 'Барселона — Реал Мадрид, вторник, 21:30',
  },
  {
    id: 'showcase-wed-race',
    kind: 'race',
    start: showcaseTime(2, 18),
    interest: null,
    label: 'Квалификация Формулы 1, среда, 18:00',
  },
  {
    id: 'showcase-thu',
    kind: 'match',
    start: showcaseTime(3, 21),
    interest: 4,
    mine: true,
    label: 'Арсенал — Челси, четверг, 21:00',
  },
  {
    id: 'showcase-fri',
    kind: 'match',
    start: showcaseTime(4, 20, 30),
    interest: 2,
    label: 'Бавария — Боруссия, пятница, 20:30',
  },
  {
    id: 'showcase-sat-race',
    kind: 'race',
    start: showcaseTime(5, 16),
    interest: null,
    label: 'Гонка Формулы 1, суббота, 16:00',
  },
  {
    id: 'showcase-sat',
    kind: 'match',
    start: showcaseTime(5, 19),
    interest: 5,
    label: 'Милан — Интер, суббота, 19:00',
  },
  {
    id: 'showcase-sun',
    kind: 'match',
    start: showcaseTime(6, 18),
    interest: null,
    label: 'Атлетико — Севилья, воскресенье, 18:00',
  },
];

interface ShowcaseCard {
  home: string;
  away: string;
  score: string;
  interest: number;
  reason: string;
  goals: MatchStripGoal[];
}

const SHOWCASE_CARDS: ShowcaseCard[] = [
  {
    home: 'Ливерпуль',
    away: 'Ньюкасл',
    score: '3:2',
    interest: 4,
    reason: 'камбэк с 0:2',
    goals: [
      { minute: 12, side: 'away' },
      { minute: 18, side: 'away' },
      { minute: 56, side: 'home' },
      { minute: 68, side: 'home' },
      { minute: 84, side: 'home' },
    ],
  },
  {
    home: 'Барселона',
    away: 'Атлетико',
    score: '2:1',
    interest: 3,
    reason: 'гол на 90+2',
    goals: [
      { minute: 27, side: 'home' },
      { minute: 63, side: 'away' },
      { minute: 90, extra: 2, side: 'home' },
    ],
  },
  {
    home: 'Бавария',
    away: 'Боруссия',
    score: '3:3',
    interest: 5,
    reason: 'шесть голов',
    goals: [
      { minute: 8, side: 'home' },
      { minute: 24, side: 'home' },
      { minute: 41, side: 'home' },
      { minute: 67, side: 'away' },
      { minute: 88, side: 'away' },
      { minute: 90, extra: 1, side: 'away' },
    ],
  },
  {
    home: 'Милан',
    away: 'Интер',
    score: '2:1',
    interest: 2,
    reason: 'поздний гол',
    goals: [
      { minute: 33, side: 'home' },
      { minute: 58, side: 'away' },
      { minute: 88, side: 'home' },
    ],
  },
];

const SHOWCASE_HERO_TARGET = new Date(
  Date.now() + 2 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000 + 5 * 60 * 1000 + 32 * 1000,
).toISOString();

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
  const [switchOn, setSwitchOn] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = new Date(SHOWCASE_WEEK.weekStart);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekEvents = weekOffset === 0 ? SHOWCASE_EVENTS : [];

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

        <section className="kit-gallery-section" id="kit-showcase">
          <h2>Витрина</h2>
          <p className="kit-gallery-note">
            Слой «Главное»: эфирная плашка, полка с прокруткой, неделя-трасса и карточка матча. Всё
            действует только внутри класса `showcase`, остальные экраны не меняются.
          </p>
          <div className="showcase kit-showcase">
            <ShowcaseHero
              kicker="Главный матч"
              title="Арсенал — Челси"
              meta={<Countdown target={SHOWCASE_HERO_TARGET} endedLabel="Матч начался" />}
              actions={
                <>
                  <Button variant="primary">Буду смотреть</Button>
                  <Button>Напомнить</Button>
                </>
              }
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              homeColor="#c8102e"
              awayColor="#1d4f9e"
            />

            <ShowcaseShelf title="Лучшее за неделю" emptyText="Прошедших матчей пока нет.">
              {SHOWCASE_CARDS.map((card) => (
                <div
                  key={card.home}
                  className="kit-showcase-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`${card.home} — ${card.away}, ${card.score}`}
                >
                  <span className="kit-showcase-card__line">
                    <span className="kit-showcase-card__team">{card.home}</span>
                    <span className="ui-showcase-score">{card.score}</span>
                    <span className="kit-showcase-card__team kit-showcase-card__team--away">
                      {card.away}
                    </span>
                  </span>
                  <span className="kit-showcase-card__meta">
                    <InterestMeter value={card.interest} />
                    <span className="kit-showcase-card__reason">{card.reason}</span>
                  </span>
                  <MatchStrip goals={card.goals} length={90} />
                </div>
              ))}
            </ShowcaseShelf>

            <WeekTrack
              weekStart={weekStart.toISOString()}
              now={SHOWCASE_WEEK.now}
              events={weekEvents}
              onOpen={() => undefined}
              onPrevWeek={() => setWeekOffset((value) => value - 1)}
              onNextWeek={() => setWeekOffset((value) => value + 1)}
              renderPreview={(id) => {
                const event = SHOWCASE_EVENTS.find((item) => item.id === id);
                if (!event) return null;
                return (
                  <div className="kit-showcase-preview">
                    <span className="kit-showcase-preview__kind">
                      {event.kind === 'race' ? 'Гонка' : 'Матч'}
                    </span>
                    <span className="kit-showcase-preview__text">{event.label}</span>
                    <InterestMeter value={event.interest} />
                  </div>
                );
              }}
            />

            <ShowcaseShelf title="Главное впереди" emptyText="Ближайших матчей пока нет." />
          </div>
        </section>

        <section className="kit-gallery-section" id="kit-buttons">
          <h2>Кнопки</h2>
          <p className="kit-gallery-note">
            Обычная, главная, тихая, опасная, маленькая, значок. Главная — одна на экран или панель.
            Включённый переключатель помечается `aria-pressed`: фон с примесью акцента и акцентный
            текст.
          </p>
          <div className="kit-gallery-row">
            <Button>Обычная</Button>
            <Button variant="primary">Главная</Button>
            <Button variant="quiet">Тихая</Button>
            <Button danger>Удалить</Button>
            <Button small>Маленькая</Button>
            <Button disabled>Недоступна</Button>
            <Button variant="primary" disabled>
              Главная недоступна
            </Button>
            <Button busy>Сохраняем</Button>
            <Button icon={<Star size={16} aria-hidden="true" />}>В избранное</Button>
            <Button aria-pressed="true" icon={<Star size={16} aria-hidden="true" />}>
              В избранном
            </Button>
            <IconButton aria-label="Уведомления" icon={<Bell size={16} aria-hidden="true" />} />
            <IconButton
              aria-label="Уведомления включены"
              aria-pressed="true"
              icon={<Bell size={16} aria-hidden="true" />}
            />
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
            panelId="kit-tabs-panel"
            active={tab}
            onChange={setTab}
            items={[
              { id: 'today', domId: 'kit-tab-today', title: 'Сегодня', label: 'Сегодня' },
              { id: 'week', domId: 'kit-tab-week', title: 'Неделя', label: 'Неделя' },
              { id: 'plan', domId: 'kit-tab-plan', title: 'Мой план', label: 'Мой план' },
            ]}
          />
          <p className="kit-gallery-note" id="kit-tabs-panel">
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
              { id: 'showcase', label: 'Витрина', href: '#kit-showcase' },
              { id: 'buttons', label: 'Кнопки', href: '#kit-buttons' },
              { id: 'tabs', label: 'Вкладки', href: '#kit-tabs' },
              { id: 'controls', label: 'Поля', href: '#kit-controls' },
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

        <section className="kit-gallery-section" id="kit-controls">
          <h2>Поля, переключатели и свёрнутые части</h2>
          <p className="kit-gallery-note">
            Поле — подпись, элемент и заметка. Переключатель — настоящий checkbox с дорожкой.
            Свёрнутая часть открывается тихой кнопкой кита.
          </p>
          <Field label="Часовой пояс" htmlFor="kit-timezone" inline>
            <select id="kit-timezone" defaultValue="Asia/Yakutsk">
              <option value="Asia/Yakutsk">Asia/Yakutsk</option>
              <option value="Europe/Moscow">Europe/Moscow</option>
              <option value="UTC">UTC</option>
            </select>
          </Field>
          <Field label="Отключённое поле" htmlFor="kit-disabled-field">
            <input id="kit-disabled-field" type="time" defaultValue="23:00" disabled />
          </Field>
          <Switch
            label="Плотные таблицы"
            description="Больше строк на экране."
            checked={switchOn}
            onChange={setSwitchOn}
          />
          <Switch
            label="Недоступный переключатель"
            checked={false}
            disabled
            onChange={() => undefined}
          />
          <Disclosure label="Настройки по клубам" hint="2">
            <p className="kit-gallery-note">Арсенал и Челси.</p>
          </Disclosure>
        </section>

        <section className="kit-gallery-section" id="kit-matches">
          <h2>Строка матча</h2>
          <p className="kit-gallery-note">
            Три размера. Время или состояние, команды с эмблемами, счёт, турнир, одна метка и место
            для действий. Неизвестное значение — прочерк. Время, счёт и турнир занимают постоянные
            колонки, поэтому счёт стоит на одном месте во всех строках списка.
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
              home={{
                name: 'Арсенал',
                action: (
                  <IconButton
                    small
                    aria-label="Отслеживать: Арсенал"
                    title="Отслеживать: Арсенал"
                    icon={<Star size={14} aria-hidden="true" />}
                  />
                ),
              }}
              away={{
                name: 'Челси',
                action: (
                  <IconButton
                    small
                    aria-label="Отслеживать: Челси"
                    title="Отслеживать: Челси"
                    icon={<Star size={14} aria-hidden="true" />}
                  />
                ),
              }}
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
              badge={<Badge>Избранное</Badge>}
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
              home={{ name: 'Валенсия' }}
              away={{ name: 'Сельта' }}
              status="cancelled"
              competition="Ла Лига"
            />
            <MatchRow
              home={{ name: 'Хетафе' }}
              away={{ name: 'Осасуна' }}
              status="unknown"
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
              size="large"
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              status="live"
              minute={12}
              score={{ home: 0, away: 0 }}
              competition="Премьер-лига"
            />
          </div>
          <div className="kit-gallery-stack" id="kit-score-list">
            <MatchRow
              home={{ name: 'Арсенал' }}
              away={{ name: 'Челси' }}
              status="finished"
              time="сб, 14 нояб."
              score={{ home: 2, away: 1 }}
              competition="Премьер-лига"
            />
            <MatchRow
              home={{ name: 'Боруссия Мёнхенгладбах' }}
              away={{ name: 'Вулверхэмптон Уондерерс' }}
              status="live"
              minute={67}
              score={{ home: 10, away: 10 }}
              competition="Лига чемпионов"
            />
            <MatchRow
              home={{ name: 'Интер' }}
              away={{ name: 'Милан' }}
              status="scheduled"
              time="21:30"
              score={{ home: null, away: null }}
              competition="Серия A"
            />
          </div>
          <p className="kit-gallery-note">
            С действиями строка не кликабельна; действия стоят после турнира.
          </p>
          <MatchRow
            size="compact"
            home={{ name: 'Арсенал' }}
            away={{ name: 'Челси' }}
            status="finished"
            score={{ home: 3, away: 2 }}
            competition="2 матча"
            ariaLabel="Арсенал — Челси, 2 матча"
            ariaExpanded={false}
            onClick={() => {}}
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
          <p className="kit-gallery-note">
            Заголовок на отдельной строке, одна фраза, не больше одного действия. Ошибка объявляется
            как alert, значок — цвета ошибки. `compact` уменьшает отступы для узкой панели.
          </p>
          <EmptyState
            icon={<Inbox size={20} aria-hidden="true" />}
            message="На сегодня матчей нет."
            action={<Button variant="quiet">Обновить</Button>}
          />
          <EmptyState
            compact
            icon={<Inbox size={20} aria-hidden="true" />}
            message="Сейчас нет матчей избранных клубов."
          />
          <EmptyState
            title="Сезонов пока нет"
            icon={<Inbox size={20} aria-hidden="true" />}
            message="Сезоны появятся, когда источник их опубликует."
          />
          <EmptyState
            tone="error"
            title="Турнир временно недоступен"
            icon={<AlertTriangle size={20} aria-hidden="true" />}
            message="Попробуйте обновить данные позже."
            action={<Button variant="quiet">Повторить</Button>}
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
