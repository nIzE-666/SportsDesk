import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { api } from '../../lib/bridge';
import { useDataRecovery } from '../../lib/useDataRecovery';
import { retainResource } from '../../lib/resourceHealth';
import type { LeagueMatchesPayload, MatchSummary, TeamRef } from './types';
import { saveSeasonToHistory } from './history';
import { getJson, setString, STORAGE_KEYS } from './storage';

export const VERIFIED_LEAGUES: Array<{ id: string; name: string }> = [
  { id: 'l_4WFCIZ', name: 'Premier League' },
  { id: 'l_0ErfuF', name: 'LaLiga' },
  { id: 'l_0eg6C9', name: 'MLS' },
  { id: 'l_0ALvwF', name: 'Serie A' },
  { id: 'l_1Isor4', name: 'Bundesliga' },
  { id: 'l_3FJFUl', name: 'Ligue 1' },
];

export interface LeagueOption {
  id: string;
  name: string;
  season?: string;
  /** Actual seasons reported by the provider catalogue, newest first. */
  seasons?: string[];
}

export interface TeamCatalogueEntry extends TeamRef {
  leagueId: string;
  leagueName: string;
}

export interface LeagueDataSet {
  matches: MatchSummary[];
  loading: boolean;
  error: string | null;
  stale: boolean;
  fetchedAt: string | null;
}

export interface UseFootballResult {
  leagues: LeagueOption[];
  leaguesLoading: boolean;
  leaguesError: string | null;
  selectedLeagueId: string;
  setSelectedLeague: (id: string) => void;
  season: string | undefined;
  /** Matches of the currently selected league and season (for the Matches view). */
  matches: MatchSummary[];
  matchesLoading: boolean;
  matchesError: string | null;
  stale: boolean;
  fetchedAt: string | null;
  reload: () => void;
  /** Union of every loaded current-season favourite league dataset (dashboard). */
  allMatches: MatchSummary[];
  /** Teams from current-season favourite leagues plus the selected league/season. */
  teams: TeamCatalogueEntry[];
  /** Teams limited to the currently selected league dataset. */
  leagueTeams: TeamCatalogueEntry[];
  /**
   * Matches of one league: the user-chosen season when one exists for that league,
   * otherwise its current season.
   */
  matchesForLeague: (leagueId: string) => MatchSummary[];
  leagueName: (leagueId: string) => string;
  /** Actual catalogue seasons for a league; verified current season alone until catalogue loads. */
  seasonsForLeague: (leagueId: string) => string[];
  setSelectedSeason: (season: string) => void;
}

function unwrapLeagueMatches(payload: any): LeagueMatchesPayload | null {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.matches)) return null;
  return {
    league: data.league ?? { id: '', name: '' },
    matches: data.matches as MatchSummary[],
  };
}

