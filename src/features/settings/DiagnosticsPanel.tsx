import { useEffect, useState } from 'react';
import { getResourceDiagnostics, subscribeHealth } from '../../lib/resourceHealth';
import {
  getUiErrors,
  readDiagnostics,
  sanitizeDetails,
  type BackendDiagnostics,
} from '../../lib/diagnostics';
export function DiagnosticsPanel() {
  const [backend, setBackend] = useState<BackendDiagnostics | null>(null),
    [resources, setResources] = useState(getResourceDiagnostics),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setBackend(await readDiagnostics());
      setResources(getResourceDiagnostics());
      setMessage('');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    return subscribeHealth(() => setResources(getResourceDiagnostics()));
  }, []);
  const age = (ms: number) => `${Math.max(0, Math.floor((Date.now() - ms) / 60000))} мин.`;
  return (
    <section className="panel settings-section diagnostics-panel">
      <div className="section-title">
        <h3>Диагностика источников</h3>
        <button className="ghost-btn" disabled={busy} onClick={() => void load()}>
          Обновить диагностику
        </button>
      </div>
      <p className="muted small">
        {backend?.runtime
          ? backend.runtime.startsWith('Windows')
            ? 'Приложение Windows'
            : 'Браузер'
          : 'Загрузка состояния…'}
      </p>
      <div className="diagnostics-grid">
        {['pitch', 'sportscore', 'espn', 'jolpica', 'openf1'].map((source) => {
          const cache = backend?.cache?.find((c) => c.source === source),
            rows = resources.filter((r) => r.key.startsWith(source + ':')),
            failed = rows.filter((r) => r.failed);
          return (
            <div className="panel inner" key={source}>
              <strong>
                {source === 'pitch'
                  ? 'PitchAPI'
                  : source === 'openf1'
                    ? 'OpenF1'
                    : source === 'jolpica'
                      ? 'Jolpica'
                      : source.toUpperCase()}
              </strong>
              <span className={failed.length ? 'diagnostic-error' : 'muted'}>
                {failed.length
                  ? `${failed.length} ошибок`
                  : rows.length || cache
                    ? 'Доступны сохранённые данные'
                    : 'Ещё не запрашивался'}
              </span>
              <small>
                Сохранено записей: {cache?.entries ?? 0} · обновлено{' '}
                {cache ? age(cache.latestAt) : '—'}
              </small>
              {failed.map((r) => (
                <small key={r.key}>
                  {r.code ?? 'Ошибка'} · {r.attempt}/5 повторов
                  {r.automatic ? ' · повтор запланирован' : ''}
                  <br />
                  {r.message}
                </small>
              ))}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Запросов в работе: {backend?.network?.inflight ?? '—'} · Очередь OpenF1:{' '}
        {backend?.network?.openf1Waiting ?? '—'} · За минуту:{' '}
        {backend?.network?.openf1Recent ?? '—'}/30 · Ожидание:{' '}
        {Math.ceil((backend?.network?.openf1NextMs ?? 0) / 1000)} с
      </p>
      <details>
        <summary>
          Последние ошибки ({(backend?.errors?.length ?? 0) + getUiErrors().length})
        </summary>
        {backend?.errors
          ?.slice(-10)
          .reverse()
          .map((e, i) => (
            <p className="muted small" key={i}>
              {new Date(e.at).toLocaleTimeString('ru-RU')} · {e.source} · {e.code} · {e.resource}
            </p>
          ))}
        {getUiErrors().map((e, i) => (
          <p className="small" key={i}>
            {e.section}: {e.message}
          </p>
        ))}
      </details>
      <button
        className="ghost-btn"
        title="Отчёт без ключей и адресов."
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              sanitizeDetails(
                JSON.stringify(
                  {
                    app: 'SportsDesk',
                    at: new Date().toISOString(),
                    backend,
                    resources,
                    screenErrors: getUiErrors(),
                  },
                  null,
                  2,
                ),
              ),
            );
            setMessage('Отчёт скопирован.');
          } catch {
            setMessage('Не удалось скопировать отчёт.');
          }
        }}
      >
        Скопировать отчёт
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
