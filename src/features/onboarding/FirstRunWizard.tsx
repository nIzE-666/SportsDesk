import { useEffect, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import { DesignChooser } from '../../components/DesignChooser';
import { isTauriRuntime } from '../../lib/bridge';
import { useModalFocus } from '../../lib/useModalFocus';
import { LEAGUES } from '../../lib/navigationMetadata';
import { useFavoriteDrivers, useFavoriteTeams } from '../f1/useFavorites';
import { getString, isValidTimezone, setString, STORAGE_KEYS } from '../football/storage';
import { readNotificationsEnabled, writeNotificationsEnabled } from '../football/usePoller';
import {
  makeOnboardingState,
  ONBOARDING_STEPS,
  onboardingBootDecision,
  OPEN_ONBOARDING_EVENT,
  readOnboarding,
  writeOnboarding,
  type OnboardingOrigin,
  type OnboardingStep,
} from './onboarding';
import { FavoriteClubsEditor } from '../settings/FavoriteClubsEditor';
import './onboarding.css';

const STEP_TITLES: Record<OnboardingStep, string> = {
  welcome: 'Добро пожаловать в SportsDesk',
  football: 'Футбол',
  f1: 'Формула 1',
  timezone: 'Часовой пояс',
  notifications: 'Уведомления',
  appearance: 'Внешний вид',
  sources: 'Источники и просмотр',
};

export const WIZARD_F1_TEAMS: ReadonlyArray<[string, string]> = [
  ['red_bull', 'Red Bull'],
  ['mercedes', 'Mercedes'],
  ['ferrari', 'Ferrari'],
  ['mclaren', 'McLaren'],
  ['aston_martin', 'Aston Martin'],
  ['alpine', 'Alpine'],
  ['williams', 'Williams'],
  ['rb', 'Racing Bulls'],
  ['audi', 'Audi'],
  ['haas', 'Haas'],
  ['cadillac', 'Cadillac'],
];

export const WIZARD_F1_DRIVERS: ReadonlyArray<[string, string]> = [
  ['max_verstappen', 'Макс Ферстаппен'],
  ['hamilton', 'Льюис Хэмилтон'],
  ['leclerc', 'Шарль Леклер'],
  ['norris', 'Ландо Норрис'],
  ['piastri', 'Оскар Пиастри'],
  ['russell', 'Джордж Расселл'],
  ['antonelli', 'Андреа Кими Антонелли'],
  ['alonso', 'Фернандо Алонсо'],
  ['sainz', 'Карлос Сайнс'],
  ['albon', 'Александр Албон'],
  ['gasly', 'Пьер Гасли'],
  ['hulkenberg', 'Нико Хюлькенберг'],
];

const TIMEZONES = [
  'Asia/Yakutsk',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'UTC',
];

function systemTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}

