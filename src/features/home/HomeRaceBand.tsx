import { Button, Countdown, ShowcaseBand } from '../../kit';
import { grandPrixTitle } from '../f1/calendarModel';
import { f1SpoilerId, useResultHidden } from '../spoilers/spoilerStore';
import { raceHighlights, type useHomeF1 } from './homeF1';
import type { OpenWeekend } from './HomeTrack';

export function HomeRaceBand({
  data,
  onOpenWeekend,
}: {
  data: ReturnType<typeof useHomeF1>;
  onOpenWeekend: OpenWeekend;
}) {
  const { latest, next } = data;
  const hidden = useResultHidden('f1', latest ? f1SpoilerId(latest.season, latest.round) : null);
  const highlights = latest && !hidden ? raceHighlights(latest.Results) : null;
  const nextRace = next?.race ?? latest;
  const items = [
    ...(latest
      ? [
          {
            label: 'Последняя гонка',
            value: grandPrixTitle(latest.raceName).title,
            sub: hidden
              ? 'Результат скрыт'
              : highlights?.winner
                ? `Победитель — ${highlights.winner}`
                : undefined,
          },
        ]
      : []),
    ...(highlights?.gained
      ? [
          {
            label: 'Больше всего отыграл',
            value: `${highlights.gained.driver} · +${highlights.gained.count}`,
          },
        ]
      : []),
    ...(highlights?.retirements != null
      ? [
          {
            label: 'Сходы',
            value: highlights.retirements,
            sub: highlights.closeFinish
              ? 'Отрыв победителя меньше 2 секунд'
              : highlights.winnerOutsideFrontRow
                ? 'Победитель стартовал со второго ряда или дальше'
                : undefined,
          },
        ]
      : []),
    ...(next
      ? [
          {
            label: 'Следующая сессия',
            value: next.label,
            sub: <Countdown target={next.iso} endedLabel="Время начала наступило" />,
          },
        ]
      : []),
  ];
  return (
    <ShowcaseBand
      title="Формула 1"
      items={
        items.length
          ? items
          : [{ label: 'Расписание', value: data.loading ? 'Загружаем…' : 'Нет данных' }]
      }
      action={
        nextRace ? (
          <Button small onClick={() => onOpenWeekend(nextRace.season, nextRace.round)}>
            Открыть уикенд
          </Button>
        ) : undefined
      }
    />
  );
}
