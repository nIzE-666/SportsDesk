import { Bell, BellOff, CalendarPlus } from 'lucide-react';
import { Button } from '../../kit';
import type { HomeReminder } from './homePreferences';

export interface HomeActionsState {
  planned: readonly string[];
  reminders: readonly HomeReminder[];
  togglePlan: (id: string) => void;
  toggleReminder: (reminder: HomeReminder) => void;
  isReminderDeliverable: (reminder: HomeReminder) => boolean;
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
  const deliveryBlocked = reminded && !actions.isReminderDeliverable(reminder);
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
        aria-label={
          reminded
            ? deliveryBlocked
              ? `Отменить напоминание, ${title} (уведомления выключены)`
              : `Отменить напоминание, ${title}`
            : `Напомнить, ${title}`
        }
        title={deliveryBlocked ? 'Уведомления выключены в настройках' : undefined}
        icon={deliveryBlocked ? <BellOff size={14} aria-hidden /> : <Bell size={14} aria-hidden />}
        onClick={() => actions.toggleReminder(reminder)}
      >
        {reminded ? (deliveryBlocked ? 'Уведомления выключены' : 'Напомню') : 'Напомнить'}
      </Button>
    </>
  );
}
