import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useViewState } from '../../lib/useViewState';

export interface SeasonCtx {
  year: number;
  setYear: (y: number) => void;
  years: number[];
}

const currentYear = new Date().getFullYear();
const YEARS: number[] = (() => {
  const out: number[] = [];
  for (let y = currentYear; y >= 2023; y--) out.push(y);
  return out;
})();

const Ctx = createContext<SeasonCtx>({ year: currentYear, setYear: () => {}, years: YEARS });

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useViewState<number>(
    'f1.year',
    currentYear,
    (value) => typeof value === 'number' && YEARS.includes(value),
  );
  const value = useMemo(() => ({ year, setYear, years: YEARS }), [year]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSeason(): SeasonCtx {
  return useContext(Ctx);
}
