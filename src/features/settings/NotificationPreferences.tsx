import { useState } from 'react';
import { resolveFavoriteTeams } from '../football/usePoller';
import { useFavorites } from '../football/FavoritesProvider';
import {
  EVENTS,
  getUserTimezone,
  readPolicy,
  writePolicy,
  type EventTypes,
  type NotificationPolicy,
} from './notificationPolicy';
const labels: Record<keyof EventTypes, string> = {
  goals: 'Голы и изменения счёта',
  start: 'Начало матча',
  end: 'Итог матча',
  reminder: 'Напоминания',
};
export function NotificationPreferences() {
  const [policy, setPolicy] = useState(readPolicy);
  // Подписка на общее избранное: список команд обновляется сразу после правки.
  useFavorites();
  const teams = resolveFavoriteTeams();
  const update = (p: NotificationPolicy) => {
    setPolicy(p);
    writePolicy(p);
  };
  return (
    <div className="notification-preferences">
      <fieldset>
        <legend>События</legend>
        <div className="settings-checks">
          {(Object.keys(labels) as (keyof EventTypes)[]).map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={policy.events[k]}
                onChange={(e) =>
                  update({ ...policy, events: { ...policy.events, [k]: e.target.checked } })
                }
              />
              {labels[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="settings-row">
        <label htmlFor="reminder-lead">Напоминать за</label>
        <select
          id="reminder-lead"
          value={policy.reminderMinutes}
          onChange={(e) => update({ ...policy, reminderMinutes: Number(e.target.value) })}
        >
          {[5, 10, 15, 30, 60, 120].map((n) => (
            <option key={n} value={n}>
              {n} мин.
            </option>
          ))}
        </select>
        <span className="muted small">Для футбола и сессий F1</span>
      </div>
      <fieldset>
        <legend>Тихие часы · {getUserTimezone()}</legend>
        <label>
          <input
            type="checkbox"
            checked={policy.quietEnabled}
            onChange={(e) => update({ ...policy, quietEnabled: e.target.checked })}
          />
          Приостановить уведомления в выбранные часы
        </label>
        <div className="settings-row">
          <label>
            С{' '}
            <input
              aria-label="Начало тихих часов"
              type="time"
              value={policy.quietStart}
              onChange={(e) => update({ ...policy, quietStart: e.target.value })}
            />
          </label>
          <label>
            До{' '}
            <input
              aria-label="Конец тихих часов"
              type="time"
              value={policy.quietEnd}
              onChange={(e) => update({ ...policy, quietEnd: e.target.value })}
            />
          </label>
        </div>
      </fieldset>
      <details>
        <summary>Настройки по клубам · {teams.length}</summary>
        <div className="notification-teams">
          {teams.map((t) => {
            const p = policy.teams[t.id] ?? { enabled: true, ...EVENTS };
            return (
              <fieldset key={t.id}>
                <legend>{t.name}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) =>
                      update({
                        ...policy,
                        teams: { ...policy.teams, [t.id]: { ...p, enabled: e.target.checked } },
                      })
                    }
                  />
                  Уведомления команды
                </label>
                <div className="settings-checks">
                  {(Object.keys(labels) as (keyof EventTypes)[]).map((k) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        disabled={!p.enabled}
                        checked={p[k]}
                        onChange={(e) =>
                          update({
                            ...policy,
                            teams: { ...policy.teams, [t.id]: { ...p, [k]: e.target.checked } },
                          })
                        }
                      />
                      {labels[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </details>
    </div>
  );
}
