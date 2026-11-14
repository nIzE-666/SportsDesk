import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Radio } from 'lucide-react';
import { rpc } from '../../../lib/bridge';
import {
  LIVE_SOURCE_KEY,
  readLiveSourceChoice,
  type LiveSourceChoice,
} from '../../football/liveData';
import { setString } from '../../football/storage';
import { DiagnosticsPanel } from '../DiagnosticsPanel';

interface SecretStatus {
  pitch: boolean;
  kino: boolean;
  kinoClient: boolean;
}

export function SourcesSettings() {
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [liveSource, setLiveSource] = useState<LiveSourceChoice>(() => readLiveSourceChoice());
  const mounted = useRef(true);
  const chooseLiveSource = (value: LiveSourceChoice) => {
    setLiveSource(value);
    setString(LIVE_SOURCE_KEY, value);
  };

  const refreshSecret = useCallback(async () => {
    try {
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

  const pitchReady = secretStatus?.pitch === true;

  return (
    <>
      <p className="muted small settings-category-hint">
        Ключи хранятся в зашифрованном виде и не входят в резервные копии.
      </p>

      <section className="panel settings-section">
        <div className="section-title">
          <h3>
            <KeyRound size={15} /> PitchAPI
          </h3>
          <span className="chip">
            {!secretStatus && !secretError
              ? 'Проверяем…'
              : pitchReady
                ? 'Ключ сохранён'
                : 'Ключ не задан'}
          </span>
        </div>
        <p className="muted small">Ключ нужен для данных PitchAPI.</p>
        {secretError && (
          <div className="settings-warn">
            Не удалось проверить ключи: {secretError}. Проверьте, что приложение Windows запущено.
          </div>
        )}
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
          <h3>
            <Radio size={15} /> Живые матчи
          </h3>
        </div>
        <div className="settings-row">
          <label htmlFor="live-source" className="muted small">
            Источник
          </label>
          <select
            id="live-source"
            value={liveSource}
            onChange={(event) => chooseLiveSource(event.target.value as LiveSourceChoice)}
          >
            <option value="auto">Авто (LiveScore, при сбое ESPN)</option>
            <option value="livescore">Только LiveScore</option>
            <option value="espn">Только ESPN</option>
          </select>
        </div>
        <p className="muted small">LiveScore и ESPN — неофициальные бесплатные источники.</p>
      </section>

      <DiagnosticsPanel />

      <section className="panel settings-section">
        <details className="settings-limits">
          <summary>Ограничения источников</summary>
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
        </details>
      </section>
    </>
  );
}
