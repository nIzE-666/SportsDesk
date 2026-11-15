# Базовые элементы интерфейса

Кит из `src/kit/` — один набор элементов на токенах из `src/tokens.css`. Экраны пока
не переведены на него: шаг U3.4, часть 1 только создаёт кит и карту замены. Следующие
шаги берут классы и компоненты отсюда, а не заводят свои.

- `kit.css` подключается в `src/main.tsx` сразу после `tokens.css`.
- Все классы начинаются с `ui-`; сырых цветов, размеров шрифта и скруглений в файле нет.
- Разметка тонкая, данные и состояния остаются в экранах. Счёт, время и числа приходят
  уже готовыми строками.
- Тексты — по разделу 5.4 плана: одна короткая фраза, без слов об устройстве программы.

## Компоненты и свойства

| Компонент          | Главные свойства                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `Button`           | `variant`: `default`, `primary`, `quiet`; `danger`, `small`, `busy`, `icon`; `aria-pressed`                            |
| `IconButton`       | `icon`, обязательный `aria-label`, `variant`, `small`, `busy`, `danger`                                                |
| `Tabs`             | `items`, `ariaLabel`, `mode`: `tabs`/`nav`, `active`, `onChange`, `panelId`; у пункта `domId`, `title`, `ref`          |
| `SegmentedControl` | `items`, `value`, `onChange`, `ariaLabel`                                                                              |
| `MatchRow`         | `home`, `away`, `time`, `status`, `minute`, `score`, `hideScore`, `competition`, `badge`, `actions`, `size`, `onClick` |
| `Panel`            | свойства `section` и `children`                                                                                        |
| `PanelHeader`      | `title`, `action`, `id`                                                                                                |
| `StatTile`         | `label`, `value`, `note`; без `value` не рисуется                                                                      |
| `EmptyState`       | `message`, `icon`, `action`                                                                                            |
| `Badge`            | `children`, `variant`: `live`, `win`, `draw`, `loss`, `warning`                                                        |
| `Tooltip`          | `label`, `children`, `side`: `top`/`bottom`                                                                            |
| `Dialog`           | `open`, `onClose`, `title`, `children`, `footer`, `closeLabel`                                                         |
| `Toast`            | `message`, `action`, `onDismiss`, `dismissLabel`, `tone`: `info`/`error`                                               |
| `Skeleton`         | свойства `span`; размер задаёт родитель                                                                                |
| `SearchSelect`     | `ariaLabel`, `value`, `options`, `onChange`, `placeholder`, `clearLabel`                                               |

## Кнопки

| Класс                 | Когда использовать                                                       |
| --------------------- | ------------------------------------------------------------------------ |
| `.ui-button`          | обычное действие                                                         |
| `.ui-button--primary` | главное действие; одно на экран или панель                               |
| `.ui-button--quiet`   | второстепенное действие и ссылка-кнопка                                  |
| `.ui-button--icon`    | квадратная кнопка со значком; обязателен `aria-label`                    |
| `.ui-button--danger`  | опасное действие; сочетается с обычной, главной и тихой                  |
| `.ui-button--small`   | высота `--control-sm` вместо `--control-md`                              |
| `aria-busy="true"`    | идёт действие: кнопка недоступна, вместо значка крутится индикатор       |
| `aria-pressed="true"` | переключатель включён: фон `--color-accent-soft`, текст и рамка — акцент |
| `disabled`            | действие недоступно                                                      |

`Button` принимает `variant` (`default`, `primary`, `quiet`), `danger`, `small`,
`busy`, `icon` и обычные свойства кнопки. `IconButton` требует `aria-label` и
рисует только значок.

## Вкладки, навигация и переключатель

`Tabs` — одна реализация в двух режимах.

| Режим         | Разметка                                                             |
| ------------- | -------------------------------------------------------------------- |
| `mode="tabs"` | `role="tablist"` и `role="tab"`, `aria-selected`, одна остановка Tab |
| `mode="nav"`  | ссылки или кнопки с `aria-current="page"`                            |

В режиме вкладок работают стрелки влево и вправо, `Home` и `End`; невыбранные
вкладки имеют `tabindex="-1"`. В режиме навигации ссылка остаётся ссылкой, если
у пункта есть `href`.

