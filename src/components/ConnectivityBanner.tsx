import { useEffect, useState, useSyncExternalStore } from 'react';
import { CloudOff, History, RefreshCw } from 'lucide-react';
import { formatDateTime, getUserTimezone } from '../features/football/storage';
import {
  getHealthSnapshot,
  subscribeHealth,
  retryFailedResources,
  setActiveSources,
} from '../lib/resourceHealth';

export function ConnectivityBanner({ sources }: { sources?: readonly string[] }) {
  const health = useSyncExternalStore(subscribeHealth, getHealthSnapshot);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const scope = JSON.stringify(sources ?? null);
  useEffect(() => {
    setActiveSources(sources ?? null);
  }, [scope]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (sources?.length === 0 || (online && !health.failures.length)) return null;
  const saved =
    health.failures
      .map((f) => f.fetchedAt)
      .filter((t): t is string => !!t)
      .sort()[0] ?? (!online ? health.lastFetchedAt : null);
  return (
    <div className={`connectivity-banner ${online ? 'stale' : 'offline'}`} role="status">
      {online ? <History size={15} /> : <CloudOff size={15} />}
      <span>
        {online ? 'Часть источников недоступна.' : 'Нет сети.'}{' '}
        {saved ? 'Показаны сохранённые данные.' : 'Часть данных пока не загружена.'}
      </span>
      {saved && <small>Сохранено {formatDateTime(saved, getUserTimezone())}</small>}
      <button
        className="ghost-btn"
        disabled={health.retrying}
        onClick={() => retryFailedResources({ sources })}
      >
        <RefreshCw size={13} className={health.retrying ? 'spin' : ''} />
        {health.retrying ? 'Повторяем…' : 'Повторить'}
      </button>
      <small>
        {health.autoRetryPending
          ? 'Повторяем автоматически.'
          : 'Проверьте настройки источника или повторите вручную.'}
      </small>
    </div>
  );
}
export default ConnectivityBanner;
