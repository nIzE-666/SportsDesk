import { useCallback, useEffect, useRef, useState } from 'react';
import { api, rpc } from '../../lib/bridge';
import { pluralRu } from '../../lib/plural';
import { matchStateLabel } from '../../lib/sportsIdentity';
import { formatHumanDate, formatHumanDateTime } from '../../lib/humanDate';
import { getJson, getUserTimezone } from '../football/storage';
import { VERIFIED_LEAGUES } from '../football/useFootballData';
import { fetchHistorySeasons, type HistorySeasonInfo } from '../football/history';
import { HiddenScore } from '../spoilers/SpoilerGate';
import {
  enqueueSeason,
  pauseOfflineQueue,
  removeOfflineJob,
  useOfflineQueue,
  type JobState,
} from './offlineQueue';
import {
  isObject,
  readerFilterUseful,
  seasonKey,
  validOfflineSeason,
  type OfflineSeason,
  type OfflineSummary,
} from './offlineModel';
import './offline.css';

const stateLabel: Record<JobState, string> = {
  queued: 'В очереди',
  downloading: 'Получение матчей…',
  saving: 'Сохранение…',
  done: 'Сохранено',
  error: 'Ошибка загрузки',
};
const coverageLabel = {
  complete: 'Полный календарь',
  partial: 'Частичный календарь',
  unverified: 'Полнота не проверена',
};
const matchesCount = (count: number) => `${count} ${pluralRu(count, 'матч', 'матча', 'матчей')}`;
const savedTime = (iso: string, timezone: string) => formatHumanDateTime(iso, timezone);
const bytes = (value: number) =>
  value < 1024
    ? `${value} Б`
    : value < 1024 * 1024
      ? `${(value / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`
      : `${(value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
function cachedCatalogue(): Record<string, string[]> {
  const v = getJson<unknown>('sportsdesk.football.seasonCatalogue', {});
  return isObject(v)
    ? Object.fromEntries(
        Object.entries(v).filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) &&
            entry[1].every((x) => typeof x === 'string' && x.length <= 30),
        ),
      )
    : {};
}
export function OfflineView() {
  const queue = useOfflineQueue();
  const [catalogue, setCatalogue] = useState(cachedCatalogue);
  const [leagueId, setLeagueId] = useState(VERIFIED_LEAGUES[0]!.id);
  const [season, setSeason] = useState(() => cachedCatalogue()[VERIFIED_LEAGUES[0]!.id]?.[0] ?? '');
  const [packages, setPackages] = useState<OfflineSummary[]>([]),
    [history, setHistory] = useState<HistorySeasonInfo[]>([]);
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [libraryError, setLibraryError] = useState(''),
    [message, setMessage] = useState('');
  const [selected, setSelected] = useState<OfflineSummary | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const libraryRequest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++libraryRequest.current;
    setLoading(true);
    try {
      const [saved, legacy] = await Promise.all([
        rpc<OfflineSummary[]>('offline_list'),
        fetchHistorySeasons(),
      ]);
      if (!Array.isArray(saved) || !Array.isArray(legacy))
        throw new Error('Некорректный список офлайн-сезонов.');
      if (request !== libraryRequest.current) return;
      setPackages(saved);
      setHistory(legacy);
      setLibraryError('');
    } catch (e) {
      if (request === libraryRequest.current)
        setLibraryError(e instanceof Error ? e.message : 'Не удалось прочитать офлайн-сезоны.');
    } finally {
      if (request === libraryRequest.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const changed = () => {
      void reload();
    };
    window.addEventListener('sportsdesk-offline-changed', changed);
    return () => {
      libraryRequest.current++;
      window.removeEventListener('sportsdesk-offline-changed', changed);
    };
  }, [reload]);
  const attempt = async (action: () => void | Promise<void>) => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не удалось.');
    } finally {
      setBusy(false);
    }
  };
  const refreshCatalogue = async () => {
    setRefreshing(true);
    await attempt(async () => {
      const reply = await api('pitch', 'leagues');
      if (reply.stale)
        throw new Error('Список сезонов устарел. Доступны ранее сохранённые сезоны.');
      const data = reply.payload?.data ?? reply.payload;
      if (!Array.isArray(data?.leagues)) throw new Error('Не удалось прочитать каталог сезонов.');
      const next: Record<string, string[]> = {};
      for (const l of data.leagues)
        if (isObject(l) && typeof l.id === 'string' && Array.isArray(l.seasons))
          next[l.id] = l.seasons.filter(
            (s: unknown): s is string => typeof s === 'string' && s.length <= 30,
          );
      setCatalogue(next);
      if (!next[leagueId]?.includes(season)) setSeason(next[leagueId]?.[0] ?? '');
      setMessage('Каталог сезонов обновлён.');
    });
    setRefreshing(false);
  };
  const options = [
    ...new Set([
      ...(catalogue[leagueId] ?? []),
      ...history.filter((p) => p.leagueId === leagueId).map((p) => p.season),
      ...queue.queue.jobs.filter((p) => p.leagueId === leagueId).map((p) => p.season),
    ]),
  ]
    .sort()
    .reverse();
  const legacy = history.filter(
    (h) => !packages.some((p) => p.leagueId === h.leagueId && p.season === h.season),
  );
  const pending = queue.queue.jobs.filter((j) =>
    ['queued', 'downloading', 'saving'].includes(j.state),
  );
  const timezone = getUserTimezone();
  const selectedPackage = selected
    ? packages.find((p) => p.leagueId === selected.leagueId && p.season === selected.season)
    : null;
  return (
    <div className="offline-view">
      <header>
        <p className="eyebrow">ЛОКАЛЬНАЯ БИБЛИОТЕКА</p>
        <h1>Офлайн-сезоны</h1>
        <p className="muted">Сезоны для просмотра без сети.</p>
      </header>
      {(error || queue.error) && (
        <div className="state-card error" role="alert">
          {error || queue.error}
        </div>
      )}
      {message && (
        <p className="offline-notice" role="status">
          {message}
        </p>
      )}
      <section className="panel" aria-label="Загрузить сезон">
        <div className="offline-heading">
          <h2>Добавить сезон</h2>
          <button
            className="ghost-btn"
            disabled={refreshing || busy}
            onClick={() => void refreshCatalogue()}
          >
            {refreshing ? 'Обновление…' : 'Обновить каталог'}
          </button>
        </div>
        <form
          className="offline-select"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(() =>
              enqueueSeason(
                leagueId,
                VERIFIED_LEAGUES.find((l) => l.id === leagueId)!.name,
                season,
              ),
            );
          }}
        >
          <label>
            Лига
            <select
              value={leagueId}
              onChange={(e) => {
                const id = e.target.value;
                setLeagueId(id);
                setSeason(
                  catalogue[id]?.[0] ?? history.find((h) => h.leagueId === id)?.season ?? '',
                );
              }}
            >
              {VERIFIED_LEAGUES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Сезон
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">Выберите сезон</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-btn" disabled={!season || busy || !queue.writable}>
            Загрузить и закрепить
          </button>
        </form>
        {!options.length && (
          <p className="muted">
            Нужен каталог источника. Подключитесь к сети и нажмите «Обновить каталог».
          </p>
        )}
        <p className="muted small">
          Сохраняются матчи сезона без подробной статистики и изображений.
        </p>
      </section>
      {queue.queue.jobs.length > 0 && (
        <section className="panel" aria-label="Очередь загрузки">
          <div className="offline-heading">
            <div>
              <h2>Очередь загрузки</h2>
              {pending.length > 0 && (
                <p className="muted">
                  {queue.queue.paused ? 'На паузе' : 'Выполняется по одному сезону'} · ожидают:{' '}
                  {pending.length}
                </p>
              )}
            </div>
            {(pending.length > 0 || queue.queue.paused || !!queue.error) && (
              <button
                className="ghost-btn"
                disabled={!queue.writable || busy || (!pending.length && !queue.error)}
                onClick={() => void attempt(() => pauseOfflineQueue(!queue.queue.paused))}
              >
                {queue.queue.paused ? 'Продолжить' : 'Пауза'}
              </button>
            )}
          </div>
          {pending.length > 0 && (
            <p className="muted small">
              После перезапуска нажмите «Продолжить». При паузе текущее сохранение завершится.
            </p>
          )}
          <ul className="offline-list">
            {queue.queue.jobs.map((j) => (
              <li key={seasonKey(j.leagueId, j.season)}>
                <div>
                  <strong>
                    {j.leagueName} · {j.season}
                  </strong>
                  <p className={j.state === 'error' ? 'offline-error' : 'muted'}>
                    {stateLabel[j.state]}
                    {queue.queue.paused && j.state === 'queued' ? ' · на паузе' : ''}
                  </p>
                  {j.error && <p className="offline-error">{j.error}</p>}
                </div>
                <div className="offline-actions">
                  {j.state === 'error' && (
                    <button
                      className="ghost-btn"
                      disabled={busy || !queue.writable}
                      onClick={() =>
                        void attempt(() => enqueueSeason(j.leagueId, j.leagueName, j.season, j.pin))
                      }
                    >
                      Повторить
                    </button>
                  )}
                  <button
                    className="ghost-btn"
                    disabled={
                      busy || !queue.writable || ['downloading', 'saving'].includes(j.state)
                    }
                    onClick={() => void attempt(() => removeOfflineJob(j))}
                  >
                    Убрать из очереди
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Сохранённые пакеты">
        <div className="offline-heading">
          <div>
            <h2>Сохранено на устройстве</h2>
            {packages.length > 0 && (
              <p className="muted">
                {packages.length} из 60 пакетов · {bytes(packages.reduce((n, p) => n + p.bytes, 0))}{' '}
                данных
              </p>
            )}
          </div>
          {(packages.length > 0 || !!libraryError) && (
            <button className="ghost-btn" disabled={loading} onClick={() => void reload()}>
              Перечитать библиотеку
            </button>
          )}
        </div>
        {libraryError && (
          <div role="alert" className="state-card error">
            {libraryError}
          </div>
        )}
        {loading && !packages.length ? (
          <p role="status">Чтение локальной библиотеки…</p>
        ) : !packages.length && !libraryError ? (
          <div className="panel offline-empty">
            <h3>Пока нет офлайн-пакетов</h3>
            <p className="muted">
              Загрузите сезон, пока есть сеть. Его календарь и результаты останутся на этом
              устройстве.
            </p>
          </div>
        ) : null}
        <div className="offline-packages">
          {packages.map((p) => {
            const key = seasonKey(p.leagueId, p.season),
              locked = busy || pending.some((j) => seasonKey(j.leagueId, j.season) === key);
            return (
              <article className="panel offline-package" key={key}>
                <div className="offline-heading">
                  <h3>
                    {p.leagueName} · {p.season}
                  </h3>
                  <span className="offline-pin">{p.pinned ? 'Закреплён' : 'Не закреплён'}</span>
                </div>
                <p className={`offline-coverage ${p.coverage.state}`}>
                  {coverageLabel[p.coverage.state]} ·{' '}
                  {p.coverage.expected !== null
                    ? `${p.matches} из ${p.coverage.expected} матчей`
                    : matchesCount(p.matches)}
                </p>
                <p className="muted">
                  {p.coverage.state === 'complete'
                    ? 'Проверены число команд и все пары дома / в гостях.'
                    : p.coverage.state === 'partial'
                      ? 'Есть пропуски, лишние пары или матчи без даты.'
                      : 'Сохранены все доступные данные источника; формат сезона не проверен.'}
                </p>
                <dl className="offline-facts">
                  <div>
                    <dt>Обновлён</dt>
                    <dd>{savedTime(p.fetchedAt, timezone)}</dd>
                  </div>
                  <div>
                    <dt>Размер данных</dt>
                    <dd>{bytes(p.bytes)}</dd>
                  </div>
                  {p.coverage.finished > 0 && (
                    <div>
                      <dt>Завершено по снимку</dt>
                      <dd>
                        {p.coverage.finished}
                        {p.coverage.missingScores > 0
                          ? ` · без счёта: ${p.coverage.missingScores}`
                          : ''}
                      </dd>
                    </div>
                  )}
                  {p.coverage.missingTimes > 0 && (
                    <div>
                      <dt>Время уточняется</dt>
                      <dd>{matchesCount(p.coverage.missingTimes)}</dd>
                    </div>
                  )}
                </dl>
                {p.duplicates > 0 && (
                  <p className="muted small">
                    Повторных одинаковых записей источника: {p.duplicates}. В пакете они объединены.
                  </p>
                )}
                <div className="offline-actions">
                  <button className="primary-btn" onClick={() => setSelected({ ...p })}>
                    Открыть без сети
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={locked || !queue.writable}
                    onClick={() =>
                      void attempt(() =>
                        enqueueSeason(p.leagueId, p.leagueName, p.season, p.pinned),
                      )
                    }
                  >
                    Обновить пакет
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={locked}
                    onClick={() =>
                      void attempt(async () => {
                        await rpc('offline_pin', {
                          leagueId: p.leagueId,
                          season: p.season,
                          pinned: !p.pinned,
                        });
                        await reload();
                      })
                    }
                  >
                    {p.pinned ? 'Открепить' : 'Закрепить'}
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={locked || p.pinned}
                    onClick={() => setDeleting(key)}
                  >
                    Удалить пакет
                  </button>
                </div>
                {deleting === key && (
                  <div
                    className="offline-confirm"
                    role="group"
                    aria-label="Подтвердить удаление пакета"
                  >
                    <p>
                      Удалить офлайн-календарь {p.season}? Автоматическая история результатов и
                      дневник сохранятся.
                    </p>
                    <div className="offline-actions">
                      <button
                        className="ghost-btn"
                        disabled={locked}
                        onClick={() =>
                          void attempt(async () => {
                            await rpc('offline_remove', { leagueId: p.leagueId, season: p.season });
                            setDeleting(null);
                            if (selected?.leagueId === p.leagueId && selected.season === p.season)
                              setSelected(null);
                            await reload();
                          })
                        }
                      >
                        Подтвердить удаление
                      </button>
                      <button className="ghost-btn" onClick={() => setDeleting(null)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {selectedPackage && (
        <OfflineReader
          key={
            seasonKey(selectedPackage.leagueId, selectedPackage.season) + selectedPackage.fetchedAt
          }
          summary={selectedPackage}
          onClose={() => setSelected(null)}
        />
      )}
      {legacy.length > 0 && (
        <section className="panel" aria-label="Автоматическая история">
          <h2>Ранее сохранённая история</h2>
          <p className="muted">
            Эти записи доступны для анализа, но их полнота и точное время начала не проверены.
          </p>
          <ul className="offline-list">
            {legacy.map((h) => (
              <li key={seasonKey(h.leagueId, h.season)}>
                <span>
                  {h.leagueName} · {h.season} · {matchesCount(h.matches)}
                </span>
                <button
                  className="ghost-btn"
                  disabled={busy || !queue.writable}
                  onClick={() =>
                    void attempt(() => enqueueSeason(h.leagueId, h.leagueName, h.season))
                  }
                >
                  Загрузить пакет
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <details className="panel">
        <summary>Как хранятся данные</summary>
        <p>
          Пакеты сохраняются до удаления. Чтобы удалить закреплённый пакет, сначала снимите
          закрепление.
        </p>
        <p>
          Пакеты входят в полную резервную копию, но не в экспорт профиля. Можно сохранить до 60
          пакетов, по 2000 матчей и 2 МБ каждый. Прежний пакет заменяется только после успешной
          загрузки и проверки.
        </p>
        <p>
          «Полный календарь» означает наличие всех пар команд по проверенному формату лиги. Даты
          будущих матчей могут измениться; результаты появятся после обновления пакета.
        </p>
      </details>
    </div>
  );
}

function OfflineReader({ summary, onClose }: { summary: OfflineSummary; onClose: () => void }) {
  const [data, setData] = useState<OfflineSeason | null>(null),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    void rpc<unknown>('offline_get', { leagueId: summary.leagueId, season: summary.season })
      .then((v) => {
        if (active) {
          if (
            !validOfflineSeason(v) ||
            v.leagueId !== summary.leagueId ||
            v.season !== summary.season
          )
            throw new Error('Пакет удалён, повреждён или создан новой версией приложения.');
          setData(v);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось прочитать пакет.');
      });
    return () => {
      active = false;
    };
  }, [summary.leagueId, summary.season]);
  const matches = (data?.matches ?? [])
    .filter(
      (m) =>
        (filter === 'all' ||
          (filter === 'finished' ? m.status === 'finished' : m.status !== 'finished')) &&
        `${m.homeName} ${m.awayName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.timeUtc ?? a.date).localeCompare(b.timeUtc ?? b.date) || a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(matches.length / 25)),
    activePage = Math.min(page, pages),
    timezone = getUserTimezone();
  const showSearch = (data?.matches.length ?? 0) > 1 || query !== '',
    showFilter = readerFilterUseful(data?.matches ?? []) || filter !== 'all';
  const resetReader = () => {
    setQuery('');
    setFilter('all');
    setPage(1);
  };
  return (
    <section className="panel offline-reader" aria-label="Офлайн-календарь">
      <div className="offline-heading">
        <div>
          <p className="eyebrow">СНИМОК НА УСТРОЙСТВЕ</p>
          <h2>
            {summary.leagueName} · {summary.season}
          </h2>
        </div>
        <button className="ghost-btn" onClick={onClose}>
          Закрыть календарь
        </button>
      </div>
      <p className="muted">
        Данные на {formatHumanDate(summary.fetchedAt, timezone)}. Часовой пояс: {timezone}. У встреч
        без времени показана календарная дата источника.
      </p>
      {error ? (
        <p role="alert" className="offline-error">
          {error}
        </p>
      ) : !data ? (
        <p role="status">Чтение пакета…</p>
      ) : (
        <>
          {(showSearch || showFilter) && (
            <div className="offline-select">
              {showSearch && (
                <label>
                  Поиск команды
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              )}
              {showFilter && (
                <label>
                  Матчи
                  <select
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Все матчи</option>
                    <option value="finished">Завершённые</option>
                    <option value="remaining">Остальные</option>
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="offline-table">
            <table>
              <caption className="sr-only">Календарь сохранённого сезона</caption>
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Матч</th>
                  <th>Счёт</th>
                  <th>Статус по снимку</th>
                </tr>
              </thead>
              <tbody>
                {matches.slice((activePage - 1) * 25, activePage * 25).map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.timeUtc
                        ? savedTime(m.timeUtc, timezone)
                        : m.date
                          ? `${formatHumanDate(m.date, timezone)} · время уточняется`
                          : 'Дата уточняется'}
                    </td>
                    <td>
                      {m.homeName} — {m.awayName}
                    </td>
                    <td>
                      <HiddenScore kind="football" id={m.id}>
                        {m.homeScore ?? '—'} : {m.awayScore ?? '—'}
                      </HiddenScore>
                    </td>
                    <td>
                      {matchStateLabel(m.status)}
                      {m.status === 'live' ? ' на момент загрузки' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!matches.length && (
            <div className="offline-empty">
              <p className="muted">Матчи по этим условиям не найдены.</p>
              {(query !== '' || filter !== 'all') && (
                <button className="ghost-btn" onClick={resetReader}>
                  Сбросить поиск и фильтр
                </button>
              )}
            </div>
          )}
          {matches.length > 0 && (
            <div className="offline-heading">
              <span className="muted">
                {matchesCount(matches.length)}
                {pages > 1 ? ` · страница ${activePage} из ${pages}` : ''}
              </span>
              {pages > 1 && (
                <div className="offline-actions">
                  <button
                    className="ghost-btn"
                    disabled={activePage <= 1}
                    onClick={() => setPage(activePage - 1)}
                  >
                    Предыдущие
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={activePage >= pages}
                    onClick={() => setPage(activePage + 1)}
                  >
                    Следующие
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
