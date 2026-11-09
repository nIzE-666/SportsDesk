import { getString, setString } from '../football/storage';

/**
 * Мастер первого запуска: версионированное состояние прохождения.
 * Существующий профиль никогда не перезаписывается — мастер для него
 * автоматически не показывается.
 */

export const ONBOARDING_KEY = 'sportsdesk.onboarding';
export const OPEN_ONBOARDING_EVENT = 'sportsdesk-open-onboarding';

export const ONBOARDING_STEPS = [
  'welcome',
  'football',
  'f1',
  'timezone',
  'notifications',
  'appearance',
  'sources',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus = 'in_progress' | 'completed' | 'skipped';
export type OnboardingOrigin = 'new' | 'existing' | 'manual';

export interface OnboardingState {
  version: 1;
  status: OnboardingStatus;
  step: OnboardingStep;
  origin: OnboardingOrigin;
  updatedAt: string;
}

const STATUSES: readonly OnboardingStatus[] = ['in_progress', 'completed', 'skipped'];
const ORIGINS: readonly OnboardingOrigin[] = ['new', 'existing', 'manual'];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/** Неизвестная версия или повреждённые данные считаются отсутствием состояния. */
export function parseOnboarding(raw: string | null): OnboardingState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!value || typeof value !== 'object' || value.version !== 1) return null;
    if (!STATUSES.includes(value.status as OnboardingStatus)) return null;
    if (!isOnboardingStep(value.step)) return null;
    const origin = ORIGINS.includes(value.origin as OnboardingOrigin)
      ? (value.origin as OnboardingOrigin)
      : 'new';
    return {
      version: 1,
      status: value.status as OnboardingStatus,
      step: value.step,
      origin,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function makeOnboardingState(
  status: OnboardingStatus,
  step: OnboardingStep,
  origin: OnboardingOrigin,
  now: Date = new Date(),
): OnboardingState {
  return { version: 1, status, step, origin, updatedAt: now.toISOString() };
}

export function readOnboarding(): OnboardingState | null {
  return parseOnboarding(getString(ONBOARDING_KEY));
}

export function writeOnboarding(state: OnboardingState): void {
  setString(ONBOARDING_KEY, JSON.stringify(state));
}

/** Любая настройка SportsDesk, кроме самого мастера, означает существующую установку. */
export function hasExistingProfile(keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (key.startsWith('sportsdesk.') && key !== ONBOARDING_KEY) return true;
  }
  return false;
}

export interface OnboardingDecision {
  show: boolean;
  step: OnboardingStep;
  /** Состояние, которое нужно сохранить сразу (обновление старой установки). */
  persist: OnboardingState | null;
}

export function resolveInitialOnboarding(
  stored: OnboardingState | null,
  existingProfile: boolean,
  now: Date = new Date(),
): OnboardingDecision {
  if (stored) {
    return {
      show: stored.status === 'in_progress',
      step: stored.status === 'in_progress' ? stored.step : 'welcome',
      persist: null,
    };
  }
  if (existingProfile) {
    return {
      show: false,
      step: 'welcome',
      persist: makeOnboardingState('completed', 'welcome', 'existing', now),
    };
  }
  return { show: true, step: 'welcome', persist: null };
}

function storageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
  } catch {
    /* хранилище недоступно */
  }
  return keys;
}

let bootDecision: OnboardingDecision | null = null;

/**
 * Решение принимается один раз при первом обращении — до того, как
 * остальные экраны успеют записать свои настройки по умолчанию.
 */
export function onboardingBootDecision(): OnboardingDecision {
  if (bootDecision) return bootDecision;
  const decision = resolveInitialOnboarding(readOnboarding(), hasExistingProfile(storageKeys()));
  if (decision.persist) writeOnboarding(decision.persist);
  bootDecision = decision;
  return decision;
}

/** Только для тестов. */
export function resetOnboardingBootDecision(): void {
  bootDecision = null;
}

export function openFirstRunWizard(): void {
  window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT));
}

if (typeof window !== 'undefined') onboardingBootDecision();