async function notificationPermissionGranted(): Promise<boolean> {
  // Упакованное приложение доставляет уведомления нативно через Rust.
  if (isTauriRuntime()) return true;
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

interface FirstRunWizardProps {
  onLeagueChange?: (leagueId: string) => void;
  onOpenSettings?: () => void;
  onOpenWatch?: () => void;
}

export function FirstRunWizard({
  onLeagueChange,
  onOpenSettings,
  onOpenWatch,
}: FirstRunWizardProps) {
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(() => isTauriRuntime() && onboardingBootDecision().show);
  const [step, setStep] = useState<OnboardingStep>(() => onboardingBootDecision().step);
  const [origin, setOrigin] = useState<OnboardingOrigin>(() => readOnboarding()?.origin ?? 'new');

  const persist = (next: OnboardingStep, status: 'in_progress' | 'completed' | 'skipped') =>
    writeOnboarding(makeOnboardingState(status, next, origin));

  // «Отложить» сохраняет шаг: при следующем запуске мастер продолжится с него.
  const postpone = () => {
    persist(step, 'in_progress');
    setOpen(false);
  };
  useModalFocus(panel, open, postpone);

  useEffect(() => {
    const reopen = () => {
      setOrigin('manual');
      setStep('welcome');
      writeOnboarding(makeOnboardingState('in_progress', 'welcome', 'manual'));
      setOpen(true);
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, reopen);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, reopen);
  }, []);

  if (!open) return null;

  const index = ONBOARDING_STEPS.indexOf(step);
  const last = index === ONBOARDING_STEPS.length - 1;
  const goTo = (next: OnboardingStep) => {
    setStep(next);
    persist(next, 'in_progress');
  };
  const finish = (status: 'completed' | 'skipped') => {
    persist(step, status);
    setOpen(false);
  };
  const leave = (action?: () => void) => {
    finish('completed');
    action?.();
  };

  return (
    <div className="whatsnew-scrim onboarding-scrim">
      <section
        ref={panel}
        tabIndex={-1}
        className="panel whatsnew-card onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-label="Настройка SportsDesk"
      >
        <button
          className="icon-button modal-close"
          onClick={postpone}
          aria-label="Отложить настройку"
        >
          <X size={18} />
        </button>
        <span className="eyebrow">
          <Compass size={13} /> НАСТРОЙКА · ШАГ {index + 1} ИЗ {ONBOARDING_STEPS.length}
        </span>
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={ONBOARDING_STEPS.length}
          aria-valuenow={index + 1}
          aria-label="Прогресс настройки"
        >
          <i style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>
        <h2>{STEP_TITLES[step]}</h2>
        <div className="onboarding-body">
          {step === 'welcome' && <WelcomeStep />}
          {step === 'football' && <FootballStep onLeagueChange={onLeagueChange} />}
          {step === 'f1' && <F1Step />}
          {step === 'timezone' && <TimezoneStep />}
          {step === 'notifications' && <NotificationsStep />}
          {step === 'appearance' && <AppearanceStep />}
          {step === 'sources' && (
            <SourcesStep
              onOpenSettings={onOpenSettings ? () => leave(onOpenSettings) : undefined}
              onOpenWatch={onOpenWatch ? () => leave(onOpenWatch) : undefined}
            />
          )}
        </div>
        <div className="onboarding-actions">
          {index > 0 ? (
            <button className="ghost-btn" onClick={() => goTo(ONBOARDING_STEPS[index - 1]!)}>
              Назад
            </button>
          ) : (
            <button className="ghost-btn" onClick={() => finish('skipped')}>
              Пропустить настройку
            </button>
          )}
          <span className="onboarding-spacer" />
          {!last && index > 0 && (
            <button className="ghost-btn" onClick={() => finish('skipped')}>
              Пропустить остальное
            </button>
          )}
          {last ? (
            <button className="primary-btn" onClick={() => finish('completed')}>
              Готово
            </button>
          ) : (
            <button className="primary-btn" onClick={() => goTo(ONBOARDING_STEPS[index + 1]!)}>
              {index === 0 ? 'Начать' : 'Далее'}
            </button>
          )}
        </div>
        {origin === 'manual' && (
          <p className="settings-note">
            Текущие настройки сохраняются: мастер меняет только то, что вы выберете.
          </p>
        )}
      </section>
    </div>
  );
}

function WelcomeStep() {
  return (
    <>
      <p>
        Пара коротких шагов: лига, избранное в F1, часовой пояс, уведомления и внешний вид. Любой
        шаг можно пропустить, а настройки изменить позже в «Настройках».
      </p>
      <p className="muted small">
        Мастер работает без интернета. Если закрыть окно, при следующем запуске он продолжится с
        того же шага.
      </p>
    </>
  );
}

