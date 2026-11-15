import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { notify } from '../../../lib/bridge';
import { Badge, Button, Panel, Switch } from '../../../kit';
import { getString, setString } from '../../football/storage';
import { readNotificationsEnabled, writeNotificationsEnabled } from '../../football/usePoller';
import { NotificationPreferences } from '../NotificationPreferences';

type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported' | 'native';

async function requestPermissionSafe(): Promise<PermissionState> {
  // Packaged Tauri (Windows WebView) may not expose the browser Notification
  // API at all. Native notification delivery works through the command bridge,
  // so treat native runtime as acceptable without using browser permission.
  if (isTauri()) return 'native';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const res = await Notification.requestPermission();
    return res;
  } catch {
    return 'denied';
  }
}

export function NotificationsSettings() {
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    readNotificationsEnabled(),
  );
  const [f1Reminders, setF1Reminders] = useState(
    () => getString('sportsdesk.notifications.f1') !== '0',
  );
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      writeNotificationsEnabled(false);
      setNotificationMessage('Уведомления выключены.');
      return;
    }
    const perm = await requestPermissionSafe();
    if (perm === 'granted' || perm === 'native') {
      setNotificationsEnabled(true);
      writeNotificationsEnabled(true);
      setNotificationMessage('Уведомления включены. Они работают и при свёрнутом окне.');
      try {
        await notify('SportsDesk', 'Уведомления включены.');
      } catch {
        setNotificationMessage(
          'Уведомления включены в приложении, но тестовое сообщение не доставлено системой.',
        );
      }
    } else if (perm === 'denied') {
      setNotificationsEnabled(false);
      writeNotificationsEnabled(false);
      setNotificationMessage(
        'Разрешение на уведомления отклонено в системе. Включите его в настройках ОС.',
      );
    } else if (perm === 'unsupported') {
      setNotificationMessage('Системные уведомления недоступны в этом окружении.');
    } else {
      setNotificationMessage('Разрешение на уведомления не получено.');
    }
  };

  return (
    <Panel aria-label="Уведомления">
      <div className="settings-status">
        <Switch
          label="Уведомления"
          checked={notificationsEnabled}
          onChange={() => void toggleNotifications()}
        />
        <Badge>
          {notificationsEnabled ? (
            <Bell size={14} aria-hidden />
          ) : (
            <BellOff size={14} aria-hidden />
          )}
          {notificationsEnabled ? 'Включены' : 'Выключены'}
        </Badge>
      </div>
      <Switch
        label="Напоминать о сессиях Формулы-1"
        checked={f1Reminders}
        disabled={!notificationsEnabled}
        onChange={(enabled) => {
          setF1Reminders(enabled);
          setString('sportsdesk.notifications.f1', enabled ? '1' : '0');
          window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
        }}
      />
      <NotificationPreferences disabled={!notificationsEnabled} />
      <div className="settings-actions">
        <Button
          disabled={!notificationsEnabled}
          onClick={async () => {
            try {
              await notify('SportsDesk', 'Проверка локальных уведомлений.');
              setNotificationMessage('Тестовое уведомление отправлено.');
            } catch (e) {
              setNotificationMessage(
                e instanceof Error ? e.message : 'Системные уведомления недоступны.',
              );
            }
          }}
        >
          Проверить уведомление
        </Button>
      </div>
      {notificationMessage && <p className="settings-note">{notificationMessage}</p>}
    </Panel>
  );
}