function collectTeams(
  leagueId: string,
  leagueName: string,
  matches: MatchSummary[],
): TeamCatalogueEntry[] {
  const map = new Map<string, TeamCatalogueEntry>();
  for (const m of matches) {
    if (!m || !m.home_team || !m.away_team) continue;
    const home = m.home_team;
    const away = m.away_team;
    if (home.id && !map.has(home.id)) map.set(home.id, { ...home, leagueId, leagueName });
    if (away.id && !map.has(away.id)) map.set(away.id, { ...away, leagueId, leagueName });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const FIRST_LEAGUE = VERIFIED_LEAGUES[0];
const FALLBACK_LEAGUE_ID = FIRST_LEAGUE ? FIRST_LEAGUE.id : '';

const EMPTY_DATASET: LeagueDataSet = {
  matches: [],
  loading: false,
  error: null,
  stale: false,
  fetchedAt: null,
};

interface DatasetState extends LeagueDataSet {
  season?: string;
}

const DATASET_PREFIX = '::';
const datasetKey = (leagueId: string, season: string | undefined): string =>
  `${leagueId}${DATASET_PREFIX}${season ?? ''}`;

const SEASONS_KEY = 'sportsdesk.football.seasons';
const CATALOGUE_KEY = 'sportsdesk.football.seasonCatalogue';

type SeasonMap = Record<string, string[]>;

type SeasonSelection = Record<string, string>;

function isVerifiedLeague(id: string): boolean {
  return VERIFIED_LEAGUES.some((v) => v.id === id);
}

function readSeasonSelection(): SeasonSelection {
  try {
    const raw = localStorage.getItem(SEASONS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SeasonSelection = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && v && !k.startsWith('__')) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSeasonSelection(map: SeasonSelection): void {
  try {
    setString(SEASONS_KEY, JSON.stringify(map));
  } catch {
    // Storage may be unavailable; selection then lives only for this session.
  }
}

function readCatalogue(): SeasonMap {
  try {
    // Older versions shared this key with the team directory. Accept only a
    // season map during migration; new writes use a separate key.
    const raw =
      localStorage.getItem(CATALOGUE_KEY) ?? localStorage.getItem('sportsdesk.football.catalogue');
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SeasonMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== 'string' || !Array.isArray(v)) continue;
      const seasons = v.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (seasons.length > 0) out[k] = seasons;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCatalogue(map: SeasonMap): void {
  try {
    setString(CATALOGUE_KEY, JSON.stringify(map));
  } catch {
    // Non-secret cache; safe to skip.
  }
}

/** Sorts season strings descending without inventing any values. */
function sortSeasonsSeasons(seasons: string[]): string[] {
  return [...seasons].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function uniqueSeasons(seasons: unknown): string[] {
  if (!Array.isArray(seasons)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of seasons) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return sortSeasonsSeasons(out);
}

export function resolveCurrentSeason(
  option: LeagueOption | undefined,
  _leagueId?: string,
): string | undefined {
  if (option?.season) return option.season;
  const first = option?.seasons?.[0];
  if (first) return first;
  return undefined;
}

const NO_FAVORITES: readonly string[] = [];

export function useFootballData(
  initialLeagueId?: string,
  favoriteTeamIds: readonly string[] = NO_FAVORITES,
): UseFootballResult {
  const seasonsRef = useRef<SeasonSelection | null>(null);
  if (!seasonsRef.current) seasonsRef.current = readSeasonSelection();
  const cachedCatalogueRef = useRef<SeasonMap | null>(null);
  if (!cachedCatalogueRef.current) cachedCatalogueRef.current = readCatalogue();

  const [leagues, setLeagues] = useState<LeagueOption[]>(() => {
    const cached = new Map<string, string[]>(Object.entries(cachedCatalogueRef.current ?? {}));
    return VERIFIED_LEAGUES.map((l) => {
      const known = cached.get(l.id);
      const merged = uniqueSeasons(known ?? []);
      return {
        id: l.id,
        name: l.name,
        season: merged[0],
        seasons: merged.length ? merged : undefined,
      };
    });
  });
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueIdState] = useState<string>(
    initialLeagueId ?? FALLBACK_LEAGUE_ID,
  );
  const [selectedSeasons, setSelectedSeasons] = useState<SeasonSelection>(() => ({
    ...(seasonsRef.current ?? {}),
  }));
  const [datasets, setDatasets] = useState<Record<string, DatasetState>>({});
  const requestRef = useRef<Record<string, number>>({});

  const selectedOption = useMemo(
    () => leagues.find((l) => l.id === selectedLeagueId),
    [leagues, selectedLeagueId],
  );

  const optionLookup = useMemo(() => {
    const map = new Map<string, LeagueOption>(leagues.map((l) => [l.id, l]));
    return map;
  }, [leagues]);

  const seasonFor = useCallback(
    (leagueId: string, preferStored = true): string | undefined => {
      const opt = optionLookup.get(leagueId);
      const stored = preferStored ? selectedSeasons[leagueId] : undefined;
      if (stored) {
        const available = opt?.seasons ?? [];
        if (available.length === 0) {
          // Before a fresh catalogue, retain the user's explicitly chosen season.
          return stored;
        } else if (available.includes(stored)) {
          return stored;
        }
      }
      return resolveCurrentSeason(opt, leagueId);
    },
    [optionLookup, selectedSeasons],
  );

  const selectedSeason = useMemo(
    () => (selectedLeagueId ? seasonFor(selectedLeagueId) : undefined),
    [selectedLeagueId, seasonFor],
  );

  const selectedLeague = useMemo<LeagueOption>(
    () =>
      selectedOption ?? {
        id: selectedLeagueId,
        name: selectedLeagueId,
        season: selectedSeason,
      },
    [selectedOption, selectedLeagueId, selectedSeason],
  );

  const loadLeagues = useCallback(async () => {
    setLeaguesLoading(true);
    setLeaguesError(null);
    try {
      const reply = await api('pitch', 'leagues');
      const raw = reply.payload?.data ?? reply.payload;
      const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.leagues) ? raw.leagues : [];
      if (list.length === 0) throw new Error('Источник не вернул список лиг');
      const mapped: LeagueOption[] = [];
      for (const x of list) {
        if (!x || typeof x.id !== 'string') continue;
        const seasons = uniqueSeasons(x.seasons);
        let season: string | undefined;
        if (typeof x.current_season === 'string' && x.current_season) season = x.current_season;
        else if (typeof x.season === 'string' && x.season) season = x.season;
        else if (seasons[0]) season = seasons[0];
        mapped.push({
          id: String(x.id),
          name: typeof x.name === 'string' && x.name ? x.name : String(x.id),
          season,
          seasons: seasons.length > 0 ? seasons : undefined,
        });
      }
      const byId = new Map<string, LeagueOption>();
      for (const v of VERIFIED_LEAGUES) byId.set(v.id, { id: v.id, name: v.name });
      for (const l of mapped) {
        const known = byId.get(l.id);
        const knownSeasons = known?.seasons ?? (known?.season ? [known.season] : []);
        const providerSeasons = l.seasons ?? [];
        const mergedSeasons =
          providerSeasons.length > 0
            ? uniqueSeasons([...providerSeasons, ...knownSeasons])
            : uniqueSeasons(knownSeasons);
        byId.set(l.id, {
          id: l.id,
          name: l.name || known?.name || l.id,
          season: l.season ?? known?.season ?? mergedSeasons[0],
          seasons: mergedSeasons.length > 0 ? mergedSeasons : undefined,
        });
      }
      const nextLeagues = Array.from(byId.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'ru'),
      );
      setLeagues(nextLeagues);

      const catalogue: SeasonMap = {};
      for (const l of nextLeagues) {
        if (l.seasons && l.seasons.length > 0) catalogue[l.id] = l.seasons;
        else if (l.season) catalogue[l.id] = [l.season];
      }
      writeCatalogue(catalogue);

      // Re-validate persisted seasons against the fresh catalogue.
      setSelectedSeasons((prev) => {
        let changed = false;
        const next: SeasonSelection = { ...prev };
        for (const [leagueId, season] of Object.entries(prev)) {
          const opt = nextLeagues.find((l) => l.id === leagueId);
          const available = opt?.seasons ?? [];
          if (available.length > 0 && !available.includes(season)) {
            delete next[leagueId];
            changed = true;
          }
        }
        if (changed) {
          writeSeasonSelection(next);
          seasonsRef.current = next;
        }
        return changed ? next : prev;
      });
    } catch (e) {
      setLeaguesError(e instanceof Error ? e.message : 'Ошибка загрузки лиг');
    } finally {
      setLeaguesLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async (leagueId: string, season?: string) => {
    if (!leagueId) return;
    const key = datasetKey(leagueId, season);
    const reqId = (requestRef.current[key] ?? 0) + 1;
    requestRef.current[key] = reqId;
    setDatasets((prev) => {
      const prevDs = prev[key];
      return {
        ...prev,
        [key]: {
          matches: prevDs?.matches ?? [],
          loading: true,
          error: null,
          stale: prevDs?.stale ?? false,
          fetchedAt: prevDs?.fetchedAt ?? null,
          season,
        },
      };
    });
    const query = season ? `?season=${encodeURIComponent(season)}&status=all` : '?status=all';
    try {
      const reply = await api('pitch', `leagues/${leagueId}/matches${query}`);
      if (requestRef.current[key] !== reqId) return;
      const parsed = unwrapLeagueMatches(reply.payload);
      if (!parsed) throw new Error('Неожиданный формат ответа матчей');
      const matches = Array.isArray(parsed.matches)
        ? parsed.matches
            .filter((m) => m && m.home_team && m.away_team)
            .map((m) => {
              const state = classifyMatchStatus(m.status);
              return {
                ...m,
                status:
                  state === 'unknown' ? m.status : state === 'scheduled' ? 'not_started' : state,
              };
            })
        : [];
      setDatasets((prev) => ({
        ...prev,
        [key]: {
          matches,
          loading: false,
          error: null,
          stale: Boolean(reply.stale),
          fetchedAt: reply.fetchedAt ?? null,
          season,
        },
      }));
      // №5: persist every loaded season into the local SQLite history.
      if (!reply.stale) {
        void saveSeasonToHistory(leagueId, parsed.league?.name ?? leagueId, season ?? '', matches);
      }
    } catch (e) {
      if (requestRef.current[key] !== reqId) return;
      setDatasets((prev) => {
        const prevDs = prev[key];
        return {
          ...prev,
          [key]: {
            matches: prevDs?.matches ?? [],
            loading: false,
            error: e instanceof Error ? e.message : 'Ошибка загрузки матчей',
            stale: true,
            fetchedAt: prevDs?.fetchedAt ?? null,
            season,
          },
        };
      });
    }
  }, []);

  useEffect(() => {
    void loadLeagues();
  }, [loadLeagues]);

  useDataRecovery(
    (key) => key === 'pitch:leagues' || /^pitch:leagues\/[^/]+\/matches\?/.test(key),
    (key) => {
      if (key === 'pitch:leagues') {
        void loadLeagues();
        return;
      }
      const path = key.slice('pitch:'.length);
      const leagueId = path.split('/')[1];
      const season = new URLSearchParams(path.split('?')[1]).get('season') ?? undefined;
      if (leagueId) void loadMatches(leagueId, season);
    },
  );

  // A favourite can belong to a league outside the six preloaded leagues.
  // The persisted catalogue resolves such favourites again after app restart.
  const favoriteLeagueIds = useMemo(() => {
    const favoriteIds = new Set(favoriteTeamIds);
    const ids = new Set<string>();
    const catalogue = getJson<Array<{ id?: unknown; leagueId?: unknown }>>(
      STORAGE_KEYS.catalogue,
      [],
    );
    if (Array.isArray(catalogue)) {
      for (const team of catalogue) {
        if (
          typeof team?.id === 'string' &&
          favoriteIds.has(team.id) &&
          typeof team.leagueId === 'string' &&
          team.leagueId
        )
          ids.add(team.leagueId);
      }
    }
    for (const [key, dataset] of Object.entries(datasets)) {
      if (
        dataset.matches.some(
          (m) => favoriteIds.has(m.home_team.id) || favoriteIds.has(m.away_team.id),
        )
      ) {
        const leagueId = key.split(DATASET_PREFIX)[0];
        if (leagueId) ids.add(leagueId);
      }
    }
    return [...ids];
  }, [datasets, favoriteTeamIds]);

  // Source catalogue defines the current season. With no catalogue, omit
  // season and let the API choose its current one; never invent a year.
  const currentDatasets = useMemo(
    () =>
      [...new Set([...VERIFIED_LEAGUES.map((l) => l.id), ...favoriteLeagueIds])].map((id) => ({
        id,
        season:
          resolveCurrentSeason(optionLookup.get(id), id) ??
          uniqueSeasons(cachedCatalogueRef.current?.[id])[0],
      })),
    [optionLookup, favoriteLeagueIds],
  );
  useEffect(() => {
    for (const l of currentDatasets) {
      const key = datasetKey(l.id, l.season);
      if (!requestRef.current[key]) void loadMatches(l.id, l.season);
    }
  }, [currentDatasets, loadMatches]);
  const resourcePaths = JSON.stringify([
    ...new Set([
      'leagues',
      ...currentDatasets.map(
        (l) =>
          'leagues/' +
          l.id +
          '/matches' +
          (l.season ? '?season=' + encodeURIComponent(l.season) + '&status=all' : '?status=all'),
      ),
      'leagues/' +
        selectedLeagueId +
        '/matches' +
        (selectedSeason
          ? '?season=' + encodeURIComponent(selectedSeason) + '&status=all'
          : '?status=all'),
    ]),
  ]);
  useEffect(() => {
    const release = (JSON.parse(resourcePaths) as string[]).map((path) =>
      retainResource('pitch', path),
    );
    return () => release.forEach((stop) => stop());
  }, [resourcePaths]);

  // Ensure the currently selected league/season dataset exists (no re-fetch loop on error).
  const selectedKey = selectedLeagueId ? datasetKey(selectedLeagueId, selectedSeason) : '';
  const selectedDs = selectedKey ? datasets[selectedKey] : undefined;
  useEffect(() => {
    if (!selectedLeagueId) return;
    if (selectedDs) return;
    const inflight = requestRef.current[selectedKey] ?? 0;
    if (inflight > 0) return;
    const stored = seasonFor(selectedLeagueId);
    void loadMatches(selectedLeagueId, stored);
  }, [selectedLeagueId, selectedKey, selectedDs, seasonFor, loadMatches]);

  const reload = useCallback(() => {
    if (!selectedLeagueId) return;
    void loadMatches(selectedLeagueId, selectedSeason);
  }, [loadMatches, selectedLeagueId, selectedSeason]);

  const setSelectedSeason = useCallback(
    (season: string) => {
      if (!selectedLeagueId) return;
      const target = season.trim();
      if (!target) return;
      const opt = optionLookup.get(selectedLeagueId);
      const available = opt?.seasons ?? [];
      if (available.length > 0 && !available.includes(target)) return;
      if (available.length === 0 && target !== opt?.season) return;
      setSelectedSeasons((prev) => {
        const next: SeasonSelection = { ...prev, [selectedLeagueId]: target };
        writeSeasonSelection(next);
        seasonsRef.current = next;
        return next;
      });
      const current = resolveCurrentSeason(opt, selectedLeagueId);
      if (target === current) {
        // Stored value equals the current season; keep persistence but dataset is the same key.
      }
    },
    [optionLookup, selectedLeagueId],
  );

  // Data for the dashboard: only current-season favourite league datasets.
  const allMatches = useMemo(() => {
    const seen = new Set<string>();
    const result: MatchSummary[] = [];
    for (const l of currentDatasets) {
      const ds = datasets[datasetKey(l.id, l.season)];
      if (!ds) continue;
      for (const m of ds.matches) {
        if (!m || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        result.push(m);
      }
    }
    return result;
  }, [datasets, currentDatasets]);

  const teams = useMemo(() => {
    const map = new Map<string, TeamCatalogueEntry>();
    for (const l of currentDatasets) {
      const ds = datasets[datasetKey(l.id, l.season)];
      if (!ds) continue;
      const name = optionLookup.get(l.id)?.name ?? l.id;
      for (const t of collectTeams(l.id, name, ds.matches)) {
        if (!map.has(t.id)) map.set(t.id, t);
      }
    }
    if (selectedDs && selectedLeagueId) {
      const name = optionLookup.get(selectedLeagueId)?.name ?? selectedLeagueId;
      for (const t of collectTeams(selectedLeagueId, name, selectedDs.matches)) {
        if (!map.has(t.id)) map.set(t.id, t);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [datasets, currentDatasets, optionLookup, selectedDs, selectedLeagueId]);

  const leagueTeams = useMemo(() => {
    if (!selectedDs || !selectedLeagueId) return [];
    const leagueNameResolved = optionLookup.get(selectedLeagueId)?.name ?? selectedLeagueId;
    return collectTeams(selectedLeagueId, leagueNameResolved, selectedDs.matches);
  }, [selectedDs, optionLookup, selectedLeagueId]);

  const matchesForLeague = useCallback(
    (leagueId: string) => {
      const preferred = seasonFor(leagueId);
      const ds = datasets[datasetKey(leagueId, preferred)];
      if (ds) return ds.matches;
      // Fall back to current verified season dataset if the stored one is pending/absent.
      const current = resolveCurrentSeason(optionLookup.get(leagueId), leagueId);
      if (current !== preferred) {
        const fallback = datasets[datasetKey(leagueId, current)];
        if (fallback) return fallback.matches;
      }
      return [];
    },
    [datasets, seasonFor, optionLookup],
  );

  const leagueName = useCallback(
    (leagueId: string) => optionLookup.get(leagueId)?.name ?? leagueId,
    [optionLookup],
  );

  const seasonsForLeague = useCallback(
    (leagueId: string) => {
      const opt = optionLookup.get(leagueId);
      if (opt?.seasons && opt.seasons.length > 0) return opt.seasons;
      return opt?.season ? [opt.season] : [];
    },
    [optionLookup],
  );

  const matchesLoading = selectedLeagueId ? (selectedDs?.loading ?? !selectedDs) : false;

  return {
    leagues,
    leaguesLoading,
    leaguesError,
    selectedLeagueId,
    setSelectedLeague: setSelectedLeagueIdState,
    season: selectedDs?.season ?? selectedSeason ?? selectedLeague.season,
    matches: selectedDs?.matches ?? EMPTY_DATASET.matches,
    matchesLoading,
    matchesError: selectedDs?.error ?? null,
    stale: selectedDs?.stale ?? false,
    fetchedAt: selectedDs?.fetchedAt ?? null,
    reload,
    allMatches,
    teams,
    leagueTeams,
    matchesForLeague,
    leagueName,
    seasonsForLeague,
    setSelectedSeason,
  };
}

export type { LeagueMatchesPayload };
