import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { notify } from '../../../lib/bridge';
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
    <>
      <section className="panel settings-section">
        <div className="settings-status-row">
          <span className="chip">
            {notificationsEnabled ? <Bell size={14} /> : <BellOff size={14} />}
            {notificationsEnabled ? 'Включены' : 'Выключены'}
          </span>
          <button className="ghost-btn" onClick={() => void toggleNotifications()}>
            {notificationsEnabled ? 'Выключить уведомления' : 'Включить уведомления'}
          </button>
        </div>
        <label className="settings-f1-reminders">
          <input
            type="checkbox"
            checked={f1Reminders}
            disabled={!notificationsEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              setF1Reminders(enabled);
              setString('sportsdesk.notifications.f1', enabled ? '1' : '0');
              window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
            }}
          />{' '}
          Напоминать о сессиях Формулы-1
        </label>
        <NotificationPreferences />
        <div className="settings-row settings-actions">
          <button
            className="ghost-btn"
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
          </button>
        </div>
        {notificationMessage && <p className="settings-note">{notificationMessage}</p>}
      </section>
    </>
  );
}
