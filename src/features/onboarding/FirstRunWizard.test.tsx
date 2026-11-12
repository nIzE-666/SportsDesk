// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasExistingProfile,
  makeOnboardingState,
  ONBOARDING_KEY,
  openFirstRunWizard,
  parseOnboarding,
  readOnboarding,
  resolveInitialOnboarding,
} from './onboarding';
import { FirstRunWizard } from './FirstRunWizard';

vi.mock('../../lib/bridge', () => ({ rpc: vi.fn(), notify: vi.fn(), isTauriRuntime: () => false }));
vi.mock('../../components/DesignChooser', () => ({ DesignChooser: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-11-09T07:00:00Z');

describe('onboarding state', () => {
  it('parses only valid versioned state', () => {
    const state = makeOnboardingState('in_progress', 'timezone', 'new', NOW);
    expect(parseOnboarding(JSON.stringify(state))).toEqual(state);
    expect(parseOnboarding(null)).toBeNull();
    expect(parseOnboarding('{broken')).toBeNull();
    expect(parseOnboarding(JSON.stringify({ ...state, version: 2 }))).toBeNull();
    expect(parseOnboarding(JSON.stringify({ ...state, step: 'teleport' }))).toBeNull();
    expect(parseOnboarding(JSON.stringify({ ...state, status: 'maybe' }))).toBeNull();
  });

  it('detects an existing profile by any SportsDesk key except its own', () => {
    expect(hasExistingProfile([])).toBe(false);
    expect(hasExistingProfile(['other.app', ONBOARDING_KEY])).toBe(false);
    expect(hasExistingProfile(['sportsdesk.timezone'])).toBe(true);
  });

  it('shows on a fresh install and never on an upgraded one', () => {
    expect(resolveInitialOnboarding(null, false, NOW)).toEqual({
      show: true,
      step: 'welcome',
      persist: null,
    });
    const upgraded = resolveInitialOnboarding(null, true, NOW);
    expect(upgraded.show).toBe(false);
    expect(upgraded.persist).toMatchObject({ status: 'completed', origin: 'existing' });
  });

  it('resumes an unfinished wizard and stays closed once finished or skipped', () => {
    const resumed = resolveInitialOnboarding(
      makeOnboardingState('in_progress', 'notifications', 'new', NOW),
      true,
      NOW,
    );
    expect(resumed).toMatchObject({ show: true, step: 'notifications', persist: null });
    for (const status of ['completed', 'skipped'] as const) {
      const decision = resolveInitialOnboarding(
        makeOnboardingState(status, 'f1', 'new', NOW),
        false,
      );
      expect(decision.show).toBe(false);
    }
  });
});

describe('FirstRunWizard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  const click = (el: Element | undefined | null) => {
    expect(el).toBeTruthy();
    act(() => (el as HTMLElement).click());
  };
  const openWizard = (props: Parameters<typeof FirstRunWizard>[0] = {}) => {
    act(() => root.render(<FirstRunWizard {...props} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => openFirstRunWizard());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  };

  it('opens from settings, saves the step and resumes after postponing', () => {
    openWizard();
    click(button('Начать'));
    expect(readOnboarding()).toMatchObject({
      status: 'in_progress',
      step: 'football',
      origin: 'manual',
    });
    click(host.querySelector('[aria-label="Отложить настройку"]'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(readOnboarding()?.status).toBe('in_progress');
  });

  it('writes the main league and the timezone', () => {
    const onLeagueChange = vi.fn();
    openWizard({ onLeagueChange });
    click(button('Начать'));
    const laliga = host.querySelector<HTMLInputElement>('input[value="l_0ErfuF"]');
    click(laliga);
    expect(localStorage.getItem('sportsdesk.league')).toBe('l_0ErfuF');
    expect(onLeagueChange).toHaveBeenCalledWith('l_0ErfuF');
    click(button('Далее'));
    click(button('Далее'));
    const select = host.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'Europe/Moscow';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(localStorage.getItem('sportsdesk.timezone')).toBe('Europe/Moscow');
  });

  it('marks the wizard skipped without touching other settings', () => {
    localStorage.setItem('sportsdesk.timezone', 'Europe/London');
    openWizard();
    click(button('Пропустить настройку'));
    expect(readOnboarding()?.status).toBe('skipped');
    expect(localStorage.getItem('sportsdesk.timezone')).toBe('Europe/London');
  });

  it('asks for notification permission only when enabling', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    localStorage.setItem('sportsdesk.notifications.enabled', '0');
    openWizard();
    for (let i = 0; i < 4; i++) click(button(i === 0 ? 'Начать' : 'Далее'));
    expect(requestPermission).not.toHaveBeenCalled();
    const toggle = host.querySelector<HTMLInputElement>('.onboarding-toggle input');
    await act(async () => {
      toggle!.click();
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sportsdesk.notifications.enabled')).toBe('1');
    await act(async () => {
      host.querySelector<HTMLInputElement>('.onboarding-toggle input')!.click();
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sportsdesk.notifications.enabled')).toBe('0');
    vi.unstubAllGlobals();
  });

  it('speaks plainly on every step: no source names, no internals, one sentence to start and end', () => {
    openWizard();
    const steps: string[] = [];
    for (let i = 0; i < 7; i++) {
      steps.push(host.querySelector('.onboarding-card')?.textContent ?? '');
      if (i === 0 || i === 6)
        expect(host.querySelectorAll('.onboarding-body > p'), `step ${i + 1}`).toHaveLength(1);
      if (i < 6) click(button(i === 0 ? 'Начать' : 'Далее'));
    }
    expect(steps).toHaveLength(7);
    for (const text of steps)
      expect(text).not.toMatch(
        /PitchAPI|KinoPub|Jolpica|OpenF1|SportScore|Rust|SQLite|DPAPI|localStorage|бандл|кеш|токен|провайдер|мастер|отслеживаем/i,
      );
  });

  it('finishes on the last step', () => {
    const onOpenSettings = vi.fn();
    openWizard({ onOpenSettings });
    for (let i = 0; i < 6; i++) click(button(i === 0 ? 'Начать' : 'Далее'));
    click(button('Открыть настройки источников'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(readOnboarding()?.status).toBe('completed');
  });
});
