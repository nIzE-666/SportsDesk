import { lazy, Suspense, useState } from 'react';
import { Download, HardDriveDownload, Upload } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
import { Badge, Button, Panel, PanelHeader, Skeleton } from '../../../kit';
import { BackupPanel } from '../BackupPanel';
import { applyProfile, profileEntries } from '../profileBackup';

const OfflineView = lazy(() =>
  import('../../offline/OfflineView').then((m) => ({ default: m.OfflineView })),
);

export function DataSettings() {
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

  return (
    <>
      <BackupPanel />
      <Panel className="settings-section">
        <PanelHeader
          title={
            <>
              <Download size={16} aria-hidden /> Резервная копия профиля
            </>
          }
          action={<Badge>json</Badge>}
        />
        <p className="muted small">Настройки и избранное без ключей.</p>
        <div className="settings-actions">
          <Button
            icon={<Download size={14} />}
            onClick={() => void exportProfile()}
            busy={profileBusy}
          >
            Экспорт профиля
          </Button>
          <Button
            icon={<Upload size={14} />}
            onClick={() => void importProfile()}
            disabled={profileBusy}
          >
            Импорт профиля
          </Button>
        </div>
        {profileMessage && <p className="settings-note">{profileMessage}</p>}
      </Panel>
      <Panel className="settings-section settings-offline">
        <PanelHeader
          title={
            <>
              <HardDriveDownload size={16} aria-hidden /> Офлайн-сезоны
            </>
          }
        />
        <Suspense fallback={<Skeleton />}>
          <OfflineView embedded />
        </Suspense>
      </Panel>
    </>
  );
}
