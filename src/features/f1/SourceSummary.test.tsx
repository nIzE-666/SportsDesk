// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SourceBar } from './shared';
import { SourceRefresh, SourceSummary, SourceSummaryProvider } from './SourceSummary';

it('combines sources and stale state, refreshes each current resource, and forgets unmounted resources', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const first = vi.fn(),
    second = vi.fn(),
    replacement = vi.fn();
  const render = (showSecond: boolean, refreshFirst: () => void, busy = false) => (
    <SourceSummaryProvider>
      <SourceRefresh />
      <SourceBar
        source="Jolpica"
        fetchedAt="2026-11-10T10:00:00Z"
        stale={false}
        onRefresh={refreshFirst}
        refreshing={busy}
      />
      {showSecond && (
        <SourceBar source="OpenF1" fetchedAt="2026-11-10T09:00:00Z" stale onRefresh={second} />
      )}
      <SourceSummary />
    </SourceSummaryProvider>
  );
  try {
    await act(async () => root.render(render(true, first)));
    expect(host.querySelectorAll('.f1-sourcebar')).toHaveLength(1);
    expect(host.textContent).toContain('Jolpica, OpenF1');
    expect(host.textContent).toContain('устаревшие');
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await act(async () => root.render(render(false, replacement)));
    expect(host.textContent).not.toContain('OpenF1');
    expect(host.textContent).not.toContain('устаревшие');
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await act(async () => root.render(render(false, replacement, true)));
    expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
