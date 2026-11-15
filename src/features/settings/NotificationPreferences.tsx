import { useState } from 'react';
import { resolveFavoriteTeams } from '../football/usePoller';
import { useFavorites } from '../football/FavoritesProvider';
import { Disclosure, Field, SegmentedControl, Switch } from '../../kit';
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

const REMINDER_MINUTES = [5, 10, 15, 30, 60, 120];

interface NotificationPreferencesProps {
  /** The master switch is off: keep the saved values but show them inactive. */
  disabled?: boolean;
}

export function NotificationPreferences({ disabled = false }: NotificationPreferencesProps) {
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
      <section className="settings-group" aria-labelledby="notification-events">
        <h3 id="notification-events" className="ui-panel__title">
          События
        </h3>
        <div className="settings-switches">
          {(Object.keys(labels) as (keyof EventTypes)[]).map((key) => (
            <Switch
              key={key}
              label={labels[key]}
              disabled={disabled}
              checked={policy.events[key]}
              onChange={(checked) =>
                update({ ...policy, events: { ...policy.events, [key]: checked } })
              }
            />
          ))}
        </div>
      </section>
      <Field label="Напоминать за" hint="Для футбола и сессий Формулы-1">
        <SegmentedControl
          ariaLabel="Напоминать за"
          value={String(policy.reminderMinutes)}
          onChange={(value) => update({ ...policy, reminderMinutes: Number(value) })}
          items={REMINDER_MINUTES.map((minutes) => ({
            id: String(minutes),
            label: `${minutes} мин.`,
            disabled,
          }))}
        />
      </Field>
      <section className="settings-group" aria-labelledby="notification-quiet">
        <h3 id="notification-quiet" className="ui-panel__title">
          Тихие часы · {getUserTimezone()}
        </h3>
        <Switch
          label="Приостановить уведомления в выбранные часы"
          disabled={disabled}
          checked={policy.quietEnabled}
          onChange={(checked) => update({ ...policy, quietEnabled: checked })}
        />
        <div className="settings-pair">
          <Field label="С" htmlFor="quiet-start">
            <input
              id="quiet-start"
              type="time"
              value={policy.quietStart}
              disabled={disabled}
              onChange={(e) => update({ ...policy, quietStart: e.target.value })}
            />
          </Field>
          <Field label="До" htmlFor="quiet-end">
            <input
              id="quiet-end"
              type="time"
              value={policy.quietEnd}
              disabled={disabled}
              onChange={(e) => update({ ...policy, quietEnd: e.target.value })}
            />
          </Field>
        </div>
      </section>
      <Disclosure label="Настройки по клубам" hint={`· ${teams.length}`}>
        <div className="notification-teams">
          {teams.map((team) => {
            const teamPolicy = policy.teams[team.id] ?? { enabled: true, ...EVENTS };
            return (
              <section className="settings-team" key={team.id} aria-labelledby={`team-${team.id}`}>
                <h4 id={`team-${team.id}`} className="settings-team-title">
                  {team.name}
                </h4>
                <Switch
                  label="Уведомления команды"
                  disabled={disabled}
                  checked={teamPolicy.enabled}
                  onChange={(enabled) =>
                    update({
                      ...policy,
                      teams: {
                        ...policy.teams,
                        [team.id]: { ...teamPolicy, enabled },
                      },
                    })
                  }
                />
                <div className="settings-switches">
                  {(Object.keys(labels) as (keyof EventTypes)[]).map((key) => (
                    <Switch
                      key={key}
                      label={labels[key]}
                      disabled={disabled || !teamPolicy.enabled}
                      checked={teamPolicy[key]}
                      onChange={(checked) =>
                        update({
                          ...policy,
                          teams: {
                            ...policy.teams,
                            [team.id]: { ...teamPolicy, [key]: checked },
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}
