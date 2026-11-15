import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Tv } from 'lucide-react';
import { rpc, openExternal } from '../../../lib/bridge';
import { Badge, Button, Panel, PanelHeader } from '../../../kit';
import {
  beginKinoAttempt,
  cancelKinoAttempt,
  finishKinoAttempt,
  isCurrentKinoAttempt,
  logoutKinoSession,
  settleKinoCancellations,
} from '../../watch/kinoAuth';

interface SecretStatus {
  pitch: boolean;
  kino: boolean;
  kinoClient: boolean;
}

export function WatchSettings() {
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
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

  const kinoReady = secretStatus?.kino === true;
  const kinoClientReady = secretStatus?.kinoClient === true;
  const showKinoClientForm = secretStatus !== null && (!kinoClientReady || kinoClientEditing);

  return (
    <Panel className="settings-section">
      <PanelHeader
        title={
          <>
            <Tv size={16} aria-hidden /> Kino (KinoWatch)
          </>
        }
        action={
          <Badge>
            {secretError
              ? 'Статус неизвестен'
              : !secretStatus
                ? 'Проверяем…'
                : kinoReady
                  ? 'Авторизован'
                  : 'Не авторизован'}
          </Badge>
        }
      />
      <p className="muted small">Вход по коду устройства.</p>
      {secretError && <p className="settings-note">Не удалось проверить вход: {secretError}.</p>}
      {showKinoClientForm && (
        <Panel className="kino-client">
          <p className="muted small">
            {kinoClientReady
              ? 'Сохранённые значения не показываются.'
              : 'Сначала данные клиента KinoPub.'}
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
            <Button onClick={() => void saveKinoClient()} busy={kinoClientBusy}>
              Сохранить настройки KinoPub
            </Button>
            {kinoClientReady && (
              <Button onClick={() => setKinoClientEditing(false)} disabled={kinoClientBusy}>
                Отмена
              </Button>
            )}
          </div>
        </Panel>
      )}
      {kinoClientMessage && <p className="settings-note">{kinoClientMessage}</p>}
      {kinoDevice ? (
        <Panel className="kino-device">
          <p>
            Код устройства: <strong className="kino-code">{kinoDevice.userCode}</strong>
          </p>
          <p className="muted small">
            Код действует примерно {Math.max(0, Math.round(kinoDevice.expiresIn / 60))} мин.
          </p>
          <div className="settings-actions">
            <Button
              icon={<Link2 size={14} />}
              onClick={() => void openExternal(kinoDevice.verificationUri).catch(() => undefined)}
            >
              Открыть страницу авторизации
            </Button>
            {kinoPolling && <Button onClick={stopKinoPolling}>Остановить ожидание</Button>}
          </div>
          {kinoPolling && <p className="muted small">Ожидание подтверждения…</p>}
        </Panel>
      ) : (
        <div className="settings-actions">
          <Button
            onClick={startKinoAuth}
            disabled={kinoBusy || kinoReady || !kinoClientReady}
            busy={kinoBusy}
          >
            Войти по коду устройства
          </Button>
          {kinoClientReady && !kinoClientEditing && (
            <Button
              onClick={() => {
                setKinoClientMessage(null);
                setKinoClientEditing(true);
              }}
              disabled={kinoBusy}
            >
              Изменить настройки клиента
            </Button>
          )}
          {kinoReady && (
            <Button onClick={logoutKino} disabled={kinoBusy}>
              Выйти из Kino в SportsDesk
            </Button>
          )}
        </div>
      )}
      {kinoMessage && <p className="settings-note">{kinoMessage}</p>}
    </Panel>
  );
}
