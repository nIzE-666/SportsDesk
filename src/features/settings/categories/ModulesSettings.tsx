import { Disclosure, Panel, Switch } from '../../../kit';
import {
  CORE_MODULES,
  LEAGUE_MODULES,
  setModule,
  useModules,
  type ModuleId,
} from '../../../lib/modules';
import { AtmosphereSettings } from '../../atmosphere/AtmosphereSettings';

export function ModulesSettings() {
  const modules = useModules();
  return (
    <Panel aria-label="Модули">
      <p className="settings-note settings-category-hint">Данные при выключении сохраняются.</p>
      <div className="module-switches">
        {CORE_MODULES.map((module) => (
          <ModuleSwitch
            key={module.id}
            id={module.id}
            label={module.label}
            description={module.description}
            checked={modules[module.id]}
          />
        ))}
      </div>
      <div className="module-group" role="group" aria-label="Лиги">
        <h3 className="module-group-title">Лиги</h3>
        <div className="module-switches">
          {LEAGUE_MODULES.map((module) => (
            <ModuleSwitch
              key={module.id}
              id={module.id}
              label={module.label}
              checked={modules[module.id]}
            />
          ))}
        </div>
      </div>
      {modules.atmosphere && (
        <Disclosure label="Эффекты и звуки" className="module-options">
          <AtmosphereSettings />
        </Disclosure>
      )}
    </Panel>
  );
}

function ModuleSwitch({
  id,
  label,
  description,
  checked,
}: {
  id: ModuleId;
  label: string;
  description?: string;
  checked: boolean;
}) {
  return (
    <Switch
      className="module-switch"
      label={label}
      description={description || undefined}
      checked={checked}
      onChange={(enabled) => setModule(id, enabled)}
    />
  );
}
