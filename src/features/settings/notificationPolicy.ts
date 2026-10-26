import { getJson, getUserTimezone, setJson } from '../football/storage';
export interface EventTypes {
  goals: boolean;
  start: boolean;
  end: boolean;
  reminder: boolean;
}
export interface TeamPolicy extends EventTypes {
  enabled: boolean;
}
export interface NotificationPolicy {
  events: EventTypes;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  reminderMinutes: number;
  teams: Record<string, TeamPolicy>;
}
export const EVENTS: EventTypes = { goals: true, start: true, end: true, reminder: true };
export const POLICY_KEY = 'sportsdesk.notifications.policy';
export function readPolicy(): NotificationPolicy {
  const raw = getJson<Partial<NotificationPolicy>>(POLICY_KEY, {});
  return {
    events: { ...EVENTS, ...raw.events },
    quietEnabled: raw.quietEnabled === true,
    quietStart: /^\d{2}:\d{2}$/.test(raw.quietStart ?? '') ? raw.quietStart! : '23:00',
    quietEnd: /^\d{2}:\d{2}$/.test(raw.quietEnd ?? '') ? raw.quietEnd! : '08:00',
    reminderMinutes: Math.max(1, Math.min(120, Number(raw.reminderMinutes) || 15)),
    teams: raw.teams ?? {},
  };
}
export function writePolicy(value: NotificationPolicy) {
  setJson(POLICY_KEY, value);
}
export { getUserTimezone };