`SegmentedControl` (`.ui-segmented`) — радиогруппа с одной остановкой Tab,
стрелками, `Home` и `End`. Для переключателей вида «Сегодня · Неделя · Мой план»
и фильтров из трёх–четырёх вариантов.

## Строка матча

`MatchRow` (`.ui-match-row`) — время или состояние, команды с эмблемами, счёт,
необязательный турнир, одна метка и место для действий. Подписей «Хозяева» и «Гости» нет:
сторону показывает порядок. Неизвестное значение — прочерк. Время, счёт и турнир
занимают постоянные колонки, поэтому счёт стоит на одном месте во всех строках списка;
колонка турнира включается классами `--with-competition` и `--with-badge`, а в панели
уже 480 px турнир и метка переходят на вторую строку.

| Класс                             | Что делает                                        |
| --------------------------------- | ------------------------------------------------- |
| `.ui-match-row--compact`          | плотная строка, эмблемы 20 px                     |
| `.ui-match-row`                   | обычная строка, эмблемы 28 px                     |
| `.ui-match-row--large`            | крупная строка, эмблемы 36 px, счёт `--text-24`   |
| `.ui-match-row--with-competition` | постоянная колонка турнира (192 px)               |
| `.ui-match-row--with-badge`       | постоянная колонка метки (96 px)                  |
| `.ui-match-row__badge`            | одна метка рядом с турниром, например «Избранное» |
| `.ui-match-row__actions`          | кнопки строки; с действиями строка не кликабельна |
| `.ui-match-row__score--hidden`    | режим без спойлеров: счёт заменён на `? : ?`      |

`hideScore` включает ту же маску, что `src/features/spoilers/`. Строка не читает
хранилище сама: экран передаёт `hideScore` из `useResultHidden`. В узком контейнере
(до 480 px) турнир переходит на вторую строку, а длинные названия команд
сокращаются с многоточием. Переполнение проверяет `e2e/kit.pw.ts` на 1100 px и в
панели шириной 360 px.

## Панели, заголовки и таблицы

- `Panel` (`.ui-panel`) — поверхность с рамкой, большим скруглением и тенью.
- `PanelHeader` — единственный `h2` панели и не больше одного действия.
- `.ui-page-title` — заголовок страницы (`--text-24`).
- `.ui-section-title` — заголовок крупного раздела (`--text-20`).
- `.ui-table` — таблица с закреплённой шапкой. Обёртка `.ui-table-scroll` даёт
  прокрутку. `.ui-table__team` ставит эмблему и название, `.ui-table__num` —
  числовая колонка справа с `tabular-nums`, `ui-table__favorite` подсвечивает строку.
  Плотный вариант включается сам при `data-density="compact"` на `.app-root`.

## Плитки, пустые состояния и метки

- `StatTile` (`.ui-stat`) — подпись, значение и необязательная заметка. Без
  значения не рисуется; ноль остаётся.
- `EmptyState` (`.ui-empty`) — значок, одна фраза и не больше одного действия.
- `Badge` (`.ui-badge`) — варианты `live`, `win`, `draw`, `loss`, `warning` и
  обычная метка без варианта.

## Подсказка, диалог, уведомление и скелетон

- `Tooltip` (`.ui-tooltip`) — одна подсказка, показывается при наведении и фокусе.
- `Dialog` (`.ui-dialog`) — один диалог: фокус остаётся внутри, Escape закрывает,
  после закрытия фокус возвращается на кнопку, которая его открыла.
- `Toast` (`.ui-toast`) — одно уведомление; родитель решает, когда его убрать.
- `Skeleton` (`.ui-skeleton`) — одна заглушка загрузки.
- `SearchSelect` — существующий компонент, повторно экспортируется из кита как
  есть; группы у него уже есть.

## Перепись и замена

### Кнопки: 14 классов

Считаем без модификаторов `.watch-btn-*`: они относятся к `.watch-btn`. Кнопки-строки
и кнопки-ячейки — в следующей таблице, потому что это части строк и таблиц.

