import { useEffect, useState } from 'react';
import { Button, Field } from '../../kit';
import { isTauriRuntime, rpc } from '../../lib/bridge';
interface Shortcut {
  shortcut: string;
  registered: boolean;
  error: string | null;
}
export function ShortcutControl() {
  const [key, setKey] = useState('Ctrl+Shift+L'),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isTauriRuntime())
      void rpc<Shortcut>('shortcut_settings')
        .then((v) => {
          setKey(v.shortcut);
          setStatus(
            v.error ??
              (v.registered ? 'Сочетание зарегистрировано.' : 'Горячая клавиша выключена.'),
          );
        })
        .catch(() => setStatus('Не удалось прочитать состояние сочетания.'));
  }, []);
  return (
    <div className="shortcut-control">
      <Field
        label="Глобальная клавиша Live-мини"
        htmlFor="mini-shortcut"
        hint="Пустое поле выключает клавишу."
      >
        <div className="settings-actions">
          <input
            id="mini-shortcut"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Ctrl+Shift+L"
          />
          <Button
            disabled={busy || !isTauriRuntime()}
            onClick={async () => {
              setBusy(true);
              try {
                const v = await rpc<Shortcut>('set_shortcut', { shortcut: key });
                setStatus(
                  v.registered ? 'Сочетание зарегистрировано.' : 'Горячая клавиша выключена.',
                );
              } catch (e) {
                setStatus(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Применить
          </Button>
        </div>
      </Field>
      <p role="status" className="settings-note">
        {status}
      </p>
    </div>
  );
}
