import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Download,
  KeyRound,
  Link2,
  Minimize2,
  Moon,
  Rows3,
  ShieldCheck,
  Star,
  Sun,
  Tv,
  Upload,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { rpc, openExternal, notify } from '../../lib/bridge';
import { getString, setString, STORAGE_KEYS } from '../football/storage';
import { readNotificationsEnabled, writeNotificationsEnabled } from '../football/usePoller';
import './settings.css';
import { UpdatePanel } from './Updates';
import { NotificationPreferences } from './NotificationPreferences';
import { FavoriteClubsEditor } from './FavoriteClubsEditor';
import { BackupPanel } from './BackupPanel';
import { ShortcutControl } from './ShortcutControl';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AtmosphereSettings } from '../atmosphere/AtmosphereSettings';
import { applyProfile, profileEntries } from './profileBackup';
import { DesignChooser } from '../../components/DesignChooser';
import { openFirstRunWizard } from '../onboarding/onboarding';
import {
  beginKinoAttempt,
  cancelKinoAttempt,
  finishKinoAttempt,
  isCurrentKinoAttempt,
  logoutKinoSession,
  settleKinoCancellations,
} from '../watch/kinoAuth';

interface SecretStatus {
  pitch: boolean;
  kino: boolean;
  kinoClient: boolean;
}

const TIMEZONES = [
  'Asia/Yakutsk',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'UTC',
];

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

