import { lazy, Suspense, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { EmptyBlock, LoadingBlock } from '../../components/StateViews';
import { useAtmosphere } from '../atmosphere/atmosphereStore';
import './games.css';

// Каждая игра грузится только когда её открыли: обычный запуск приложения её не тянет.
const StartLights = lazy(() =>
  import('./StartLightsGame').then((module) => ({ default: module.StartLights })),
);

export const GAMES = [
  {
    id: 'start-lights',
    title: 'Стартовые огни',
    blurb: 'Пять огней гаснут в случайный момент. Нажмите сразу после этого.',
  },
] as const;
export type GameId = (typeof GAMES)[number]['id'];

/** Раздел «Игры»: открывается только действием пользователя и выключается общим переключателем. */
export function GamesView() {
  const settings = useAtmosphere();
  const [game, setGame] = useState<GameId>(GAMES[0].id);
  if (!settings.enabled) {
    return (
      <EmptyBlock
        title="Игры выключены"
        message="Включить их можно в «Настройки → Игры и атмосфера»."
      />
    );
  }
  const current = GAMES.find((item) => item.id === game) ?? GAMES[0];
  return (
    <section className="panel games-view" aria-label="Игры">
      <div className="section-title">
        <h2>
          <Gamepad2 size={15} /> Игры
        </h2>
      </div>
      <div className="games-tabs" role="tablist" aria-label="Выбор игры">
        {GAMES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === game}
            className={`ghost-btn${item.id === game ? ' active' : ''}`}
            onClick={() => setGame(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <p className="muted small">{current.blurb}</p>
      <Suspense fallback={<LoadingBlock label="Открываем игру…" rows={2} />}>
        {game === 'start-lights' && <StartLights />}
      </Suspense>
    </section>
  );
}
