import { useMemo, useState } from 'react';
import { Star, Trash2, Plus, RotateCcw } from 'lucide-react';
import { useFavorites } from '../football/FavoritesProvider';
import {
  addFavoriteTeam,
  dismissDefaultTeam,
  dismissedDefaultTeams,
  getFavoritesSnapshot,
  removeFavoriteTeam,
  restoreDefaultTeam,
} from '../football/favoritesStore';
import { normalizeName } from '../football/storage';
import { teamMatchesFavorite } from '../../lib/sportsIdentity';
import './favoritesEditor.css';

interface Props {
  /** Компактный режим для мастера первого запуска: без раздела игроков. */
  compact?: boolean;
}

const MAX_RESULTS = 30;

/**
 * Редактор избранного поверх сохранённого каталога клубов. Клуб определяется
 * id источника, лига показывается рядом, чтобы молодёжные и женские составы
 * с похожими названиями не путались. Официальные данные источника не меняются.
 */
export function FavoriteClubsEditor({ compact = false }: Props) {
  const { teamIds, favoriteTeamNames, favoritePlayers, togglePlayer } = useFavorites();
  const { catalogue, stored } = getFavoritesSnapshot();
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(catalogue.map((t) => [t.id, t])), [catalogue]);
  const tracked = teamIds.map((id) => ({ id, entry: byId.get(id) ?? null }));
  const resolvedNames = tracked.flatMap((t) => (t.entry ? [t.entry.name] : []));
  // Клубы по умолчанию, которые ещё не сопоставлены с каталогом источника.
  const pendingDefaults = favoriteTeamNames.filter(
    (name) => !teamMatchesFavorite(name, resolvedNames),
  );
  const dismissed = dismissedDefaultTeams(stored);

  const results = useMemo(() => {
    const q = normalizeName(query.trim());
    if (!q) return [];
    return catalogue
      .filter((t) => !teamIds.includes(t.id))
      .filter(
        (t) => normalizeName(t.name).includes(q) || normalizeName(t.leagueName ?? '').includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .slice(0, MAX_RESULTS);
  }, [catalogue, query, teamIds]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof results>();
    for (const t of results) {
      const league = t.leagueName || 'Без лиги';
      map.set(league, [...(map.get(league) ?? []), t]);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <div className="fav-editor">
      <h3 className="fav-editor-title">
        <Star size={14} /> Отслеживаемые клубы · {tracked.length + pendingDefaults.length}
      </h3>
      {tracked.length + pendingDefaults.length === 0 ? (
        <p className="muted small">Пока ничего не выбрано — найдите клуб ниже.</p>
      ) : (
        <ul className="fav-editor-list" aria-label="Избранные клубы">
          {tracked.map(({ id, entry }) => (
            <li key={id}>
              <span className="fav-editor-name">{entry?.name ?? id}</span>
              {entry?.leagueName && <span className="chip">{entry.leagueName}</span>}
              <button
                className="ghost-btn"
                aria-label={`Убрать ${entry?.name ?? id}`}
                onClick={() => removeFavoriteTeam(id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {pendingDefaults.map((name) => (
            <li key={`default:${name}`}>
              <span className="fav-editor-name">{name}</span>
              <span className="chip muted">появится после загрузки лиги</span>
              <button
                className="ghost-btn"
                aria-label={`Убрать ${name}`}
                onClick={() => dismissDefaultTeam(name)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="fav-editor-search">
        <span className="muted small">Добавить клуб</span>
        <input
          type="search"
          value={query}
          placeholder="Название клуба или лиги"
          aria-label="Поиск клуба"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {catalogue.length === 0 && (
        <p className="muted small">
          Каталог клубов пополняется, когда вы открываете лиги в разделе «Футбол».
        </p>
      )}
      {query.trim() !== '' && results.length === 0 && catalogue.length > 0 && (
        <p className="muted small">
          Ничего не найдено. Откройте нужную лигу, чтобы клуб попал в каталог.
        </p>
      )}
      {grouped.map(([league, teams]) => (
        <div key={league} className="fav-editor-group">
          <div className="muted small">{league}</div>
          <ul className="fav-editor-list">
            {teams.map((t) => (
              <li key={t.id}>
                <span className="fav-editor-name">{t.name}</span>
                <button
                  className="ghost-btn"
                  aria-label={`Добавить ${t.name}`}
                  onClick={() => {
                    addFavoriteTeam(t.id);
                    setQuery('');
                  }}
                >
                  <Plus size={13} /> Добавить
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {dismissed.length > 0 && (
        <details className="fav-editor-group">
          <summary className="muted small">
            Убранные клубы по умолчанию · {dismissed.length}
          </summary>
          <ul className="fav-editor-list">
            {dismissed.map((name) => (
              <li key={name}>
                <span className="fav-editor-name">{name}</span>
                <button
                  className="ghost-btn"
                  aria-label={`Вернуть ${name}`}
                  onClick={() => restoreDefaultTeam(name)}
                >
                  <RotateCcw size={13} /> Вернуть
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!compact && (
        <>
          <h3 className="fav-editor-title">
            <Star size={14} /> Избранные игроки · {favoritePlayers.length}
          </h3>
          {favoritePlayers.length === 0 ? (
            <p className="muted small">Отмечайте игроков звёздочкой в составах и профилях.</p>
          ) : (
            <ul className="fav-editor-list" aria-label="Избранные игроки">
              {favoritePlayers.map((p) => (
                <li key={p.id}>
                  <span className="fav-editor-name">{p.name ?? p.id}</span>
                  <button
                    className="ghost-btn"
                    aria-label={`Убрать ${p.name ?? p.id}`}
                    onClick={() => togglePlayer(p)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Изменения сразу применяются к матчам, планировщику и фоновым уведомлениям. Настройки
            уведомлений по каждому клубу — в разделе «Уведомления».
          </p>
        </>
      )}
    </div>
  );
}
