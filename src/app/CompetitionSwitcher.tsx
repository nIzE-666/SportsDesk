import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CUP_COMPETITIONS } from '../features/ucl/cups';
import { Button } from '../kit';
import { CHAMPIONS_LEAGUE_ID, defaultFootballTab, isValidFootballTab } from '../lib/navigation';
import { LEAGUES } from '../lib/navigationMetadata';
import { isCompetitionVisible, useModules } from '../lib/modules';
import type { FootballTab, ShellRoute } from '../lib/navigation';
import { competitionName } from './shellModel';

export type CompetitionVisibility = (competitionId: string) => boolean;

export interface CompetitionOption {
  id: string;
  label: string;
}

export interface CompetitionGroup {
  label: string;
  options: CompetitionOption[];
}

/**
 * The two groups of the tournament switcher: leagues first, then the Champions
 * League and the cups. Only competitions allowed by the module switches remain.
 */
export function competitionGroups(
  isVisible: CompetitionVisibility = isCompetitionVisible,
): CompetitionGroup[] {
  const leagues = LEAGUES.filter((league) => isVisible(league.id)).map((league) => ({
    id: league.id,
    label: league.label,
  }));
  const cups = [
    CHAMPIONS_LEAGUE_ID,
    ...CUP_COMPETITIONS.filter((cup) => cup.id !== CHAMPIONS_LEAGUE_ID).map((cup) => cup.id),
  ]
    .filter((id) => isVisible(id))
    .map((id) => ({ id, label: competitionName(id) }));
  return [
    { label: 'Лиги', options: leagues },
    { label: 'Еврокубки и сборные', options: cups },
  ].filter((group) => group.options.length > 0);
}

/** Choosing a competition keeps the current tab when the new kind has it. */
export function competitionRoute(competitionId: string, tab?: FootballTab): ShellRoute {
  return {
    kind: 'football',
    competitionId,
    tab: tab && isValidFootballTab(competitionId, tab) ? tab : defaultFootballTab(competitionId),
  };
}

interface CompetitionSwitcherProps {
  competitionId: string;
  /** The open tab; the match page has none and opens the competition's default tab. */
  tab?: FootballTab;
  /** Context after the title, e.g. «Матч» on a match page. */
  suffix?: string;
  onNavigate: (route: ShellRoute) => void;
}

/**
 * One competition control for «Футбол»: the page title opens a grouped list.
 * Arrow keys move through it, Enter chooses, Esc or a click outside closes it.
 */
export function CompetitionSwitcher({
  competitionId,
  tab,
  suffix,
  onNavigate,
}: CompetitionSwitcherProps) {
  const modules = useModules();
  // modules is the stored snapshot that isCompetitionVisible reads as well.
  const groups = useMemo(() => competitionGroups(), [modules]);
  const options = groups.flatMap((group) => group.options);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const currentIndex = options.findIndex((option) => option.id === competitionId);

  function openMenu(index = currentIndex >= 0 ? currentIndex : 0) {
    setActiveIndex(index);
    setOpen(true);
  }

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(id: string) {
    setOpen(false);
    buttonRef.current?.focus();
    onNavigate(competitionRoute(id, tab));
  }

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    setOpen(false);
  }, [competitionId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? options.length - 1 : currentIndex >= 0 ? currentIndex : 0);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = activeIndex >= last ? 0 : activeIndex + 1;
        break;
      case 'ArrowUp':
        next = activeIndex <= 0 ? last : activeIndex - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        setOpen(false);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex].id);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  return (
    <div className="competition-switcher" ref={rootRef}>
      <Button
        type="button"
        variant="quiet"
        className="competition-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        ref={buttonRef}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        <span>{competitionName(competitionId)}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </Button>
      {suffix && <span className="shell-page-context">{` · ${suffix}`}</span>}
      {open && (
        <div
          className="competition-menu"
          id={menuId}
          role="menu"
          aria-label="Соревнование"
          onKeyDown={onMenuKeyDown}
        >
          {groups.map((group, groupIndex) => {
            const labelId = `${menuId}-${groupIndex}`;
            return (
              <div
                className="competition-menu-group"
                role="group"
                aria-labelledby={labelId}
                key={group.label}
              >
                <div className="competition-menu-label" id={labelId}>
                  {group.label}
                </div>
                {group.options.map((option) => {
                  const index = options.findIndex((item) => item.id === option.id);
                  const selected = option.id === competitionId;
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      variant="quiet"
                      role="menuitemradio"
                      aria-checked={selected}
                      tabIndex={-1}
                      className="competition-menu-item"
                      ref={(element) => {
                        itemRefs.current[index] = element;
                      }}
                      onFocus={() => setActiveIndex(index)}
                      onClick={() => choose(option.id)}
                    >
                      <span>{option.label}</span>
                      {selected && <Check size={14} aria-hidden="true" />}
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
