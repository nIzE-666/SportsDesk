import { useShellPreview, writeShellPreview } from '../../../app/shellFlag';
import { UpdatePanel } from '../Updates';

export function AboutSettings() {
  const preview = useShellPreview();
  return (
    <>
      <section className="panel settings-section">
        <label className="settings-f1-reminders">
          <input
            type="checkbox"
            checked={preview}
            onChange={(event) => writeShellPreview(event.target.checked)}
          />{' '}
          Новая структура (проба)
        </label>
      </section>
      <UpdatePanel />
    </>
  );
}
