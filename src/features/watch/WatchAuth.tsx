import { AlertTriangle, ExternalLink, Loader2, LogOut, RefreshCw, Signal } from 'lucide-react';

import { Button, Dialog } from '../../kit';
import type { AuthPhase } from './watchShared';
import { formatRemaining } from './watchShared';

/** Device-code sign-in: one kit dialog over the signed-out screen. */
export function AuthDialog({
  open,
  phase,
  onClose,
  onStart,
  onCancel,
  onOpenSite,
}: {
  open: boolean;
  phase: AuthPhase;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
  onOpenSite: (url: string) => void;
}) {
  const footer =
    phase.kind === 'waiting' || phase.kind === 'starting' ? (
      <Button onClick={onCancel}>Отменить</Button>
    ) : phase.kind === 'error' ? (
      <Button onClick={onClose}>Закрыть</Button>
    ) : undefined;

  return (
    <Dialog open={open} onClose={onClose} title="Подключение Kino" footer={footer}>
      <div className="watch-auth-body">
        {phase.kind === 'idle' && (
          <>
            <p className="watch-muted">Вход по коду устройства, без пароля.</p>
            <Button variant="primary" icon={<Signal size={16} aria-hidden />} onClick={onStart}>
              Подключить устройство
            </Button>
          </>
        )}

        {phase.kind === 'starting' && (
          <div className="watch-row-center">
            <Loader2 size={18} className="spin" aria-hidden />
            <span>Запрашиваем код у сервиса…</span>
          </div>
        )}

        {phase.kind === 'waiting' && (
          <>
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
            <div className="watch-auth-status watch-row-center" role="status">
              <Loader2 size={16} className="spin" aria-hidden />
              Ожидаем подтверждение на сайте…
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <div className="watch-inline-error" role="alert">
              <AlertTriangle size={16} aria-hidden />
              <span>{phase.message}</span>
            </div>
            <Button variant="primary" icon={<RefreshCw size={16} aria-hidden />} onClick={onStart}>
              Попробовать снова
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Logout confirm
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
