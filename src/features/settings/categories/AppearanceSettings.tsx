import { useState } from 'react';
import { Field, Panel, PanelHeader, SegmentedControl } from '../../../kit';
import { getString, setString } from '../../football/storage';
import { useAtmosphere, writeAtmosphere, type MotionMode } from '../../atmosphere/atmosphereStore';

export function AppearanceSettings() {
  const [lightTheme, setLightTheme] = useState<boolean>(
    () => getString('sportsdesk.scheme') === 'light',
  );
  const [compactTables, setCompactTables] = useState<boolean>(
    () => getString('sportsdesk.density') === 'compact',
  );
  const atmosphere = useAtmosphere();

  const setAppearance = (scheme: 'light' | 'dark') => {
    setString('sportsdesk.scheme', scheme);
    setLightTheme(scheme === 'light');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  const setDensity = (density: 'default' | 'compact') => {
    setString('sportsdesk.density', density);
    setCompactTables(density === 'compact');
    window.dispatchEvent(new Event('sportsdesk-appearance-changed'));
  };

  return (
    <Panel>
      <PanelHeader title="Оформление" />
      <Field label="Тема">
        <SegmentedControl
          ariaLabel="Тема"
          value={lightTheme ? 'light' : 'dark'}
          onChange={(id) => setAppearance(id === 'light' ? 'light' : 'dark')}
          items={[
            { id: 'dark', label: 'Тёмная' },
            { id: 'light', label: 'Светлая' },
          ]}
        />
      </Field>
      <Field label="Плотность таблиц">
        <SegmentedControl
          ariaLabel="Плотность таблиц"
          value={compactTables ? 'compact' : 'default'}
          onChange={(id) => setDensity(id === 'compact' ? 'compact' : 'default')}
          items={[
            { id: 'default', label: 'Обычная' },
            { id: 'compact', label: 'Плотная' },
          ]}
        />
      </Field>
      <Field label="Движение">
        <SegmentedControl
          ariaLabel="Движение"
          value={atmosphere.motion}
          onChange={(id) => writeAtmosphere({ motion: id as MotionMode })}
          items={[
            { id: 'system', label: 'Как в системе' },
            { id: 'reduced', label: 'Спокойно' },
            { id: 'full', label: 'Полная' },
          ]}
        />
      </Field>
    </Panel>
  );
}
