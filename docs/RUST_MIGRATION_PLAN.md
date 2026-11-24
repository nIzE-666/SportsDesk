# План переноса SportsDesk на Rust (по методологии `$rust-anything`)

**Статус:** пересобран с помощью `rust-anything 3.1.0` (`24 ноября 2026`), **отложен на потом** по решению владельца (приоритет сейчас — допилить рабочий SportsDesk 2.1+).

---

## 1. Вывод статического анализа `rust-anything analyze`

Команда `rust-anything analyze` по текущему репозиторию (`sportsdesk/ui-refresh`, коммит `3b4afed`):

- **1 пакет**, 121 исходный файл (48 654 строк), 198 тестовых файлов, **143 UI-файла**, сгруппировано в **26 модулей (units)**:

| Ready (`napi-rs`) | Caution | Blocked | Keep в TypeScript/React |
| ---: | ---: | ---: | ---: |
| **1** (`scripts/`, 273 стр.) | 0 | 0 | **25** |

### Почему `rust-anything` сам пометил 25 из 26 юнитов как `keep`
- Почти все директории в `src/features/*` и `src/lib/*` плотно связаны с React-компонентами, DOM/WebView2, `localStorage`, HLS-плеером (`hls.js`) и графиками (`Recharts`), а системное ядро (`bridge.rs`, `poller.rs`, `cache.rs`, `backup.rs`, `kino.rs`, `tray.rs`, `secrets.rs`, `history.rs`, `offline.rs`) **уже работает на Rust в `src-tauri/src/`**.
- По правилу `$rust-anything`: **не переносить UI и мелкие функции ради самого Rust** — переносить только те чистые вычисления/парсеры, которые либо нужны **фону без окна** (`poller.rs` / уведомления / трей), либо доказанно горячие по профайлеру (`rust-anything profile`).

---

## 2. Что уже перенесено в ветке `migrant` (`26827e6`, 12 модулей)

В ворктри `C:\Users\World\orca\workspaces\SportsDesk\migrant` поверх `v2.0.0` (`1866b8c`) уже перенесены в `src-tauri/src/`:
`race_pace.rs`, `match_xg.rs`, `player_form.rs`, `knockout.rs`, `f1_comparison.rs`, `league_table.rs`, `viewing_conflicts.rs`, `livescore.rs`, `espn.rs`, `openf1.rs`, `live_source_choice.rs`, `live_day_matches.rs` (+4 516 строк Rust).

---

## 3. Прагматичный план переноса (только то, что реально имеет смысл — когда вернёмся к задаче)

Каждую волну переносим **по одному юниту за раз**, проверяя по правилам `$rust-anything`:
`record` (запись реальных входов и тестов в `cases.jsonl`) → `port.rs` (без `unsafe`, с `indexmap` где важен порядок ключей, с осторожностью к UTF-16 индексам и `fancy-regex` для JS-регексов) → `diff` (`N/N` совпадений) → `bench` (проверка, что не медленнее оригинала) → `gate` (`cargo fmt`, `clippy -D warnings`, тесты, ни одного `unwrap`/`panic!` на ошибках).

| Волна | Юнит / модуль | Зачем переносить в Rust (`src-tauri/src/`) | Главные риски по `rust-anything` |
| ---: | --- | --- | --- |
| **0** | Синхронизация `migrant` ↔ `sportsdesk/ui-refresh` | Влить экран «Главное» (2.1.0) и новый live-центр (`3b4afed`), чтобы не потерять 12 готовых модулей из `migrant` | Конфликты в `lib.rs` и `bridge.rs` |
| **1** | `club_names.rs` *(из `src/features/football/clubNames.ts`)* | Один общий нормализатор `clubKey` и таблица алиасов для фонового `poller.rs` и UI — точное 1-в-1 сопоставление `PitchAPI ↔ LiveScore ↔ ESPN` | UTF-16/Unicode-нормализация (`NFKC`), не-ASCII регексы (`(?i-u)` / `eq_ignore_ascii_case`) |
| **2** | `live_match_detail.rs` *(из `src/features/football/liveMatchDetail.ts`)* | Парсинг `scoreboard / incidents / statistics / lineups` (LiveScore) и `summary` (ESPN) в Rust — убирает дублирование с `poller.rs` и позволяет слать **точные фоновые уведомления о голах с автором и минутой** даже при свёрнутом окне | Динамический JSON (`serde_json::Value`), проверка всех веток ошибок без `unwrap()` |
| **3** | `search_index.rs` *(опционально, только после `rust-anything profile`)* | Батч-поиск (`--batch`) или SQLite FTS по офлайн-архиву, если база вырастет до 5–10+ сезонов и замер покажет тормоза в JS | Порядок ключей и ранжирование кириллицы/акцентов |