| Сейчас                 | Где                                                                                                                                                                  | Замена                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `.primary-btn`         | `src/components/{SectionBoundary,WhatsNewDialog}.tsx`, `src/features/{f1,football,games,offline,onboarding}/**`, `src/design.css`                                    | `.ui-button.ui-button--primary`                                   |
| `.ghost-btn`           | `src/components/*.tsx`, `src/features/{diary,events,f1,football,games,my,offline,onboarding,planner,settings,today,ucl,watch}/**`, `src/lib/watchIntent.tsx`         | `.ui-button`, активный — `aria-pressed`/`--quiet`                 |
| `.icon-button`         | `src/app/{EventsDrawer,PageHeader}.tsx`, `src/components/{DesignChooser,GlobalSearch,WhatsNewDialog}.tsx`, `src/features/{atmosphere,f1,football,onboarding,ucl}/**` | `IconButton`                                                      |
| `.link-btn`            | `src/components/SourceLine.tsx`, `src/features/football/{MatchesView,MatchPlayers}.tsx`, `src/design.css`                                                            | `.ui-button.ui-button--quiet`                                     |
| `.badge-btn`           | только `src/design.css` (сейчас не используется)                                                                                                                     | `IconButton`                                                      |
| `.f1-btn`              | `src/features/f1/{Overview,shared}.tsx`, `f1.css`, `broadcast.css`                                                                                                   | `.ui-button`; акцент — `--primary`                                |
| `.watch-btn`           | `src/features/watch/{WatchAuth,WatchPlayer,WatchView}.tsx`, `watch.css`                                                                                              | `.ui-button`; `watch-btn-primary/ghost/danger/sm` — варианты кита |
| `.watch-link-btn`      | `src/features/watch/{WatchPlayer,WatchView}.tsx`, `watch.css`                                                                                                        | `.ui-button.ui-button--quiet`                                     |
| `.watch-filter-btn`    | `src/features/watch/WatchView.tsx`, `watch.css`                                                                                                                      | `SegmentedControl`                                                |
| `.watch-fav-chip`      | `src/features/watch/WatchView.tsx`, `watch.css`                                                                                                                      | `SegmentedControl` или `Badge`                                    |
| `.player-name-button`  | `src/features/football/PlayersCenter.tsx`, `players.css`                                                                                                             | `.ui-button.ui-button--quiet`                                     |
| `.player-photo-button` | `src/features/football/PlayersCenter.tsx`, `players.css`                                                                                                             | `IconButton`                                                      |
| `.live-flat-button`    | `src/features/football/LivePanel.tsx`, `football.css`                                                                                                                | `MatchRow` с `onClick`                                            |
| `.my-chip`             | `src/features/my/MyView.tsx`, `my.css`                                                                                                                               | `Button` с `small`/`quiet`                                        |

Дополнительно: `.text-link` используется и на кнопках (`src/features/{events,f1,football,ucl}/**`,
`ucl.css`) — это `.ui-button--quiet`; `.row-star`, `.player-favorite`, `.mini-close`,
`.mini-retry`, `.search-select-clear`, `.spoiler-toggle` — `IconButton` или
`.ui-button--quiet`.

### Вкладки и полосы

| Сейчас                     | Где                                                                                                                | Замена             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `.shell-tabs`/`.shell-tab` | `src/app/PageHeader.tsx`, `shell.css`                                                                              | `Tabs mode="tabs"` |
| `.md-tabs`                 | `src/features/football/MatchDetailView.tsx`, `design.css`                                                          | `Tabs mode="tabs"` |
| `.f1-tabs`/`.f1-tab`       | `src/features/f1/{F1Analysis,RaceWeekend,Standings}.tsx`, `f1.css`                                                 | `Tabs mode="tabs"` |
| `.games-tabs`              | `src/features/games/GamesView.tsx`, `games.css`                                                                    | `Tabs mode="tabs"` |
| `.watch-filter-row`        | `src/features/watch/WatchView.tsx`, `watch.css`                                                                    | `SegmentedControl` |
| `.stats-period-nav`        | `src/features/football/MatchStatsTab.tsx`, `matchStats.css`                                                        | `SegmentedControl` |
| `.segmented`               | `src/features/football/{LivePanel,MatchesView}.tsx`, `src/features/ucl/{ChampionsView,CupsView}.tsx`, `design.css` | `SegmentedControl` |
| Фильтры плана и формы      | `src/features/planner/ViewingPlanner.tsx`, `src/features/football/PlayerFormPanel.tsx`                             | `SegmentedControl` |
| Боковые списки разделов    | `src/app/NavRail.tsx`, `src/features/settings/SettingsView.tsx`, `src/features/watch/WatchChannels.tsx`            | `Tabs mode="nav"`  |

### Строки матча

