import { lazy, Suspense, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { EmptyBlock, LoadingBlock } from '../../components/StateViews';
import { useModules } from '../../lib/modules';
import './games.css';

// Каждая игра грузится только когда её открыли: обычный запуск приложения её не тянет.
const StartLights = lazy(() =>
  import('./StartLightsGame').then((module) => ({ default: module.StartLights })),
);
const PredictionsGame = lazy(() =>
  import('./PredictionsGame').then((module) => ({ default: module.PredictionsGame })),
);

export const GAMES = [
  {
    id: 'start-lights',
    title: 'Стартовые огни',
    blurb: 'Пять огней гаснут в случайный момент. Нажмите сразу после этого.',
  },
  {
    id: 'predictions',
    title: 'Угадай счёт',
    blurb: 'Прогноз на счёт основного времени до начала матча.',
  },
] as const;
export type GameId = (typeof GAMES)[number]['id'];

const GAME_MODULE: Record<GameId, 'games' | 'predictions'> = {
  'start-lights': 'games',
  predictions: 'predictions',
};

/** Раздел «Игры»: открывается только действием пользователя; игры включаются модулями. */
export function GamesView({
  onOpenMatch,
}: {
  onOpenMatch?: (matchId: string, leagueId?: string) => void;
}) {
  const modules = useModules();
  const [game, setGame] = useState<GameId>(GAMES[0].id);
  const available = GAMES.filter((item) => modules[GAME_MODULE[item.id]]);
  if (!available.length) {
    return (
      <EmptyBlock title="Игры выключены" message="Включить их можно в «Настройки → Модули»." />
    );
  }
  const current = available.find((item) => item.id === game) ?? available[0]!;
  return (
    <section className="panel games-view" aria-label="Игры">
      <div className="section-title">
        <h2>
          <Gamepad2 size={15} /> Игры
        </h2>
      </div>
      <div className="games-tabs" role="tablist" aria-label="Выбор игры">
        {available.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === current.id}
            className={`ghost-btn${item.id === current.id ? ' active' : ''}`}
            onClick={() => setGame(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <p className="muted small">{current.blurb}</p>
      <Suspense fallback={<LoadingBlock label="Открываем игру…" rows={2} />}>
        {current.id === 'start-lights' && <StartLights />}
        {current.id === 'predictions' && <PredictionsGame onOpenMatch={onOpenMatch} />}
      </Suspense>
    </section>
  );
}