function FootballStep({ onLeagueChange }: { onLeagueChange?: (id: string) => void }) {
  const [league, setLeague] = useState(() => getString('sportsdesk.league') ?? LEAGUES[0].id);
  const choose = (id: string) => {
    setLeague(id);
    setString('sportsdesk.league', id);
    onLeagueChange?.(id);
  };
  return (
    <>
      <fieldset className="onboarding-choice">
        <legend>Основная лига — откроется первой</legend>
        <div className="onboarding-options">
          {LEAGUES.map((l) => (
            <label key={l.id} className={`onboarding-option ${league === l.id ? 'selected' : ''}`}>
              <input
                type="radio"
                name="onboarding-league"
                value={l.id}
                checked={league === l.id}
                onChange={() => choose(l.id)}
              />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <strong className="small">Отслеживаемые клубы</strong>
        <FavoriteClubsEditor compact />
        <p className="muted small">
          Позже клубы можно менять в «Настройки → Избранное» или звёздочкой в «Матчах» — изменения
          сразу попадут в планировщик и уведомления.
        </p>
      </div>
    </>
  );
}

function F1Step() {
  const [teams, toggleTeam] = useFavoriteTeams();
  const [drivers, toggleDriver] = useFavoriteDrivers();
  return (
    <>
      <fieldset className="onboarding-choice">
        <legend>Команды</legend>
        <div className="onboarding-options">
          {WIZARD_F1_TEAMS.map(([id, label]) => (
            <label key={id} className={`onboarding-option ${teams.includes(id) ? 'selected' : ''}`}>
              <input type="checkbox" checked={teams.includes(id)} onChange={() => toggleTeam(id)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="onboarding-choice">
        <legend>Пилоты</legend>
        <div className="onboarding-options">
          {WIZARD_F1_DRIVERS.map(([id, label]) => (
            <label
              key={id}
              className={`onboarding-option ${drivers.includes(id) ? 'selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={drivers.includes(id)}
                onChange={() => toggleDriver(id)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="muted small">Остальных пилотов можно отметить в разделе F1.</p>
    </>
  );
}

function TimezoneStep() {
  const detected = systemTimezone();
  const options = Array.from(new Set([...(detected ? [detected] : []), ...TIMEZONES]));
  const [timezone, setTimezone] = useState(
    () => getString(STORAGE_KEYS.timezone) ?? detected ?? 'Asia/Yakutsk',
  );
  const choose = (value: string) => {
    if (!isValidTimezone(value)) return;
    setTimezone(value);
    setString(STORAGE_KEYS.timezone, value);
  };
  return (
    <>
      <label className="onboarding-field">
        <span>Время матчей, сессий и тихих часов</span>
        <select value={timezone} onChange={(e) => choose(e.target.value)}>
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz === detected ? `${tz} (как в системе)` : tz}
            </option>
          ))}
        </select>
      </label>
      {detected && timezone !== detected && (
        <button className="ghost-btn" onClick={() => choose(detected)}>
          Использовать системный: {detected}
        </button>
      )}
    </>
  );
}

function NotificationsStep() {
  const [enabled, setEnabled] = useState(() => readNotificationsEnabled());
  const [f1, setF1] = useState(() => getString('sportsdesk.notifications.f1') !== '0');
  const [message, setMessage] = useState<string | null>(null);
  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      writeNotificationsEnabled(false);
      setMessage(null);
      return;
    }
    // Разрешение системы запрашивается только при включении.
    if (await notificationPermissionGranted()) {
      setEnabled(true);
      writeNotificationsEnabled(true);
      setMessage('Уведомления включены и работают, даже когда окно свёрнуто в трей.');
    } else {
      setMessage('Система не разрешила уведомления. Их можно включить позже в «Настройках».');
    }
  };
  return (
    <>
      <label className="onboarding-toggle">
        <input type="checkbox" checked={enabled} onChange={() => void toggle()} />
        <span>
          <strong>Голы, старт и итоги матчей избранных клубов</strong>
          <small>Подробности, тихие часы и отдельные команды — в «Настройках».</small>
        </span>
      </label>
      <label className="onboarding-toggle">
        <input
          type="checkbox"
          checked={f1}
          onChange={() => {
            const next = !f1;
            setF1(next);
            setString('sportsdesk.notifications.f1', next ? '1' : '0');
          }}
        />
        <span>
          <strong>Напоминания о сессиях F1</strong>
          <small>Работают, когда уведомления включены.</small>
        </span>
      </label>
      {message && (
        <p className="settings-note" role="status">
          {message}
        </p>
      )}
    </>
  );
}

function AppearanceStep() {
  const [scheme, setScheme] = useState<'dark' | 'light'>(() =>
    getString('sportsdesk.scheme') === 'light' ? 'light' : 'dark',
  );
  const choose = (value: 'dark' | 'light') => {
    setScheme(value);
    setString('sportsdesk.scheme', value);
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };
  return (
    <>
      <DesignChooser />
      <fieldset className="onboarding-choice">
        <legend>Тема</legend>
        <div className="onboarding-options">
          {(
            [
              ['dark', 'Тёмная'],
              ['light', 'Светлая'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`onboarding-option ${scheme === value ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="onboarding-scheme"
                checked={scheme === value}
                onChange={() => choose(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function SourcesStep({
  onOpenSettings,
  onOpenWatch,
}: {
  onOpenSettings?: () => void;
  onOpenWatch?: () => void;
}) {
  return (
    <>
      <p>
        Футбол и F1 работают сразу. Ключ PitchAPI добавляет расширенную статистику, а вход в KinoPub
        — онлайн-просмотр. Оба шага необязательны и доступны в «Настройках» в любой момент.
      </p>
      <div className="onboarding-actions">
        {onOpenSettings && (
          <button className="ghost-btn" onClick={onOpenSettings}>
            Открыть настройки источников
          </button>
        )}
        {onOpenWatch && (
          <button className="ghost-btn" onClick={onOpenWatch}>
            Перейти к просмотру
          </button>
        )}
      </div>
    </>
  );
}

export default FirstRunWizard;