export function SettingsView() {
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

  const [timezone, setTimezone] = useState<string>(
    () => getString(STORAGE_KEYS.timezone) ?? 'Asia/Yakutsk',
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    readNotificationsEnabled(),
  );
  const [f1Reminders, setF1Reminders] = useState(
    () => getString('sportsdesk.notifications.f1') !== '0',
  );
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [trayMode, setTrayMode] = useState<boolean>(() => getString(STORAGE_KEYS.trayMode) !== '0');
  const [lightTheme, setLightTheme] = useState<boolean>(
    () => getString('sportsdesk.scheme') === 'light',
  );
  const [compactTables, setCompactTables] = useState<boolean>(
    () => getString('sportsdesk.density') === 'compact',
  );

  const setAppearance = (scheme: 'light' | 'dark') => {
    setString('sportsdesk.scheme', scheme);
    setLightTheme(scheme === 'light');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  const setDensity = (density: 'default' | 'compact') => {
    setString('sportsdesk.density', density);
    setCompactTables(density === 'compact');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  // №9: резервная копия профиля (не-секретные настройки) одним файлом.
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const exportProfile = async () => {
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      // Все ключи sportsdesk.* из localStorage — сами по себе не-секретные;
      // Rust дополнительно фильтрует по allowlist.
      const entries = profileEntries();
      if (entries.length === 0) {
        setProfileMessage('Настроек для экспорта нет.');
        return;
      }
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (isTauri) {
        const dlg = await import('@tauri-apps/plugin-dialog');
        const path = await dlg.save({
          title: 'Сохранить резервную копию профиля',
          defaultPath: 'sportsdesk-profile.json',
          filters: [{ name: 'Профиль SportsDesk', extensions: ['json'] }],
        });
        if (!path) return;
        await rpc('export_profile', { settings: entries, path });
      } else {
        // Браузер: скачиваем JSON.
        const blob = new Blob(
          [
            JSON.stringify(
              {
                app: 'SportsDesk',
                version: 1,
                exportedAt: new Date().toISOString(),
                settings: Object.fromEntries(entries),
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sportsdesk-profile.json';
        a.click();
        URL.revokeObjectURL(url);
      }
      setProfileMessage(`Профиль сохранён (${entries.length} настроек).`);
    } catch (e) {
      setProfileMessage(e instanceof Error ? e.message : 'Экспорт не удался.');
    } finally {
      setProfileBusy(false);
    }
  };

  const importProfile = async () => {
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      let profile: { app?: string; version?: number; settings: Record<string, string> } | null =
        null;
      if (isTauri) {
        const dlg = await import('@tauri-apps/plugin-dialog');
        const path = await dlg.open({
          title: 'Открыть резервную копию профиля',
          multiple: false,
          filters: [{ name: 'Профиль SportsDesk', extensions: ['json'] }],
        });
        if (!path || typeof path !== 'string') return;
        profile = await rpc<{ settings: Record<string, string> }>('import_profile', { path });
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.click();
        });
        if (!file) return;
        profile = JSON.parse(await file.text());
        if (profile?.app !== 'SportsDesk' || profile.version !== 1)
          throw new Error('Неподдерживаемый профиль SportsDesk.');
      }
      if (!profile?.settings || Object.keys(profile.settings).length === 0) {
        throw new Error('Профиль не содержит настроек.');
      }
      await applyProfile(profile.settings);
    } catch (e) {
      setProfileMessage(e instanceof Error ? e.message : 'Импорт не удался.');
    } finally {
      setProfileBusy(false);
    }
  };

  const [kinoClientForm, setKinoClientForm] = useState({
    baseUrl: '',
    clientId: '',
    clientSecret: '',
  });
  const [kinoClientEditing, setKinoClientEditing] = useState(false);
  const [kinoClientBusy, setKinoClientBusy] = useState(false);
  const [kinoClientMessage, setKinoClientMessage] = useState<string | null>(null);
  const [kinoBusy, setKinoBusy] = useState(false);
  const [kinoDevice, setKinoDevice] = useState<{
    userCode: string;
    verificationUri: string;
    expiresIn: number;
  } | null>(null);
  const [kinoPolling, setKinoPolling] = useState(false);
  const [kinoMessage, setKinoMessage] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const kinoExpiryTimer = useRef<number | null>(null);
  const kinoGeneration = useRef(0);
  const kinoAttempt = useRef<Promise<string> | null>(null);
  const mounted = useRef(true);

  const abandonKinoAuth = useCallback(() => {
    kinoGeneration.current += 1;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    if (kinoExpiryTimer.current !== null) window.clearTimeout(kinoExpiryTimer.current);
    pollTimer.current = null;
    kinoExpiryTimer.current = null;
    const attempt = kinoAttempt.current;
    kinoAttempt.current = null;
    const cancellation = attempt ? cancelKinoAttempt(attempt) : Promise.resolve();
    void cancellation.catch(() => undefined);
    return cancellation;
  }, []);

  const refreshSecret = useCallback(async () => {
    try {
      await settleKinoCancellations();
      const res = await rpc<SecretStatus>('secret_status');
      if (!mounted.current) return;
      setSecretStatus({
        pitch: Boolean(res?.pitch),
        kino: Boolean(res?.kino),
        kinoClient: Boolean(res?.kinoClient),
      });
      setSecretError(null);
    } catch (e) {
      if (!mounted.current) return;
      setSecretStatus(null);
      setSecretError(e instanceof Error ? e.message : 'Не удалось получить статус секретов');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshSecret();
    return () => {
      mounted.current = false;
      abandonKinoAuth();
    };
  }, [refreshSecret, abandonKinoAuth]);

  const saveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyMessage('Ключ не может быть пустым.');
      return;
    }
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const res = await rpc<{ ok: boolean }>('set_pitch_key', { key: trimmed });
      if (!mounted.current) return;
      if (res?.ok) {
        setKeyInput('');
        setKeyMessage('Ключ сохранён в зашифрованном виде.');
        await refreshSecret();
      } else {
        setKeyMessage('Ключ не принят сервисом.');
      }
    } catch (e) {
      if (!mounted.current) return;
      setKeyMessage(e instanceof Error ? e.message : 'Ошибка сохранения ключа');
    } finally {
      if (mounted.current) setKeyBusy(false);
    }
  };

  const saveKinoClient = async () => {
    const baseUrl = kinoClientForm.baseUrl.trim();
    const clientId = kinoClientForm.clientId.trim();
    const clientSecret = kinoClientForm.clientSecret.trim();
    if (!/^https:\/\/\S+$/.test(baseUrl) || !clientId || !clientSecret) {
      setKinoClientMessage(
        'Заполните все поля: адрес должен начинаться с https://, Client ID и Client secret не пустые.',
      );
      return;
    }
    setKinoClientBusy(true);
    setKinoClientMessage(null);
    try {
      const res = await rpc<{ ok: boolean }>('set_kino_client', {
        baseUrl,
        clientId,
        clientSecret,
      });
      if (!mounted.current) return;
      if (res?.ok) {
        setKinoClientForm({ baseUrl: '', clientId: '', clientSecret: '' });
        setKinoClientEditing(false);
        setKinoClientMessage(
          'Настройки KinoPub сохранены и зашифрованы. Теперь можно войти по коду.',
        );
        await refreshSecret();
      } else {
        setKinoClientMessage('Не удалось сохранить настройки KinoPub.');
      }
    } catch (e) {
      if (!mounted.current) return;
      setKinoClientMessage(
        e instanceof Error ? e.message : 'Не удалось сохранить настройки KinoPub.',
      );
    } finally {
      if (mounted.current) setKinoClientBusy(false);
    }
  };

  const onTimezoneChange = (value: string) => {
    setTimezone(value);
    setString(STORAGE_KEYS.timezone, value);
  };

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      writeNotificationsEnabled(false);
      setNotificationMessage('Уведомления выключены.');
      return;
    }
    const perm = await requestPermissionSafe();
    if (!mounted.current) return;
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

  const toggleTrayMode = async () => {
    const next = !trayMode;
    setTrayMode(next);
    setString(STORAGE_KEYS.trayMode, next ? '1' : '0');
    try {
      await rpc('set_tray_mode', { enabled: next });
    } catch {
      /* dev bridge or non-Tauri: setting still persisted for native runs */
    }
  };

  const stopKinoPolling = () => {
    const cancellation = abandonKinoAuth();
    const generation = kinoGeneration.current;
    setKinoPolling(false);
    setKinoDevice(null);
    void cancellation.catch((e) => {
      if (mounted.current && kinoGeneration.current === generation) {
        setKinoMessage(e instanceof Error ? e.message : 'Не удалось отменить авторизацию Kino');
      }
    });
  };

  const pollKino = useCallback(
    async (sessionId: string, intervalSec: number, deadline: number, generation: number) => {
      const current = () =>
        mounted.current &&
        kinoGeneration.current === generation &&
        kinoAttempt.current !== null &&
        isCurrentKinoAttempt(kinoAttempt.current);
      const valid = () => {
        if (!current()) return false;
        if (Date.now() >= deadline) {
          abandonKinoAuth();
          setKinoPolling(false);
          setKinoDevice(null);
          setKinoMessage('Код авторизации истёк. Запросите новый.');
          return false;
        }
        return true;
      };
      if (!valid()) return;
      try {
        const res = await rpc<{ pending: boolean; authenticated: boolean }>('kino_poll_auth', {
          sessionId,
        });
        if (!valid()) return;
        if (res?.authenticated) {
          await rpc('kino_commit_auth', { sessionId });
          if (!valid()) return;
          if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
          if (kinoExpiryTimer.current !== null) window.clearTimeout(kinoExpiryTimer.current);
          pollTimer.current = null;
          kinoExpiryTimer.current = null;
          const attempt = kinoAttempt.current!;
          kinoAttempt.current = null;
          kinoGeneration.current += 1;
          finishKinoAttempt(sessionId, attempt);
          setKinoPolling(false);
          setKinoDevice(null);
          setKinoMessage('Kino авторизация подтверждена.');
          await refreshSecret();
          return;
        }
        if (!res?.pending) {
          abandonKinoAuth();
          setKinoPolling(false);
          setKinoDevice(null);
          setKinoMessage('Авторизация не завершена. Код истёк или отклонён.');
          return;
        }
        pollTimer.current = window.setTimeout(
          () => void pollKino(sessionId, intervalSec, deadline, generation),
          Math.max(intervalSec, 4) * 1000,
        );
      } catch (e) {
        if (!valid()) return;
        abandonKinoAuth();
        setKinoPolling(false);
        setKinoDevice(null);
        setKinoMessage(e instanceof Error ? e.message : 'Ошибка опроса авторизации');
      }
    },
    [abandonKinoAuth, refreshSecret],
  );

  const startKinoAuth = async () => {
    abandonKinoAuth();
    const generation = kinoGeneration.current;
    const attempt = beginKinoAttempt(() => {
      abandonKinoAuth();
      setKinoPolling(false);
      setKinoDevice(null);
      setKinoBusy(false);
    });
    kinoAttempt.current = attempt;
    const current = () =>
      mounted.current && kinoGeneration.current === generation && isCurrentKinoAttempt(attempt);
    setKinoBusy(true);
    setKinoMessage(null);
    try {
      const sessionId = await attempt;
      if (!current()) return;
      const res = await rpc<{
        code: string;
        userCode: string;
        verificationUri: string;
        expiresIn: number;
        interval: number;
      }>('kino_start_auth', { sessionId });
      if (!current()) return;
      if (!res?.code) throw new Error('Сервис не вернул код устройства');
      const expiresIn = Number.isFinite(res.expiresIn) && res.expiresIn > 0 ? res.expiresIn : 600;
      const deadline = Date.now() + expiresIn * 1000;
      setKinoDevice({
        userCode: res.userCode,
        verificationUri: res.verificationUri,
        expiresIn,
      });
      setKinoPolling(true);
      kinoExpiryTimer.current = window.setTimeout(() => {
        if (!current()) return;
        abandonKinoAuth();
        setKinoPolling(false);
        setKinoDevice(null);
        setKinoMessage('Код авторизации истёк. Запросите новый.');
      }, expiresIn * 1000);
      pollTimer.current = window.setTimeout(
        () => void pollKino(sessionId, res.interval ?? 5, deadline, generation),
        Math.max(res.interval ?? 5, 4) * 1000,
      );
    } catch (e) {
      if (!current()) return;
      abandonKinoAuth();
      setKinoBusy(false);
      setKinoMessage(e instanceof Error ? e.message : 'Не удалось начать авторизацию Kino');
    } finally {
      if (mounted.current && kinoGeneration.current === generation) setKinoBusy(false);
    }
  };

  const logoutKino = async () => {
    abandonKinoAuth();
    setKinoPolling(false);
    setKinoDevice(null);
    setKinoBusy(true);
    setKinoMessage(null);
    try {
      await logoutKinoSession();
      if (!mounted.current) return;
      setKinoMessage('Выполнен выход из Kino в SportsDesk. Аккаунт в браузере/TV не затронут.');
      await refreshSecret();
    } catch (e) {
      if (!mounted.current) return;
      setKinoMessage(e instanceof Error ? e.message : 'Не удалось выйти из Kino');
    } finally {
      if (mounted.current) setKinoBusy(false);
    }
  };

  const secretUnknown = secretError !== null;
  const pitchReady = secretStatus?.pitch === true;
  const kinoReady = secretStatus?.kino === true;
  const kinoClientReady = secretStatus?.kinoClient === true;
  const showKinoClientForm = secretStatus !== null && (!kinoClientReady || kinoClientEditing);

  return (
    <div className="settings-view">
      <div className="dashboard-head">
        <div>
          <h1>Настройки</h1>
          <p className="muted small">
            Ключи хранятся в зашифрованном виде и не входят в резервные копии.
          </p>
        </div>
      </div>

      {secretUnknown && (
        <div className="panel settings-warn">
          Не удалось проверить ключи: {secretError}. Проверьте, что приложение Windows запущено.
        </div>
      )}

      <section className="panel settings-section">
        <div className="section-title">
          <h2>{lightTheme ? <Sun size={15} /> : <Moon size={15} />} Внешний вид</h2>
          <span className="chip">{lightTheme ? 'Светлая' : 'Тёмная'}</span>
        </div>
        <DesignChooser />
        <div className="settings-actions">
          <button
            className="ghost-btn"
            onClick={() => setAppearance(lightTheme ? 'dark' : 'light')}
          >
            {lightTheme ? 'Перейти на тёмную' : 'Перейти на светлую'}
          </button>
          <button
            className="ghost-btn"
            onClick={() => setDensity(compactTables ? 'default' : 'compact')}
            aria-pressed={compactTables}
          >
            <Rows3 size={14} /> {compactTables ? 'Обычные таблицы' : 'Плотные таблицы'}
          </button>
          <button className="ghost-btn" onClick={openFirstRunWizard}>
            Пройти мастер настройки
          </button>
        </div>
        <p className="settings-note">Тема и плотность применяются сразу и сохраняются.</p>
      </section>

      <BackupPanel />
      <DiagnosticsPanel />
      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <KeyRound size={15} /> PitchAPI
          </h2>
          <span className="chip">
            {!secretStatus && !secretError
              ? 'Проверяем…'
              : pitchReady
                ? 'Ключ сохранён'
                : 'Ключ не задан'}
          </span>
        </div>
        <p className="muted small">
          Ключ нужен для расписания, матчей, составов и статистики PitchAPI.
        </p>
        <div className="settings-row">
          <label htmlFor="pitch-key" className="muted small">
            Новый ключ PitchAPI
          </label>
          <input
            id="pitch-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={pitchReady ? 'Заменить сохранённый ключ' : 'Вставьте ключ'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            disabled={keyBusy}
          />
          <button className="ghost-btn" onClick={saveKey} disabled={keyBusy || !keyInput.trim()}>
            {keyBusy ? 'Сохранение…' : 'Сохранить ключ'}
          </button>
        </div>
        {keyMessage && <p className="settings-note">{keyMessage}</p>}
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <Download size={15} /> Резервная копия профиля
          </h2>
          <span className="chip">json</span>
        </div>
        <p className="muted small">
          Один файл со всеми настройками: избранные команды и игроки, тема, часовой пояс, выбранные
          лиги. Секреты (ключ PitchAPI и токены Kino) в копию не входят — на новом компьютере их
          нужно ввести заново.
        </p>
        <div className="settings-actions">
          <button className="ghost-btn" onClick={() => void exportProfile()} disabled={profileBusy}>
            <Download size={14} /> {profileBusy ? 'Работаем…' : 'Экспорт профиля'}
          </button>
          <button className="ghost-btn" onClick={() => void importProfile()} disabled={profileBusy}>
            <Upload size={14} /> Импорт профиля
          </button>
        </div>
        {profileMessage && <p className="settings-note">{profileMessage}</p>}
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <ShieldCheck size={15} /> Время
          </h2>
        </div>
        <div className="settings-row">
          <label htmlFor="tz-select" className="muted small">
            Часовой пояс
          </label>
          <select
            id="tz-select"
            value={timezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <span className="muted small">
            UTC-время матчей переводится в выбранный пояс при отображении.
          </span>
        </div>
      </section>

      <section className="panel settings-section" aria-label="Избранное">
        <div className="section-title">
          <h2>
            <Star size={15} /> Избранное
          </h2>
        </div>
        <FavoriteClubsEditor />
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <h2>{notificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />} Уведомления</h2>
          <span className="chip">{notificationsEnabled ? 'Включены' : 'Выключены'}</span>
        </div>
        <p className="muted small">
          Приложение проверяет матчи раз в минуту, пока запущено, в том числе в трее.
        </p>
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
        <p className="muted small">
          Практики, квалификация, спринт и гонка по расписанию Jolpica. Напоминания работают при
          запущенном приложении, включая трей; время без подтверждения источником не подставляется.
        </p>
        <NotificationPreferences />
        <div className="settings-row settings-actions">
          <button className="ghost-btn" onClick={toggleNotifications}>
            {notificationsEnabled ? 'Выключить уведомления' : 'Включить уведомления'}
          </button>
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

      <AtmosphereSettings />

      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <Minimize2 size={15} /> Трей
          </h2>
          <span className="chip">{trayMode ? 'Закрытие в трей' : 'Закрытие — выход'}</span>
        </div>
        <p className="muted small">
          {trayMode
            ? 'При закрытии окна приложение продолжает работать в трее. Для полного выхода используйте меню значка в трее.'
            : 'Закрытие окна завершает приложение.'}
        </p>
        <div className="settings-actions">
          <button className="ghost-btn" onClick={() => void toggleTrayMode()}>
            {trayMode ? 'Закрывать приложение полностью' : 'Скрывать в трей при закрытии'}
          </button>
        </div>
        <ShortcutControl />
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <Tv size={15} /> Kino (KinoWatch)
          </h2>
          <span className="chip">
            {!secretStatus && !secretError
              ? 'Проверяем…'
              : kinoReady
                ? 'Авторизован'
                : 'Не авторизован'}
          </span>
        </div>
        <p className="muted small">
          Авторизация через код устройства сервиса Kino, токены хранятся только в защищённом
          хранилище этого приложения. Аккаунт в браузере/TV не читается и не изменяется.
        </p>
        {showKinoClientForm && (
          <div className="kino-client panel inner">
            <p className="muted small">
              {kinoClientReady
                ? 'Новые значения заменят сохранённые. Старые не показываются.'
                : 'Шаг 1. Укажите адрес и данные клиента KinoPub. Они сохраняются в зашифрованном виде и не показываются повторно.'}
            </p>
            <label htmlFor="kino-base-url" className="muted small">
              Адрес API (https://…)
            </label>
            <input
              id="kino-base-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={kinoClientForm.baseUrl}
              onChange={(e) => setKinoClientForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
            <label htmlFor="kino-client-id" className="muted small">
              Client ID
            </label>
            <input
              id="kino-client-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={kinoClientForm.clientId}
              onChange={(e) => setKinoClientForm((f) => ({ ...f, clientId: e.target.value }))}
            />
            <label htmlFor="kino-client-secret" className="muted small">
              Client secret
            </label>
            <input
              id="kino-client-secret"
              type="password"
              autoComplete="off"
              value={kinoClientForm.clientSecret}
              onChange={(e) => setKinoClientForm((f) => ({ ...f, clientSecret: e.target.value }))}
            />
            <div className="settings-actions">
              <button
                className="ghost-btn"
                onClick={() => void saveKinoClient()}
                disabled={kinoClientBusy}
              >
                {kinoClientBusy ? 'Сохраняем…' : 'Сохранить настройки KinoPub'}
              </button>
              {kinoClientReady && (
                <button
                  className="ghost-btn"
                  onClick={() => setKinoClientEditing(false)}
                  disabled={kinoClientBusy}
                >
                  Отмена
                </button>
              )}
            </div>
          </div>
        )}
        {kinoClientMessage && <p className="settings-note">{kinoClientMessage}</p>}
        {kinoDevice ? (
          <div className="kino-device panel inner">
            <p>
              Код устройства: <strong className="kino-code">{kinoDevice.userCode}</strong>
            </p>
            <p className="muted small">
              Откройте страницу сервиса и введите код. Код действует примерно{' '}
              {Math.max(0, Math.round(kinoDevice.expiresIn / 60))} мин.
            </p>
            <div className="settings-actions">
              <button
                className="ghost-btn"
                onClick={() => void openExternal(kinoDevice.verificationUri).catch(() => undefined)}
              >
                <Link2 size={14} /> Открыть страницу авторизации
              </button>
              {kinoPolling && (
                <button className="ghost-btn" onClick={stopKinoPolling}>
                  Остановить ожидание
                </button>
              )}
            </div>
            {kinoPolling && <p className="muted small">Ожидание подтверждения…</p>}
          </div>
        ) : (
          <div className="settings-actions">
            <button
              className="ghost-btn"
              onClick={startKinoAuth}
              disabled={kinoBusy || kinoReady || !kinoClientReady}
            >
              {kinoBusy ? 'Запуск…' : 'Войти по коду устройства'}
            </button>
            {kinoClientReady && !kinoClientEditing && (
              <button
                className="ghost-btn"
                onClick={() => {
                  setKinoClientMessage(null);
                  setKinoClientEditing(true);
                }}
                disabled={kinoBusy}
              >
                Изменить настройки клиента
              </button>
            )}
            {kinoReady && (
              <button className="ghost-btn" onClick={logoutKino} disabled={kinoBusy}>
                Выйти из Kino в SportsDesk
              </button>
            )}
          </div>
        )}
        {kinoMessage && <p className="settings-note">{kinoMessage}</p>}
      </section>

      <UpdatePanel />
      <section className="panel settings-section">
        <div className="section-title">
          <h2>Источники и их ограничения</h2>
        </div>
        <p className="muted small">
          Данные могут быть неполными. Прочерк означает, что значение не получено.
        </p>
        <dl className="settings-dl">
          <dt>PitchAPI</dt>
          <dd>
            Расписание, матч, составы, события, статистика, игроки. Полный аналитический разбор —
            после матча. Лайв-статус не гарантирован.
          </dd>
          <dt>SportScore</dt>
          <dd>
            Счёт, события, составы и таблицы. Лимит — примерно 10 000 запросов в день на IP; лента
            обновляется не чаще раза в минуту, пока открыта.
          </dd>
          <dt>F1 (Jolpica / OpenF1)</dt>
          <dd>
            Jolpica: расписание, результаты, квалификация и зачёты. OpenF1: исторические данные с
            2023 (круги, пит-стопы, погода). Живой телеметрии в бесплатном доступе нет — режим
            честно исторический.
          </dd>
          <dt>Kino</dt>
          <dd>Трансляции после входа по коду устройства.</dd>
        </dl>
      </section>
    </div>
  );
}

export default SettingsView;
