import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { EmptyState, Button, Panel } from '../../kit';
import { formatHumanDate } from '../../lib/humanDate';
import type { MyTab, SettingsCategory } from '../../lib/navigation';
import { viewState } from '../../lib/viewState';
import { DiaryView } from '../diary/DiaryView';
import { getUserTimezone } from '../football/storage';
import { useFavorites } from '../football/FavoritesProvider';
import { getFavoritesSnapshot } from '../football/favoritesStore';
import type { FavoritePlayer } from '../football/types';
import { useFavoriteDrivers, useFavoriteTeams } from '../f1/useFavorites';
import { GamesView } from '../games/GamesView';
import { deleteScheme, useTactics } from '../tactics/tacticsStore';
import type { TacticScheme } from '../tactics/tacticsModel';
import { resolveMyTab } from './myTabs';
import './my.css';

/**
 * «Моё»: избранное, дневник, игры и схемы под одной крышей.
 *
 * Модули прячут вкладки, но ничего не удаляют: записи и схемы остаются в
 * профиле. Полосу вкладок показывает шапка страницы.
 */
export interface MyViewProps {
  tab: MyTab;
  onTabChange: (tab: MyTab) => void;
  onOpenMatch: (matchId: string, leagueId?: string) => void;
  onOpenClub: (teamId: string, leagueId?: string) => void;
  onOpenPlayer: (player: FavoritePlayer) => void;
  onOpenF1: () => void;
  onOpenSettings: (category: SettingsCategory) => void;
  onOpenWeekend: (season: string | number, round: string | number) => void;
}

const F1_TEAM_NAMES: Record<string, string> = {
  red_bull: 'Red Bull',
  mercedes: 'Mercedes',
  ferrari: 'Ferrari',
  mclaren: 'McLaren',
  aston_martin: 'Aston Martin',
  alpine: 'Alpine',
  williams: 'Williams',
  rb: 'Racing Bulls',
  sauber: 'Sauber',
  audi: 'Audi',
  haas: 'Haas',
  cadillac: 'Cadillac',
};

const F1_DRIVER_NAMES: Record<string, string> = {
  max_verstappen: 'Макс Ферстаппен',
  hamilton: 'Льюис Хэмилтон',
  leclerc: 'Шарль Леклер',
  norris: 'Ландо Норрис',
  piastri: 'Оскар Пиастри',
  russell: 'Джордж Расселл',
  antonelli: 'Андреа Кими Антонелли',
  alonso: 'Фернандо Алонсо',
  sainz: 'Карлос Сайнс',
  albon: 'Александр Албон',
  gasly: 'Пьер Гасли',
  hulkenberg: 'Нико Хюлькенберг',
};

const f1TeamName = (id: string) => F1_TEAM_NAMES[id] ?? 'Команда';
const f1DriverName = (id: string) => F1_DRIVER_NAMES[id] ?? 'Пилот';

function schemePlace(scheme: TacticScheme): string {
  if (scheme.binding.kind === 'match')
    return `Матч · ${scheme.source.home.name} — ${scheme.source.away.name}`;
  const team =
    scheme.binding.id === scheme.source.home.id ? scheme.source.home.name : scheme.source.away.name;
  return `Команда · ${team}`;
}

