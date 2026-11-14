import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useModules } from '../../lib/modules';
import {
  getAmbientState,
  setAmbientSportHint,
  toggleAmbient,
  useAmbientState,
} from './ambientEngine';
import { AMBIENT_LABELS, ambientStopMessage } from './ambientPolicy';
import { ambientAllowed, motionReduced, useAtmosphere } from './atmosphereStore';
import './atmosphere.css';

const NOTE_MS = 6000;

/**
 * Кнопка «Фоновый звук» в верхней панели: здесь фон включается и выключается.
 * Показывается, только если фон разрешён в настройках «Игры и атмосфера».
 * Фон сам не включается никогда — ни после запуска, ни после обновления.
 */
export function AmbientToggle({ sport }: { sport: string }) {
  const settings = useAtmosphere();
  const atmosphereOn = useModules().atmosphere;
  const ambient = useAmbientState();
  const [note, setNote] = useState<string | null>(null);
  const reason = ambient.stoppedBy;

  // Режим «Автоматически» выбирает звук по виду спорта; кнопка всегда смонтирована.
  useEffect(() => setAmbientSportHint(sport), [sport]);
  // Фон остановили правила (видео, скрытое окно): объясняем причину.
  useEffect(() => {
    if (reason) setNote(ambientStopMessage(reason));
  }, [reason]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  if (!atmosphereOn || !ambientAllowed(settings)) return null;
  const playing = ambient.kind !== null;
  const click = () => {
    setNote(null);
    const wasPlaying = getAmbientState().kind !== null;
    if (!toggleAmbient() && !wasPlaying) {
      const why = getAmbientState().stoppedBy;
      setNote(why ? ambientStopMessage(why) : null);
    }
  };
  const title = ambient.kind
    ? `Фоновый звук: ${AMBIENT_LABELS[ambient.kind]}${ambient.lowered ? ' (приглушён, идёт видео)' : ''} — нажмите, чтобы выключить`
    : 'Включить фоновый звук';
  return (
    <span className="ambient-toggle-wrap">
      <button
        type="button"
        className={`icon-button ambient-toggle${playing ? ' playing' : ''}${motionReduced(settings) ? ' calm' : ''}`}
        aria-label="Фоновый звук"
        aria-pressed={playing}
        title={title}
        onClick={click}
      >
        {playing ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      {note && (
        <span className="ambient-note" role="status">
          {note}
        </span>
      )}
    </span>
  );
}
