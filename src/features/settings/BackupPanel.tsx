import { useEffect, useState } from 'react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { profileEntries, restoreFullBackup, withProfileMirrorPaused } from './profileBackup';
interface Settings {
  enabled: boolean;
  folder: string | null;
  lastAt: number | null;
  lastFile: string | null;
  error: string | null;
}
export function BackupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const latest = await rpc<Settings>('backup_settings');
    setSettings(latest);
    return latest;
  };
  useEffect(() => {
    if (isTauriRuntime()) void load().catch((e) => setMessage(String(e)));
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!isTauriRuntime())
    return (
      <section className="panel settings-section">
        <h2>Автоматические резервные копии</h2>
        <p className="muted">
          Выбор папки и копирование базы истории доступны в приложении Windows. Экспорт профиля ниже
          работает и в браузере.
        </p>
      </section>
    );
  return (
    <section className="panel settings-section">
      <h2>Резервные копии с историей</h2>
      <p className="muted small">
        Профиль и согласованный снимок базы матчей в одном файле. Ключи API и авторизация Kino не
        включаются. Хранятся семь последних копий, автоматическое сохранение — раз в сутки при
        работающем приложении.
      </p>
      <p className="backup-folder">{settings?.folder ?? 'Папка ещё не выбрана'}</p>
      <div className="settings-actions">
        <button
          className="ghost-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const dlg = await import('@tauri-apps/plugin-dialog');
              const folder = await dlg.open({
                directory: true,
                multiple: false,
                title: 'Папка копий SportsDesk (можно OneDrive)',
              });
              if (typeof folder !== 'string') return;
              setSettings(
                await rpc<Settings>('configure_backup', {
                  folder,
                  enabled: settings?.enabled ?? false,
                }),
              );
            })
          }
        >
          Выбрать папку
        </button>
        <button
          className="ghost-btn"
          disabled={busy || !settings?.folder}
          onClick={() =>
            void run(async () => {
              const path = await withProfileMirrorPaused(async () => {
                await rpc('sync_profile', { settings: profileEntries() });
                return rpc<string>('create_backup');
              });
              const latest = await load();
              setMessage(`Копия сохранена: ${path}${latest.error ? ` ${latest.error}` : ''}`);
            })
          }
        >
          Создать сейчас
        </button>
        <button
          className="ghost-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const dlg = await import('@tauri-apps/plugin-dialog');
              const path = await dlg.open({
                multiple: false,
                title: 'Восстановить профиль и историю',
                filters: [{ name: 'Копия SportsDesk', extensions: ['json'] }],
              });
              if (typeof path !== 'string') return;
              const yes = await dlg.confirm(
                'Заменить текущий профиль и историю данными из выбранной копии? Перед восстановлением будет сохранена копия текущих данных в вашей папке.',
                { title: 'Восстановление SportsDesk', kind: 'warning' },
              );
              if (!yes) return;
              if (!settings?.folder)
                throw new Error(
                  'Сначала выберите папку, чтобы сохранить текущие данные перед восстановлением.',
                );
              await restoreFullBackup(path);
            })
          }
        >
          Восстановить копию
        </button>
      </div>
      <label className="settings-f1-reminders">
        <input
          type="checkbox"
          checked={settings?.enabled ?? false}
          disabled={busy || !settings?.folder}
          onChange={(e) => {
            const enabled = e.target.checked;
            void run(async () =>
              setSettings(
                await rpc<Settings>('configure_backup', {
                  enabled,
                  folder: settings?.folder ?? null,
                }),
              ),
            );
          }}
        />
        Сохранять автоматически каждый день
      </label>
      <p className="muted small">
        Последняя копия:{' '}
        {settings?.lastAt ? new Date(settings.lastAt).toLocaleString('ru-RU') : 'ещё не создана'}
      </p>
      {(message || settings?.error) && (
        <p role="status" className="settings-note">
          {message || settings?.error}
        </p>
      )}
    </section>
  );
}
