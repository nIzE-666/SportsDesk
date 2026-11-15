import { useRef } from 'react';
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

import { useModalFocus } from '../../lib/useModalFocus';
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
    <div className="watch-auth-card">
      <div className="watch-auth-head">
        <span className="watch-auth-icon">
          <Tv size={22} aria-hidden />
        </span>
        <div>
          <h2>Подключить Kino</h2>
          <p className="watch-muted">Вход по коду устройства, без пароля.</p>
        </div>
      </div>

      {phase.kind === 'idle' && (
        <div className="watch-auth-body">
          <button type="button" className="watch-btn watch-btn-primary" onClick={onStart}>
            <Signal size={16} aria-hidden /> Подключить устройство
          </button>
          <button
            type="button"
            className="watch-btn watch-btn-ghost"
            onClick={() => onOpenSite('https://kino.watch/tv/view/okkofootball')}
          >
            <MonitorPlay size={16} aria-hidden /> Открыть в браузере
          </button>
        </div>
      )}

      {phase.kind === 'starting' && (
        <div className="watch-auth-body watch-row-center">
          <Loader2 size={18} className="watch-spin" aria-hidden />
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
            <button
              type="button"
              className="watch-btn watch-btn-primary"
              onClick={() => onOpenSite(phase.data.verificationUri)}
            >
              <ExternalLink size={16} aria-hidden /> Открыть страницу подтверждения
            </button>
            <span className="watch-timer">Осталось {formatRemaining(phase.remaining)}</span>
          </div>
          <div className="watch-auth-status watch-row-center">
            <Loader2 size={16} className="watch-spin" aria-hidden />
            Ожидаем подтверждение на сайте…
          </div>
          <button type="button" className="watch-btn watch-btn-ghost" onClick={onCancel}>
            <X size={16} aria-hidden /> Отменить
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="watch-auth-body">
          <div className="watch-inline-error">
            <AlertTriangle size={16} aria-hidden />
            <span>{phase.message}</span>
          </div>
          <button type="button" className="watch-btn watch-btn-primary" onClick={onStart}>
            <RefreshCw size={16} aria-hidden /> Попробовать снова
          </button>
        </div>
      )}
    </div>
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
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true, onCancel);
  return (
    <div
      className="watch-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Выйти из аккаунта"
    >
      <div ref={panel} className="watch-modal">
        <h3>Выйти из Kino в SportsDesk?</h3>
        <p className="watch-muted">Сессии в браузере и на телевизоре не затрагиваются.</p>
        <div className="watch-modal-actions">
          <button
            type="button"
            className="watch-btn watch-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Отмена
          </button>
          <button
            type="button"
            className="watch-btn watch-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={15} className="watch-spin" aria-hidden />
            ) : (
              <LogOut size={15} aria-hidden />
            )}
            Выйти
          </button>
        </div>
      </div>
    </div>
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
