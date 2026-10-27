import { createContext, useContext } from 'react';
import { Tv } from 'lucide-react';
export interface WatchIntent {
  sport: 'football' | 'f1';
  title: string;
  key: string;
}
export const WatchActionContext = createContext<((intent: WatchIntent) => void) | null>(null);
export function WatchEventButton({ intent }: { intent: WatchIntent }) {
  const open = useContext(WatchActionContext);
  return open ? (
    <button className="ghost-btn" onClick={() => open(intent)}>
      <Tv size={15} />
      Смотреть
    </button>
  ) : null;
}
