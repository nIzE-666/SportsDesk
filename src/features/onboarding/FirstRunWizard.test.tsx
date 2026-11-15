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
  resetOnboardingBootDecision,
  resolveInitialOnboarding,
} from './onboarding';
import { FirstRunWizard } from './FirstRunWizard';
import { WhatsNewDialog } from '../../components/WhatsNewDialog';
import {
  CORE_MODULES,
  LEAGUE_MODULES,
  MODULES_KEY,
  parseModules,
  readModules,
} from '../../lib/modules';

const runtime = vi.hoisted(() => ({ tauri: false }));
const appInfo = vi.hoisted(() => ({ version: '2.0.0' }));

vi.mock('../../lib/bridge', () => ({
  rpc: vi.fn(),
  notify: vi.fn(),
  isTauriRuntime: () => runtime.tauri,
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => appInfo.version) }));

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
    runtime.tauri = false;
    resetOnboardingBootDecision();
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
  const moduleCheckbox = (label: string, scope: ParentNode = host) =>
    Array.from(scope.querySelectorAll('label'))
      .find((item) => item.textContent?.includes(label))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const toModules = () => {
    click(button('Начать'));
    click(button('Далее'));
    click(button('Далее'));
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
    const laliga = Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]')).find(
      (item) => item.textContent?.trim() === 'Ла Лига',
    );
    click(laliga);
    expect(localStorage.getItem('sportsdesk.league')).toBe('l_0ErfuF');
    expect(onLeagueChange).toHaveBeenCalledWith('l_0ErfuF');
    click(button('Далее'));
    click(button('Далее'));
    click(button('Далее'));
    const select = host.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'Europe/Moscow';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(localStorage.getItem('sportsdesk.timezone')).toBe('Europe/Moscow');
  });

  it('shows the module switches on by default and writes nothing', () => {
    openWizard();
    toModules();
    expect(host.querySelector('.onboarding-card h2')?.textContent).toBe('Модули');
    const core = host.querySelector('.onboarding-modules');
    const leagues = host.querySelector('[role="group"][aria-label="Лиги"]');
    expect(core).not.toBeNull();
    expect(leagues).not.toBeNull();
    expect(leagues?.querySelector('h3')?.textContent).toBe('Лиги');
    for (const module of CORE_MODULES)
      expect(moduleCheckbox(module.label, core!)?.checked, module.label).toBe(true);
    for (const module of LEAGUE_MODULES)
      expect(moduleCheckbox(module.label, leagues!)?.checked, module.label).toBe(true);
    expect(localStorage.getItem(MODULES_KEY)).toBeNull();
  });

  it('writes the module switches only after a change', () => {
    openWizard();
    toModules();
    click(moduleCheckbox('Просмотр', host.querySelector('.onboarding-modules')!));
    const stored = parseModules(JSON.parse(localStorage.getItem(MODULES_KEY)!));
    expect(stored).toMatchObject({ watch: false, europe: true });
    click(button('Далее'));
    expect(readModules().watch).toBe(false);
  });

  it('leaves the modules key alone when advanced or skipped unchanged', () => {
    openWizard();
    toModules();
    click(button('Далее'));
    expect(readOnboarding()?.step).toBe('timezone');
    expect(localStorage.getItem(MODULES_KEY)).toBeNull();
    click(button('Назад'));
    click(button('Пропустить остальное'));
    expect(readOnboarding()?.status).toBe('skipped');
    expect(localStorage.getItem(MODULES_KEY)).toBeNull();
  });

  it('resumes on the module step with the chosen switches', () => {
    openWizard();
    toModules();
    click(moduleCheckbox('Просмотр', host.querySelector('.onboarding-modules')!));
    click(host.querySelector('[aria-label="Отложить настройку"]'));
    expect(readOnboarding()).toMatchObject({ status: 'in_progress', step: 'modules' });

    act(() => root.unmount());
    runtime.tauri = true;
    resetOnboardingBootDecision();
    root = createRoot(host);
    act(() => root.render(<FirstRunWizard />));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('.onboarding-card h2')?.textContent).toBe('Модули');
    expect(moduleCheckbox('Просмотр', host.querySelector('.onboarding-modules')!)?.checked).toBe(
      false,
    );
  });

  it('marks the wizard skipped without touching other settings', () => {
    localStorage.setItem('sportsdesk.timezone', 'Europe/London');
    openWizard();
    click(button('Пропустить настройку'));
    expect(readOnboarding()?.status).toBe('skipped');
    expect(localStorage.getItem('sportsdesk.timezone')).toBe('Europe/London');
  });

  it('asks for notification permission only when enabling and greys the F1 switch until then', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    localStorage.setItem('sportsdesk.notifications.enabled', '0');
    openWizard();
    for (let i = 0; i < 5; i++) click(button(i === 0 ? 'Начать' : 'Далее'));
    expect(requestPermission).not.toHaveBeenCalled();
    const toggle = host.querySelector<HTMLInputElement>('.onboarding-toggle input');
    const f1 = host.querySelectorAll<HTMLInputElement>('.onboarding-toggle input')[1]!;
    expect(f1.checked).toBe(true);
    expect(f1.disabled).toBe(true);
    await act(async () => {
      toggle!.click();
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sportsdesk.notifications.enabled')).toBe('1');
    expect(f1.checked).toBe(true);
    expect(f1.disabled).toBe(false);
    await act(async () => {
      host.querySelector<HTMLInputElement>('.onboarding-toggle input')!.click();
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('sportsdesk.notifications.enabled')).toBe('0');
    expect(f1.checked).toBe(true);
    expect(f1.disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it('speaks plainly on every step: no source names, no internals, one sentence to start and end', () => {
    openWizard();
    const steps: string[] = [];
    for (let i = 0; i < 8; i++) {
      steps.push(host.querySelector('.onboarding-card')?.textContent ?? '');
      if (i === 0 || i === 7)
        expect(host.querySelectorAll('.onboarding-body > p'), `step ${i + 1}`).toHaveLength(1);
      if (i < 7) click(button(i === 0 ? 'Начать' : 'Далее'));
    }
    expect(steps).toHaveLength(8);
    for (const text of steps)
      expect(text).not.toMatch(
        /PitchAPI|KinoPub|Jolpica|OpenF1|SportScore|Rust|SQLite|DPAPI|localStorage|бандл|кеш|токен|провайдер|мастер|отслеживаем/i,
      );
  });

  it('finishes on the last step', () => {
    const onOpenSettings = vi.fn();
    openWizard({ onOpenSettings });
    for (let i = 0; i < 7; i++) click(button(i === 0 ? 'Начать' : 'Далее'));
    click(button('Открыть настройки источников'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(readOnboarding()?.status).toBe('completed');
  });
});

describe('WhatsNewDialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_KEY,
      JSON.stringify(makeOnboardingState('completed', 'welcome', 'existing', NOW)),
    );
    resetOnboardingBootDecision();
    runtime.tauri = true;
    appInfo.version = '2.0.0';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    runtime.tauri = false;
  });

  // The version arrives through a dynamic import, so give the effect a few turns.
  const renderDialog = async () => {
    act(() => root.render(<WhatsNewDialog />));
    for (let turn = 0; turn < 20 && !host.querySelector('[role="dialog"]'); turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    return host.querySelector('[role="dialog"]');
  };

  it('does not show the 2.0.0 entry while the version is 1.8.0', async () => {
    appInfo.version = '1.8.0';
    const dialog = await renderDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains('ui-dialog')).toBe(true);
    expect(dialog?.textContent).toContain('SportsDesk 1.8.0');
    expect(dialog?.textContent).not.toContain('2.0.0');
    expect(dialog?.textContent).not.toContain('Пять разделов');
  });

  it('shows the 2.0.0 entry on version 2.0.0', async () => {
    const dialog = await renderDialog();
    expect(dialog?.classList.contains('ui-dialog')).toBe(true);
    expect(dialog?.textContent).toContain('SportsDesk 2.0.0');
    expect(dialog?.textContent).toContain('Пять разделов');
    expect(dialog?.textContent).toContain('LiveScore');
  });
});