---

## 4. Что сознательно остаётся в TypeScript / React (`keep` навсегда)

Все 25 UI/app-юнитов из отчёта `rust-anything analyze`:
- `src/App.tsx`, `src/main.tsx`, `src/app/`, `src/components/`, `src/kit/` (125+ React-компонентов, дизайн-токены, светлая/тёмная темы).
- `src/features/watch/` (HLS-плеер `hls.js`), `src/features/tactics/` (тактическая доска), `src/features/atmosphere/`, `src/features/diary/`, `src/features/games/`, `src/features/onboarding/`, `src/features/settings/`, `src/features/my/`, `src/features/events/`, `src/features/spoilers/`.
- Экранные фильтры, сортировки, роутинг и форматирование дат (`src/lib/navigation.ts`, `src/lib/humanDate.ts`).

---

## 5. Полная таблица модулей от `rust-anything analyze` (снимок на 24.11.2026)

| Wave | Unit | Status | Lines | Readiness | Bridge | Main risks |
| ---: | --- | --- | ---: | ---: | --- | --- |
| 0 | `scripts/` | ready | 273 | 76 | napi-rs | String offsets (3); Async (4) |
| 0 | `src/features/events/` | keep | 459 | 70 | keep | Async (10); Callbacks (5) |
| 0 | `src/features/spoilers/` | keep | 283 | 68 | keep | String offsets (1); Ordered maps (4) |
| 0 | `src/features/onboarding/` | keep | 574 | 64 | keep | String offsets (1); Callbacks (7) |
| 0 | `src/features/planner/` | keep | 797 | 56 | keep | String offsets (9); Ordered maps (11) |
| 0 | `src/features/today/` | keep | 863 | 50 | keep | String offsets (5); Callbacks (24) |
| 0 | `src/features/tactics/` | keep | 1044 | 47 | keep | String offsets (6); Ordered maps (4) |
| 0 | `src/features/settings/categories/` | keep | 1091 | 44 | keep | Async (43); Dynamic typing (3) |
| 0 | `src/features/diary/` | keep | 1289 | 38 | keep | String offsets (3); Ordered maps (11) |
| 0 | `src/features/offline/` | keep | 1164 | 37 | keep | String offsets (5); Async (18) |
| 0 | `src/components/` | keep | 1122 | 29 | keep | String offsets (3); Regex (1) |
| 0 | `src/features/games/` | keep | 1465 | 26 | keep | String offsets (7); Callbacks (11) |
| 0 | `src/features/watch/` | keep | 1734 | 12 | keep | String offsets (4); Async (25) |
| 0 | `src/features/atmosphere/` | keep | 1914 | 0 | keep | String offsets (4); Callbacks (19) |
| 0 | `src/features/f1/` | keep | 6256 | 0 | keep | String offsets (23); Regex (4) |
| 0 | `src/features/football/` | keep | 12632 | 0 | keep | String offsets (58); Regex (1) |
| 0 | `src/features/home/` | keep | 2600 | 0 | keep | String offsets (17); Regex (2) |
| 0 | `src/features/settings/` | keep | 1446 | 0 | keep | String offsets (3); Regex (1) |
| 0 | `src/features/ucl/` | keep | 2293 | 0 | keep | String offsets (6); Async (34) |
| 0 | `src/kit/` | keep | 2353 | 0 | keep | String offsets (7); Callbacks (14) |
| 0 | `src/lib/` | keep | 2560 | 0 | keep | String offsets (22); Regex (3) |
| 1 | `src/features/my/` | keep | 329 | 89 | keep | Callbacks (7); Exceptions (1) |
| 1 | `dev/` | keep | 2706 | 0 | keep | String offsets (11); Async (49) |
| 2 | `src/app/` | keep | 1139 | 66 | keep | Callbacks (24); JSON round-trips (1) |
| 3 | `src/App.tsx` | keep | 249 | 84 | keep | String offsets (2); Async (5) |
| 4 | `src/main.tsx` | keep | 19 | 95 | keep | Exceptions (1) |