| Сейчас                   | Где                                                           | Замена                        |
| ------------------------ | ------------------------------------------------------------- | ----------------------------- |
| `.game-row`              | `src/components/MatchRow.tsx`, `design.css`                   | `MatchRow`, размер нормальный |
| `.mt-row`                | `src/features/football/MatchesView.tsx`, `design.css`         | `MatchRow`/`ui-table`         |
| `.team-match-row`        | `src/features/football/TeamView.tsx`, `football.css`          | `MatchRow`, компактный        |
| `.live-flat`             | `src/features/football/LivePanel.tsx`, `football.css`         | `MatchRow`                    |
| `.today-live-row`        | `src/features/today/TodayView.tsx`, `today.css`               | `MatchRow`, компактный        |
| `.planner-event`         | `src/features/planner/ViewingPlanner.tsx`, `planner.css`      | `MatchRow` + `Panel`          |
| `.form-match-row`        | `src/features/football/PlayerFormPanel.tsx`, `playerForm.css` | `MatchRow`, компактный        |
| `.tie-main`, `.tie-legs` | `src/features/ucl/{ChampionsView,CupsView}.tsx`, `ucl.css`    | `MatchRow` внутри сетки       |
| `.mini-row`              | `src/features/football/MiniWindow.tsx`, `mini.css`            | `MatchRow`, компактный        |

### Таблицы

| Сейчас              | Где                                                                | Замена      |
| ------------------- | ------------------------------------------------------------------ | ----------- |
| `.match-table`      | `src/features/football/MatchesView.tsx`, `design.css`              | `.ui-table` |
| `.standings-table`  | `src/features/football/StandingsView.tsx`, `design.css`            | `.ui-table` |
| `.f1-table`         | `src/features/f1/{Standings,WeekendResults,Session}.tsx`, `f1.css` | `.ui-table` |
| `.ucl-table`        | `src/features/ucl/{ChampionsView,CupsView}.tsx`, `ucl.css`         | `.ui-table` |
| `.analysis-table`   | `src/features/football/MatchAnalysis.tsx`, `matchAnalysis.css`     | `.ui-table` |
| `.diary-table-wrap` | `src/features/diary/DiaryView.tsx`, `diary.css`                    | `.ui-table` |
| `.offline-table`    | `src/features/offline/OfflineView.tsx`, `offline.css`              | `.ui-table` |
| `.form-match-list`  | `src/features/football/PlayerFormPanel.tsx`, `playerForm.css`      | `.ui-table` |

### Плитки показателей

| Сейчас                          | Где                                                                     | Замена                   |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `.my-tile`                      | `src/features/my/MyView.tsx`, `my.css`                                  | `StatTile`               |
| `.pc-metric`                    | `src/features/football/PlayersCenter.tsx`, `players.css`                | `StatTile`               |
| `.season-metric`                | `src/features/football/SeasonPlayerPanel.tsx`, `design.css`             | `StatTile`               |
| `.team-record-cell`             | `src/features/football/TeamView.tsx`, `football.css`                    | `StatTile`               |
| `.form-summary-card`            | `src/features/football/PlayerFormPanel.tsx`, `playerForm.css`           | `StatTile` внутри кнопки |
| `.diary-summary`                | `src/features/diary/DiaryView.tsx`, `diary.css`                         | `StatTile`               |
| `.planner-insights`             | `src/features/planner/ViewingPlanner.tsx`, `planner.css`                | `StatTile`               |
| `.lights-stats`                 | `src/features/games/{StartLightsGame,PredictionsGame}.tsx`, `games.css` | `StatTile`               |
| `.comparison-metrics`           | `src/features/f1/Compare.tsx`, `design.css`                             | `StatTile`               |
| `.stat-chip`, `.player-metrics` | `src/features/football/MatchPlayers.tsx`, `design.css`                  | `StatTile`               |

### Пустые состояния

