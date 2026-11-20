import { Bell, CalendarPlus } from 'lucide-react';
import { Button } from '../../kit';
import type { HomeReminder } from './homePreferences';

export interface HomeActionsState {
  planned: readonly string[];
  reminders: readonly HomeReminder[];
  togglePlan: (id: string) => void;
  toggleReminder: (reminder: HomeReminder) => void;
}

export function HomeActions({
  title,
  plannerId,
  reminder,
  actions,
  quiet = false,
}: {
  title: string;
  plannerId: string;
  reminder: HomeReminder;
  actions: HomeActionsState;
  quiet?: boolean;
}) {
  const planned = actions.planned.includes(plannerId);
  const reminded = actions.reminders.some((item) => item.key === reminder.key);
  return (
    <>
      <Button
        small
        variant={quiet ? 'quiet' : 'primary'}
        aria-pressed={planned}
        aria-label={`${planned ? 'Убрать из плана' : 'Буду смотреть'}, ${title}`}
        icon={<CalendarPlus size={14} aria-hidden />}
        onClick={() => actions.togglePlan(plannerId)}
      >
        {planned ? 'В плане' : 'Буду смотреть'}
      </Button>
      <Button
        small
        variant={quiet ? 'quiet' : 'default'}
        aria-pressed={reminded}
        aria-label={`${reminded ? 'Отменить напоминание' : 'Напомнить'}, ${title}`}
        icon={<Bell size={14} aria-hidden />}
        onClick={() => actions.toggleReminder(reminder)}
      >
        {reminded ? 'Напомню' : 'Напомнить'}
      </Button>
    </>
  );
}
