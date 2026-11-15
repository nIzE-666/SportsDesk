import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Compass } from 'lucide-react';
import { isTauriRuntime } from '../../lib/bridge';
import { Button, Dialog } from '../../kit';
import { LEAGUES } from '../../lib/navigationMetadata';
import {
  CORE_MODULES,
  LEAGUE_MODULES,
  readModules,
  setModule,
  type ModuleId,
  type ModulesState,
} from '../../lib/modules';
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
  modules: 'Модули',
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
  const body = useRef<HTMLDivElement>(null);
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

  // Новый шаг начинается с заголовка, даже если предыдущий был выше.
  useEffect(() => {
    const dialog = body.current?.closest('.ui-dialog');
    if (dialog) dialog.scrollTop = 0;
  }, [step]);

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
    <Dialog
      open
      onClose={postpone}
      title={STEP_TITLES[step]}
      closeLabel="Отложить настройку"
      className="onboarding-card"
      footer={
        <div className="onboarding-actions">
          {index > 0 ? (
            <Button onClick={() => goTo(ONBOARDING_STEPS[index - 1]!)}>Назад</Button>
          ) : (
            <Button onClick={() => finish('skipped')}>Пропустить настройку</Button>
          )}
          <span className="onboarding-spacer" />
          {!last && index > 0 && (
            <Button onClick={() => finish('skipped')}>Пропустить остальное</Button>
          )}
          {last ? (
            <Button variant="primary" onClick={() => finish('completed')}>
              Готово
            </Button>
          ) : (
            <Button variant="primary" onClick={() => goTo(ONBOARDING_STEPS[index + 1]!)}>
              {index === 0 ? 'Начать' : 'Далее'}
            </Button>
          )}
        </div>
      }
    >
      <div className="onboarding-meta">
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
          <i
            style={
              {
                '--value': `${((index + 1) / ONBOARDING_STEPS.length) * 100}%`,
              } as CSSProperties
            }
          />
        </div>
      </div>
      <div className="onboarding-body" ref={body}>
        {step === 'welcome' && <WelcomeStep />}
        {step === 'football' && <FootballStep onLeagueChange={onLeagueChange} />}
        {step === 'f1' && <F1Step />}
        {step === 'modules' && <ModulesStep />}
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
      {origin === 'manual' && <p className="settings-note">Меняется только то, что вы выберете.</p>}
    </Dialog>
  );
}

function WelcomeStep() {
  return <p>Несколько шагов — любой можно пропустить и всё изменить позже в «Настройках».</p>;
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
        <FavoriteClubsEditor compact />
        <p className="muted small">
          Позже клубы можно менять в «Настройках → Избранное» или звёздочкой в «Матчах».
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
        <legend>Избранные команды</legend>
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
        <legend>Избранные пилоты</legend>
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
      <p className="muted small">
        Остальных пилотов можно отметить звёздочкой в «Зачётах» Формулы 1.
      </p>
    </>
  );
}

function ModulesStep() {
  const [modules, setModules] = useState<ModulesState>(() => readModules());
  const toggle = (id: ModuleId, enabled: boolean) => {
    setModules(setModule(id, enabled));
  };
  return (
    <>
      <p>Выключенное можно вернуть в «Настройках».</p>
      <div className="onboarding-modules">
        {CORE_MODULES.map((module) => (
          <label key={module.id} className="onboarding-module">
            <input
              type="checkbox"
              checked={modules[module.id]}
              onChange={(e) => toggle(module.id, e.target.checked)}
            />
            <span>
              <b>{module.label}</b>
              {module.description && <small>{module.description}</small>}
            </span>
          </label>
        ))}
      </div>
      <div className="onboarding-module-group" role="group" aria-label="Лиги">
        <h3 className="onboarding-module-title">Лиги</h3>
        <div className="onboarding-module-leagues">
          {LEAGUE_MODULES.map((module) => (
            <label key={module.id} className="onboarding-module">
              <input
                type="checkbox"
                checked={modules[module.id]}
                onChange={(e) => toggle(module.id, e.target.checked)}
              />
              <span>
                <b>{module.label}</b>
              </span>
            </label>
          ))}
        </div>
      </div>
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
        <Button onClick={() => choose(detected)}>Использовать системный: {detected}</Button>
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
          <strong>Напоминания о сессиях Формулы 1</strong>
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
        Футбол и Формула 1 работают сразу; расширенную статистику (по ключу) и онлайн-просмотр
        (после входа) можно подключить позже в «Настройках».
      </p>
      <div className="onboarding-actions">
        {onOpenSettings && <Button onClick={onOpenSettings}>Открыть настройки источников</Button>}
        {onOpenWatch && <Button onClick={onOpenWatch}>Открыть онлайн-просмотр</Button>}
      </div>
    </>
  );
}

export default FirstRunWizard;
