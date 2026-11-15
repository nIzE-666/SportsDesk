import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { isTauriRuntime, rpc } from '../../lib/bridge';
import { Badge, Button, Panel, PanelHeader, Toast } from '../../kit';
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater';
import packageInfo from '../../../package.json';

type Phase = 'idle' | 'checking' | 'saving' | 'available' | 'installing' | 'error';
interface UpdateState {
  source: string;
  version: string;
  phase: Phase;
  message: string;
  update: Update | null;
  progress: number | null;
  check: () => Promise<void>;
  save: (source: string) => Promise<void>;
  install: () => Promise<void>;
}
const Context = createContext<UpdateState | null>(null);
function useUpdates() {
  const context = useContext(Context);
  if (!context) throw new Error('UpdateProvider required');
  return context;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState('');
  const [version, setVersion] = useState(packageInfo.version);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const current = useRef<Update | null>(null),
    busy = useRef(false),
    active = useRef(true);
  const clearUpdate = useCallback(() => {
    void current.current?.close().catch(() => {});
    current.current = null;
    setUpdate(null);
  }, []);
  useEffect(() => {
    active.current = true;
    if (isTauriRuntime())
      void rpc<{ endpoint: string; version: string }>('updater_settings')
        .then((s) => {
          if (active.current) {
            setSource(s.endpoint);
            setVersion(s.version);
          }
        })
        .catch(() => {
          if (active.current) {
            setMessage('Не удалось прочитать настройки обновлений.');
            setPhase('error');
          }
        });
    return () => {
      active.current = false;
      void current.current?.close().catch(() => {});
    };
  }, []);
  const check = useCallback(async () => {
    if (!isTauriRuntime() || !source || busy.current) return;
    busy.current = true;
    setPhase('checking');
    setMessage('Проверяем новую версию…');
    clearUpdate();
    try {
      const metadata = await rpc<ConstructorParameters<typeof Update>[0] | null>(
        'check_for_update',
      );
      if (metadata) {
        const { Update: DesktopUpdate } = await import('@tauri-apps/plugin-updater');
        const next = new DesktopUpdate(metadata);
        if (!active.current) {
          await next.close();
          return;
        }
        current.current = next;
        setUpdate(next);
        setPhase('available');
        setMessage(`Доступна версия ${next.version}.`);
      } else if (active.current) {
        setPhase('idle');
        setMessage('Установлена последняя версия.');
      }
    } catch (e) {
      if (active.current) {
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'Не удалось проверить обновления.');
      }
    } finally {
      busy.current = false;
    }
  }, [source, clearUpdate]);
  useEffect(() => {
    if (!source || !isTauriRuntime()) return;
    const timer = window.setTimeout(() => void check(), 5_000);
    return () => window.clearTimeout(timer);
  }, [source, check]);
  const save = async (value: string) => {
    if (busy.current || !isTauriRuntime()) return;
    busy.current = true;
    setPhase('saving');
    try {
      const result = await rpc<{ endpoint: string }>('set_update_source', { source: value.trim() });
      if (!active.current) return;
      clearUpdate();
      setSource(result.endpoint);
      setPhase('idle');
      setMessage(
        result.endpoint
          ? 'Источник сохранён. Проверка начнётся автоматически.'
          : 'Источник обновлений отключён.',
      );
    } catch (e) {
      if (active.current) {
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'Не удалось сохранить адрес.');
      }
    } finally {
      busy.current = false;
    }
  };
  const install = async () => {
    const next = current.current;
    if (!next || busy.current) return;
    busy.current = true;
    setPhase('installing');
    setMessage('Загружаем и проверяем подпись обновления…');
    setProgress(null);
    let received = 0,
      total: number | undefined;
    try {
      await next.downloadAndInstall(
        (event: DownloadEvent) => {
          if (!active.current) return;
          if (event.event === 'Started') {
            total = event.data.contentLength;
            received = 0;
          }
          if (event.event === 'Progress') {
            received += event.data.chunkLength;
            if (total) setProgress(Math.min(100, (received / total) * 100));
          }
          if (event.event === 'Finished')
            setMessage('Подпись проверяется. Устанавливаем обновление…');
        },
        { restartAfterInstall: true },
      );
      if (active.current) setMessage('Обновление установлено. Приложение перезапускается…');
    } catch (e) {
      if (active.current) {
        setPhase('error');
        setMessage(
          `Обновление не установлено: ${e instanceof Error ? e.message : 'ошибка загрузки или проверки подписи'}`,
        );
      }
    } finally {
      busy.current = false;
    }
  };
  return (
    <Context.Provider
      value={{ source, version, phase, message, update, progress, check, save, install }}
    >
      {children}
    </Context.Provider>
  );
}

export function UpdatePanel() {
  const u = useUpdates();
  const [value, setValue] = useState(u.source);
  useEffect(() => setValue(u.source), [u.source]);
  const native = isTauriRuntime(),
    busy = ['checking', 'saving', 'installing'].includes(u.phase);
  return (
    <Panel className="settings-section updates-panel">
      <PanelHeader
        title={
          <>
            <Download size={16} /> Обновления приложения
          </>
        }
        action={<Badge>Версия {u.version}</Badge>}
      />
      {!native && <p className="settings-note">Только в приложении Windows.</p>}
      {native && !u.source && (
        <p className="settings-note">Новые версии устанавливаются вручную.</p>
      )}
      <label className="update-source-label" htmlFor="update-source">
        HTTPS-адрес файла latest.json
      </label>
      <div className="update-source-row">
        <input
          id="update-source"
          type="url"
          placeholder="https://…/latest.json"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!native || busy}
        />
        <Button onClick={() => void u.save(value)} disabled={!native || busy || value === u.source}>
          Сохранить адрес
        </Button>
      </div>
      <div className="settings-actions">
        <Button
          icon={<RefreshCw size={14} className={u.phase === 'checking' ? 'spin' : ''} />}
          onClick={() => void u.check()}
          disabled={!native || !u.source || busy}
        >
          Проверить обновления
        </Button>
        {u.update && u.phase !== 'installing' && (
          <Button variant="primary" onClick={() => void u.install()} disabled={busy}>
            Установить {u.update.version} и перезапустить
          </Button>
        )}
      </div>
      {u.update?.body && <p className="update-notes">{u.update.body}</p>}
      {u.phase === 'installing' && (
        <progress aria-label="Загрузка обновления" max={100} value={u.progress ?? undefined} />
      )}
      {u.message && (
        <p role={u.phase === 'error' ? 'alert' : 'status'} className="settings-note">
          {u.message}
        </p>
      )}
    </Panel>
  );
}

export function UpdateNotice() {
  const u = useUpdates();
  if (!u.update || !['available', 'installing'].includes(u.phase)) return null;
  return (
    <Toast
      message={
        u.phase === 'installing'
          ? u.message
          : `Доступна новая версия SportsDesk ${u.update.version}`
      }
      action={
        <Button small disabled={u.phase === 'installing'} onClick={() => void u.install()}>
          Установить и перезапустить
        </Button>
      }
    />
  );
}
