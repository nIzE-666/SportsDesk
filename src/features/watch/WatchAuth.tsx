import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  LogOut,
  MonitorPlay,
  RefreshCw,
  Signal,
  Tv,
  X,
} from 'lucide-react';

import { Button, Dialog, Panel } from '../../kit';
import type { AuthPhase } from './watchShared';
import { formatRemaining } from './watchShared';
export function SplitAuthPanel({
  phase,
  onStart,
  onCancel,
  onOpenSite,
}: {
  phase: AuthPhase;
  onStart: () => void;
  onCancel: () => void;
  onOpenSite: (url: string) => void;
}) {
  return (
    <Panel className="watch-auth-card">
      <div className="watch-auth-head">
        <span className="watch-auth-icon">
          <Tv size={22} aria-hidden />
        </span>
        <div>
          <h2 className="ui-section-title">Подключить Kino</h2>
          <p className="watch-muted">Вход по коду устройства, без пароля.</p>
        </div>
      </div>

      {phase.kind === 'idle' && (
        <div className="watch-auth-body">
          <Button variant="primary" icon={<Signal size={16} aria-hidden />} onClick={onStart}>
            Подключить устройство
          </Button>
          <Button
            icon={<MonitorPlay size={16} aria-hidden />}
            onClick={() => onOpenSite('https://kino.watch/tv/view/okkofootball')}
          >
            Открыть в браузере
          </Button>
        </div>
      )}

      {phase.kind === 'starting' && (
        <div className="watch-auth-body watch-row-center">
          <Loader2 size={18} className="spin" aria-hidden />
          <span>Запрашиваем код у сервиса…</span>
        </div>
      )}

      {phase.kind === 'waiting' && (
        <div className="watch-auth-body">
          <div className="watch-code-block">
            <span className="watch-code-label">Код подтверждения</span>
            <span className="watch-code" aria-live="polite">
              {phase.data.userCode}
            </span>
          </div>
          <div className="watch-auth-actions">
            <Button
              variant="primary"
              icon={<ExternalLink size={16} aria-hidden />}
              onClick={() => onOpenSite(phase.data.verificationUri)}
            >
              Открыть страницу подтверждения
            </Button>
            <span className="watch-timer">Осталось {formatRemaining(phase.remaining)}</span>
          </div>
          <div className="watch-auth-status watch-row-center">
            <Loader2 size={16} className="spin" aria-hidden />
            Ожидаем подтверждение на сайте…
          </div>
          <Button icon={<X size={16} aria-hidden />} onClick={onCancel}>
            Отменить
          </Button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="watch-auth-body">
          <div className="watch-inline-error">
            <AlertTriangle size={16} aria-hidden />
            <span>{phase.message}</span>
          </div>
          <Button variant="primary" icon={<RefreshCw size={16} aria-hidden />} onClick={onStart}>
            Попробовать снова
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Channel list
// ---------------------------------------------------------------------------

export function LogoutConfirm({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Выйти из Kino в SportsDesk?"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="primary"
            danger
            busy={busy}
            icon={<LogOut size={15} aria-hidden />}
            onClick={onConfirm}
          >
            Выйти
          </Button>
        </>
      }
    >
      <p>Сессии в браузере и на телевизоре не затрагиваются.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main exported view
// ---------------------------------------------------------------------------

type AccountState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in' }
  | { kind: 'error'; message: string };
