import { createContext, useContext } from 'react';
import { Tv } from 'lucide-react';
import { Button } from '../kit';
import { useModules } from './modules';
export interface WatchIntent {
  sport: 'football' | 'f1';
  title: string;
  key: string;
}
export const WatchActionContext = createContext<((intent: WatchIntent) => void) | null>(null);
export function WatchEventButton({ intent }: { intent: WatchIntent }) {
  const open = useContext(WatchActionContext);
  const watch = useModules().watch;
  if (!watch) return null;
  return open ? (
    <Button small icon={<Tv size={15} />} onClick={() => open(intent)}>
      Смотреть
    </Button>
  ) : null;
}
