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
import { BackupPanel } from './BackupPanel';
import { ShortcutControl } from './ShortcutControl';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { profileEntries, allowedProfileKey } from './profileBackup';

interface SecretStatus {
  pitch: boolean;
  kino: boolean;
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
      let profile: { app?: string; settings: Record<string, string> } | null = null;
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
        if (profile?.app !== 'SportsDesk') throw new Error('Файл другого приложения.');
      }
      if (!profile?.settings || Object.keys(profile.settings).length === 0) {
        throw new Error('Профиль не содержит настроек.');
      }
      let applied = 0;
      for (const [key, value] of Object.entries(profile.settings)) {
        if (!allowedProfileKey(key) || typeof value !== 'string') continue;
        try {
          localStorage.setItem(key, value);
          applied++;
        } catch {
          /* quota */
        }
      }
      // Живое применение внешнего вида.
      window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
      window.dispatchEvent(new Event('sportsdesk-favorites-changed'));
      // Providers cache favourites and selections in React state; reload applies
      // the complete imported profile without an old effect overwriting it.
      if (applied > 0) window.location.reload();
      else setProfileMessage('В файле нет подходящих настроек.');
    } catch (e) {
      setProfileMessage(e instanceof Error ? e.message : 'Импорт не удался.');
    } finally {
      setProfileBusy(false);
    }
  };

  const [kinoBusy, setKinoBusy] = useState(false);
  const [kinoDevice, setKinoDevice] = useState<{
    userCode: string;
    verificationUri: string;
    expiresIn: number;
  } | null>(null);
  const [kinoPolling, setKinoPolling] = useState(false);
  const [kinoMessage, setKinoMessage] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  const refreshSecret = useCallback(async () => {
    try {
      const res = await rpc<SecretStatus>('secret_status');
      if (!mounted.current) return;
      setSecretStatus({
        pitch: Boolean(res?.pitch),
        kino: Boolean(res?.kino),
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
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, [refreshSecret]);

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
        setKeyMessage('Ключ сохранён (шифруется через DPAPI, в открытом виде не хранится).');
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

  const onTimezoneChange = (value: string) => {
    setTimezone(value);
    setString(STORAGE_KEYS.timezone, value);
  };

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      writeNotificationsEnabled(false);
      setNotificationMessage('Уведомления выключены. Фоновый опрос остановлен.');
      return;
    }
    const perm = await requestPermissionSafe();
    if (!mounted.current) return;
    if (perm === 'granted' || perm === 'native') {
      setNotificationsEnabled(true);
      writeNotificationsEnabled(true);
      setNotificationMessage(
        'Уведомления включены: фоновый опрос работает в Rust, даже когда окно скрыто в трее.',
      );
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
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setKinoPolling(false);
  };

  const pollKino = useCallback(
    async (code: string, intervalSec: number) => {
      try {
        const res = await rpc<{ pending: boolean; authenticated: boolean }>('kino_poll_auth', {
          code,
        });
        if (!mounted.current) return;
        if (res?.authenticated) {
          stopKinoPolling();
          setKinoDevice(null);
          setKinoMessage('Kino авторизация подтверждена.');
          await refreshSecret();
          return;
        }
        if (!res?.pending) {
          stopKinoPolling();
          setKinoMessage('Авторизация не завершена. Код истёк или отклонён.');
          return;
        }
        pollTimer.current = window.setTimeout(
          () => void pollKino(code, intervalSec),
          Math.max(intervalSec, 4) * 1000,
        );
      } catch (e) {
        if (!mounted.current) return;
        stopKinoPolling();
        setKinoMessage(e instanceof Error ? e.message : 'Ошибка опроса авторизации');
      }
    },
    [refreshSecret],
  );

  const startKinoAuth = async () => {
    setKinoBusy(true);
    setKinoMessage(null);
    try {
      const res = await rpc<{
        code: string;
        userCode: string;
        verificationUri: string;
        expiresIn: number;
        interval: number;
      }>('kino_start_auth');
      if (!mounted.current) return;
      if (!res?.code) throw new Error('Сервис не вернул код устройства');
      setKinoDevice({
        userCode: res.userCode,
        verificationUri: res.verificationUri,
        expiresIn: res.expiresIn,
      });
      setKinoPolling(true);
      pollTimer.current = window.setTimeout(
        () => void pollKino(res.code, res.interval ?? 5),
        Math.max(res.interval ?? 5, 4) * 1000,
      );
    } catch (e) {
      if (!mounted.current) return;
      setKinoMessage(e instanceof Error ? e.message : 'Не удалось начать авторизацию Kino');
    } finally {
      if (mounted.current) setKinoBusy(false);
    }
  };

  const logoutKino = async () => {
    setKinoBusy(true);
    setKinoMessage(null);
    try {
      await rpc('kino_logout');
      if (!mounted.current) return;
      setKinoMessage('Выполнен выход из Kino в SportsDesk. Аккаунт в браузере/TV не затронут.');
      stopKinoPolling();
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

  return (
    <div className="settings-view">
      <div className="dashboard-head">
        <div>
          <h1>Настройки</h1>
          <p className="muted small">
            Секреты хранятся вне бандла и вне localStorage: ключ PitchAPI — через Windows DPAPI,
            токены Kino — в защищённом хранилище приложения.
          </p>
        </div>
      </div>

      {secretUnknown && (
        <div className="panel settings-warn">
          Статус секретов недоступен: {secretError}. Проверьте, что приложение запущено в
          Tauri-режиме.
        </div>
      )}

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
          Ключ используется для расписаний, матчей, составов, событий и статистики PitchAPI. Ключ не
          выводится в интерфейс и не передаётся в JS-бандл.
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
          <h2>{lightTheme ? <Sun size={15} /> : <Moon size={15} />} Внешний вид</h2>
          <span className="chip">{lightTheme ? 'Светлая' : 'Тёмная'}</span>
        </div>
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
        </div>
        <p className="settings-note">
          Тема и плотность применяются сразу и запоминаются. На Windows 11 окно также использует
          системный Mica-эффект, если он доступен.
        </p>
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

      <section className="panel settings-section">
        <div className="section-title">
          <h2>{notificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />} Уведомления</h2>
          <span className="chip">{notificationsEnabled ? 'Включены' : 'Выключены'}</span>
        </div>
        <p className="muted small">
          Уведомления о матчах избранных клубов считает фоновый опрос на Rust: единый тик раз в
          минуту, кеш, защита от повторов и увеличенные паузы при ошибках. Доставка не зависит от
          того, какой экран открыт; при скрытии окна в трей опрос продолжается.
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

      <section className="panel settings-section">
        <div className="section-title">
          <h2>
            <Minimize2 size={15} /> Трей
          </h2>
          <span className="chip">{trayMode ? 'Закрытие в трей' : 'Закрытие — выход'}</span>
        </div>
        <p className="muted small">
          {trayMode
            ? 'Закрытие окна скрывает приложение в трей; фоновый опрос и уведомления продолжают работать. Полный выход — через меню иконки в трее.'
            : 'Закрытие окна завершает приложение вместе с фоновым опросом.'}
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
            <button className="ghost-btn" onClick={startKinoAuth} disabled={kinoBusy || kinoReady}>
              {kinoBusy ? 'Запуск…' : 'Войти по коду устройства'}
            </button>
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
        <dl className="settings-dl">
          <dt>PitchAPI</dt>
          <dd>
            Расписание, матч, составы, события, статистика, игроки. Полный аналитический разбор —
            после матча. Лайв-статус не гарантирован.
          </dd>
          <dt>SportScore</dt>
          <dd>
            Лайв-счёт, события, составы и таблицы. Лимит ~10 000 запросов в день на IP. Кэш минимум
            60 с, обновление только при видимой вкладке. Где данные SportScore используются — указан
            источник.
          </dd>
          <dt>F1 (Jolpica / OpenF1)</dt>
          <dd>
            Jolpica: расписание, результаты, квалификация и зачёты. OpenF1: исторические данные с
            2023 (круги, пит-стопы, погода). Живой телеметрии в бесплатном доступе нет — режим
            честно исторический.
          </dd>
          <dt>Kino</dt>
          <dd>
            Только потоковое видео по устройству-коду. Список каналов не сохраняется в localStorage.
          </dd>
        </dl>
      </section>
    </div>
  );
}

export default SettingsView;
