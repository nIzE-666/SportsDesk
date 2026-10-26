import { CalendarClock, ChevronRight, Clock3, Flag, Zap } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useViewState } from '../../lib/useViewState';
import { useNow } from '../../lib/useNow';
import {
  calendarMonth,
  calendarPhase,
  orderedCalendar,
  racePresentation,
  raceStart,
} from './calendarModel';
import { RaceWeekend } from './RaceWeekend';
import { formatDateTime, getTimeZone } from './time';
import { weekendSchedule } from './weekendSchedule';
import type { JolpicaRace } from './types';
import './calendar.css';

type Filter = 'upcoming' | 'past' | 'all';
export function CalendarBoard({ races, year }: { races: JolpicaRace[]; year: number }) {
  const now = useNow(),
    timezone = getTimeZone();
  const ordered = useMemo(() => orderedCalendar(races), [races]);
  const next = ordered.find((r) => calendarPhase(r, now) === 'upcoming') ?? null;
  const [filter, setFilter] = useViewState<Filter>(
    `f1.${year}.calendar.filter`,
    year < new Date(now).getUTCFullYear() ? 'past' : 'upcoming',
    (v) => ['upcoming', 'past', 'all'].includes(String(v)),
  );
  const [selected, setSelected] = useViewState<number | null>(
    `f1.${year}.calendar.round`,
    null,
    (v) => v === null || (typeof v === 'number' && v > 0),
  );
  const visible = ordered.filter((r) => filter === 'all' || calendarPhase(r, now) === filter);
  const selectedRace =
    visible.find((r) => Number(r.round) === selected) ??
    (filter === 'past' ? visible.at(-1) : visible[0]) ??
    null;
  const list = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const container = list.current,
      button = activeButton.current;
    if (!container || !button) return;
    const a = button.getBoundingClientRect(),
      b = container.getBoundingClientRect();
    if (a.top < b.top || a.bottom > b.bottom) container.scrollTop += a.top - b.top - 12;
  }, [selectedRace?.round, filter, year]);
  const upcoming = next
    ? weekendSchedule(next)
        .filter((s) => s.start && s.start.getTime() >= now)
        .slice(0, 3)
    : [];
  const jumpToNext = () => {
    if (next) {
      setFilter('upcoming');
      setSelected(Number(next.round));
    }
  };
  return (
    <div className="calendar-board">
      {next && (
        <section className="calendar-next" aria-label="Ближайший Гран-при">
          <div className="calendar-next-title">
            <span className="calendar-country" title={next.Circuit.Location?.country}>
              {racePresentation(next).flag}
            </span>
            <div>
              <span className="eyebrow">БЛИЖАЙШИЙ ГРАН-ПРИ · ЭТАП {next.round}</span>
              <h2>{racePresentation(next).title}</h2>
              <p>{next.Circuit.circuitName}</p>
            </div>
          </div>
          <div className="calendar-next-sessions">
            {upcoming.map((s) => (
              <div key={s.id}>
                <span>{s.label}</span>
                <strong>{formatDateTime(s.start, timezone)}</strong>
              </div>
            ))}
            {!upcoming.length && <p>Расписание уточняется · {next.date}</p>}
          </div>
          <button className="primary-btn" onClick={jumpToNext}>
            Открыть уикенд <ChevronRight size={16} />
          </button>
        </section>
      )}
      <div className="calendar-heading">
        <div>
          <h1>
            <CalendarClock size={23} /> Календарь сезона {year}
          </h1>
          <p>Выберите этап — расписание и результаты откроются рядом. Время: {timezone}.</p>
        </div>
        <span className="chip">{ordered.length} этапов</span>
      </div>
      <div className="calendar-filters" role="group" aria-label="Фильтр этапов">
        {(
          [
            ['upcoming', 'Предстоящие'],
            ['past', 'Прошедшие'],
            ['all', 'Все этапы'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? 'ghost-btn active' : 'ghost-btn'}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
            <span>
              {id === 'all'
                ? ordered.length
                : ordered.filter((r) => calendarPhase(r, now) === id).length}
            </span>
          </button>
        ))}
      </div>
      <div className="calendar-layout">
        <section className="panel calendar-stage-panel" aria-label="Этапы сезона">
          <div className="calendar-stage-list" ref={list}>
            {!visible.length && (
              <div className="calendar-no-stages">
                <Flag size={25} />
                <h3>Этапов по этому фильтру нет</h3>
                <button className="ghost-btn" onClick={() => setFilter('all')}>
                  Показать весь сезон
                </button>
              </div>
            )}
            {visible.map((race, i) => {
              const presentation = racePresentation(race),
                month = calendarMonth(race, timezone);
              const chosen = selectedRace?.round === race.round;
              return (
                <div key={race.round}>
                  {(i === 0 || calendarMonth(visible[i - 1]!, timezone) !== month) && (
                    <h3 className="calendar-month">{month}</h3>
                  )}
                  <button
                    ref={chosen ? activeButton : undefined}
                    className={`calendar-stage ${chosen ? 'selected' : ''}`}
                    aria-pressed={chosen}
                    aria-label={`Открыть ${presentation.title}, этап ${race.round}`}
                    onClick={() => setSelected(Number(race.round))}
                  >
                    <span className="calendar-stage-number">{race.round}</span>
                    <span className="calendar-stage-info">
                      <span className="calendar-stage-name">
                        <span>{presentation.flag}</span>
                        <strong>{presentation.title}</strong>
                      </span>
                      <span className="calendar-stage-track">{race.Circuit.circuitName}</span>
                      <span className="calendar-stage-date">
                        <Clock3 size={12} />
                        {raceStart(race)
                          ? formatDateTime(raceStart(race), timezone)
                          : `${race.date} · время уточняется`}
                      </span>
                      <span className="calendar-stage-tags">
                        {next?.round === race.round && (
                          <small className="next-tag">Ближайший</small>
                        )}
                        {race.Sprint && (
                          <small>
                            <Zap size={11} /> Спринт
                          </small>
                        )}
                        <small>
                          {calendarPhase(race, now) === 'past' ? 'Прошедший этап' : 'По расписанию'}
                        </small>
                      </span>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <div className="calendar-detail" aria-live="polite">
          {selectedRace ? (
            <>
              <div className="calendar-detail-heading">
                <span className="eyebrow">ВЫБРАННЫЙ ЭТАП · {selectedRace.round}</span>
                <h2>
                  {racePresentation(selectedRace).flag} {racePresentation(selectedRace).title}
                </h2>
              </div>
              <RaceWeekend key={`${year}.${selectedRace.round}`} race={selectedRace} />
            </>
          ) : (
            <section className="panel calendar-empty-detail">
              <CalendarClock size={32} />
              <h2>Выберите этап</h2>
              <p>Откройте весь сезон или измените фильтр, чтобы посмотреть уикенд.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