function FavoritesTab({
  onOpenClub,
  onOpenPlayer,
  onOpenF1,
  onOpenSettings,
}: Pick<MyViewProps, 'onOpenClub' | 'onOpenPlayer' | 'onOpenF1' | 'onOpenSettings'>) {
  const { teamIds, favoritePlayers } = useFavorites();
  const { catalogue } = getFavoritesSnapshot();
  const [favoriteTeams] = useFavoriteTeams();
  const [favoriteDrivers] = useFavoriteDrivers();
  const clubs = teamIds.flatMap((id) => {
    const entry = catalogue.find((team) => team.id === id);
    return entry ? [entry] : [];
  });
  const empty =
    clubs.length === 0 &&
    favoritePlayers.length === 0 &&
    favoriteTeams.length === 0 &&
    favoriteDrivers.length === 0;
  const edit = () => onOpenSettings('favorites');
  return (
    <section className="my-tab-panel" aria-label="Избранное">
      <header className="my-tab-head">
        <h2>
          <Star size={16} aria-hidden="true" /> Избранное
        </h2>
        <Button small variant="quiet" type="button" onClick={edit}>
          Изменить
        </Button>
      </header>
      {empty ? (
        <EmptyState
          className="my-empty"
          icon={<Star size={20} aria-hidden="true" />}
          message="Здесь появятся клубы, игроки и команды Формулы 1, которые вы отметите."
        />
      ) : (
        <>
          {clubs.length > 0 && (
            <section className="my-group" aria-label="Избранные клубы">
              <h3>Клубы</h3>
              <div className="my-tile-grid">
                {clubs.map((club) => (
                  <Button
                    key={club.id}
                    variant="quiet"
                    className="my-tile"
                    type="button"
                    onClick={() => onOpenClub(club.id, club.leagueId)}
                  >
                    <strong>{club.name}</strong>
                    {club.leagueName && <span className="muted small">{club.leagueName}</span>}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {favoritePlayers.length > 0 && (
            <section className="my-group" aria-label="Избранные игроки">
              <h3>Игроки</h3>
              <div className="my-row-list">
                {favoritePlayers.map((player) => (
                  <Button
                    key={player.id}
                    variant="quiet"
                    className="my-row"
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                  >
                    <strong>{player.name}</strong>
                    <span className="muted small">{player.teamName ?? '—'}</span>
                  </Button>
                ))}
              </div>
            </section>
          )}
          {(favoriteTeams.length > 0 || favoriteDrivers.length > 0) && (
            <section className="my-group" aria-label="Избранное в Формуле 1">
              <h3>Формула 1</h3>
              <div className="my-favorite-row">
                {favoriteTeams.map((id) => (
                  <Button
                    key={id}
                    small
                    variant="quiet"
                    className="my-favorite"
                    type="button"
                    onClick={onOpenF1}
                  >
                    {f1TeamName(id)}
                  </Button>
                ))}
                {favoriteDrivers.map((id) => (
                  <Button
                    key={id}
                    small
                    variant="quiet"
                    className="my-favorite"
                    type="button"
                    onClick={onOpenF1}
                  >
                    {f1DriverName(id)}
                  </Button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function SchemesTab({ onOpenMatch }: Pick<MyViewProps, 'onOpenMatch'>) {
  const saved = useTactics();
  const timezone = getUserTimezone();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const schemes = saved.store.schemes;
  const remove = (id: string) => {
    setError('');
    try {
      deleteScheme(id);
      setDeleting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Схему не удалось удалить.');
    }
  };
  const open = (scheme: TacticScheme) => {
    viewState.write(`match.${scheme.source.matchId}.tab`, 'tactics');
    viewState.write(`tactics.${scheme.source.matchId}.draft`, scheme);
    onOpenMatch(scheme.source.matchId);
  };
  return (
    <section className="my-tab-panel" aria-label="Схемы">
      <header className="my-tab-head">
        <h2>Схемы</h2>
      </header>
      {saved.error && (
        <p className="my-notice" role="alert">
          {saved.error}
        </p>
      )}
      {error && (
        <p className="my-notice" role="alert">
          {error}
        </p>
      )}
      {schemes.length === 0 ? (
        <EmptyState message="Сохранённых схем пока нет." />
      ) : (
        <ul className="my-scheme-list">
          {schemes.map((scheme) => (
            <li className="my-scheme" key={scheme.id}>
              <Panel>
                <div className="my-scheme-main">
                  <strong>{scheme.title}</strong>
                  <span className="muted small">
                    {schemePlace(scheme)} · {formatHumanDate(scheme.updatedAt, timezone)}
                  </span>
                </div>
                <div className="my-actions">
                  <Button small type="button" onClick={() => open(scheme)}>
                    Открыть
                  </Button>
                  {saved.writable && (
                    <Button
                      small
                      variant="quiet"
                      type="button"
                      onClick={() => setDeleting(scheme.id)}
                    >
                      Удалить
                    </Button>
                  )}
                </div>
                {deleting === scheme.id && (
                  <div className="my-notice" role="alert">
                    <p>Удалить схему «{scheme.title}»?</p>
                    <div className="my-actions">
                      <Button small danger type="button" onClick={() => remove(scheme.id)}>
                        Подтвердить удаление
                      </Button>
                      <Button small variant="quiet" type="button" onClick={() => setDeleting(null)}>
                        Оставить
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyView({
  tab,
  onTabChange,
  onOpenMatch,
  onOpenClub,
  onOpenPlayer,
  onOpenF1,
  onOpenSettings,
  onOpenWeekend,
}: MyViewProps) {
  const active = resolveMyTab(tab);

  useEffect(() => {
    if (active !== tab) onTabChange(active);
  }, [active, tab, onTabChange]);

  return (
    <section className="my-view" aria-label="Моё">
      {active === 'favorites' && (
        <FavoritesTab
          onOpenClub={onOpenClub}
          onOpenPlayer={onOpenPlayer}
          onOpenF1={onOpenF1}
          onOpenSettings={onOpenSettings}
        />
      )}
      {active === 'diary' && (
        <DiaryView
          onOpen={(reference) =>
            reference.kind === 'football'
              ? onOpenMatch(reference.matchId, reference.leagueId ?? undefined)
              : onOpenWeekend(reference.season, reference.round)
          }
        />
      )}
      {active === 'games' && <GamesView onOpenMatch={onOpenMatch} />}
      {active === 'schemes' && <SchemesTab onOpenMatch={onOpenMatch} />}
    </section>
  );
}