| Сейчас                   | Где                                                                                                                       | Замена       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `.state-block.empty`     | `src/components/StateViews.tsx`, `styles.css`; вызывает `src/features/{diary,events,football,games,planner,today,ucl}/**` | `EmptyState` |
| `.f1-state`              | `src/features/f1/shared.tsx`, `f1.css`; `src/features/f1/**`                                                              | `EmptyState` |
| `.calendar-empty-detail` | `src/features/f1/CalendarBoard.tsx`, `calendar.css`                                                                       | `EmptyState` |
| `.mini-empty`            | `src/features/football/MiniWindow.tsx`, `mini.css`                                                                        | `EmptyState` |
| `.my-empty`              | `src/features/my/MyView.tsx`, `my.css`                                                                                    | `EmptyState` |
| `.offline-empty`         | `src/features/offline/OfflineView.tsx`, `offline.css`                                                                     | `EmptyState` |
| `.command-empty`         | `src/components/GlobalSearch.tsx`, `productivity.css`                                                                     | `EmptyState` |
| `.tactics-state`         | `src/features/tactics/TacticsBoard.tsx`, `tactics.css`                                                                    | `EmptyState` |

### Метки

| Сейчас                                            | Где                                                                                                 | Замена                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| `.chip`, `.live-chip`, `.fav-chip`, `.stale-chip` | `src/styles.css`, `design.css`, `src/features/**`                                                   | `Badge`                        |
| `.wdl`, `.wdl-w`, `.wdl-l`                        | `src/features/football/TeamView.tsx`, `football.css`                                                | `Badge` варианты win/draw/loss |
| `.f1-pill`, `.f1-chip`                            | `src/features/f1/{Overview,Session,SourceSummary,shared}.tsx`, `f1.css`                             | `Badge`                        |
| `.nav-rail-badge`                                 | `src/app/NavRail.tsx`, `shell.css`                                                                  | `Badge`                        |
| `.lights-badge`                                   | `src/features/games/StartLightsGame.tsx`, `games.css`                                               | `Badge`                        |
| `.watch-brand-badge`, `.watch-live-pill`          | `src/features/watch/{WatchPlayer,WatchView}.tsx`, `watch.css`                                       | `Badge`                        |
| `.event-cover-status`, `.live-watch-chip`         | `src/features/football/{FeaturedMatchCover,MatchDetailView}.tsx`, `broadcast.css`, `matchStats.css` | `Badge`                        |
| `.mini-status`, `.team-match-status`              | `src/features/football/{MiniWindow,TeamView}.tsx`, `mini.css`, `football.css`                       | `Badge`                        |

### Диалоги и уведомления

| Сейчас                                          | Где                                                                                                                                                                            | Замена                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `.whatsnew-scrim`/`.whatsnew-card`              | `src/components/WhatsNewDialog.tsx`, `styles.css`                                                                                                                              | `Dialog`                            |
| `.onboarding-card`                              | `src/features/onboarding/FirstRunWizard.tsx`, `onboarding.css`                                                                                                                 | `Dialog`                            |
| `.events-drawer-backdrop`/`.events-drawer`      | `src/app/EventsDrawer.tsx`, `shell.css`                                                                                                                                        | `Dialog` (позже — выдвижная панель) |
| `.command-backdrop`/`.command-panel`            | `src/components/GlobalSearch.tsx`, `productivity.css`                                                                                                                          | `Dialog`                            |
| `.watch-modal-backdrop`/`.watch-modal`          | `src/features/watch/WatchAuth.tsx`, `watch.css`                                                                                                                                | `Dialog`                            |
| `.player-modal-scrim`/`.ucl-player-modal`       | `src/features/ucl/ChampionsView.tsx`, `ucl.css`                                                                                                                                | `Dialog`                            |
| Отдельного тоста нет                            | ближайшие: `.goal-celebration-card` (`GoalCelebration.tsx`), `.finish-card` (`FinishCelebration.tsx`), `.ambient-note` (`AmbientToggle.tsx`), `.update-notice` (`Updates.tsx`) | `Toast`                             |
| `.ambient-note`                                 | `src/features/atmosphere/AmbientToggle.tsx`, `atmosphere.css`                                                                                                                  | `Tooltip` или `Toast`               |
| `.skeleton`, `.skeleton-stack`, `.skeleton-row` | `src/components/StateViews.tsx`, `styles.css`                                                                                                                                  | `Skeleton`                          |

## Порядок замены

1. Кнопки и вкладки: сначала общие места, потом разделы.
2. Строки матча: «Сегодня», «Матчи», клуб, лента, планировщик.
3. Таблицы: футбол, Формула-1, Лига чемпионов.
4. Плитки, пустые состояния и метки.
5. Диалоги, уведомления, подсказки и скелетоны.

После каждого шага проверять снимки на своём порту — кит не должен менять экран,
пока раздел не переведён.
