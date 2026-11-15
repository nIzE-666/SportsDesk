import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, IconButton } from '../kit';
import { useModules } from '../lib/modules';
import {
  findSearchItems,
  isSearchItemVisible,
  readSearchIndex,
  rememberSearchVisit,
  SEARCH_CHANGED,
  type SearchItem,
  type SearchTarget,
} from '../lib/searchIndex';
import './globalSearch.css';

const labels: Record<SearchTarget['kind'], string> = {
  team: 'Клуб',
  match: 'Матч',
  player: 'Игрок',
  driver: 'Пилот',
  channel: 'Канал',
  section: 'Раздел',
  competition: 'Турнир',
  settings: 'Настройка',
};

export function GlobalSearch({ onNavigate }: { onNavigate: (target: SearchTarget) => void }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    [items, setItems] = useState<SearchItem[]>([]);
  const modules = useModules();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.isComposing) {
        const modal = document.querySelector('[aria-modal="true"]');
        if (modal && modal !== panel.current) return;
        e.preventDefault();
        if (!e.repeat) setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    setQuery('');
    setActive(0);
    const update = () => setItems(readSearchIndex());
    update();
    window.addEventListener(SEARCH_CHANGED, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SEARCH_CHANGED, update);
      window.removeEventListener('storage', update);
    };
  }, [open]);
  const results = findSearchItems(items, query).filter((item) =>
    isSearchItemVisible(item, modules),
  );
  const selected = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    panel.current
      ?.querySelector(`#search-result-${selected}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, query]);
  const choose = (item: SearchItem) => {
    rememberSearchVisit(item.key);
    setOpen(false);
    onNavigate(item.target);
  };
  return (
    <>
      <IconButton
        icon={<Search size={18} aria-hidden="true" />}
        aria-label="Поиск · Ctrl+K"
        title="Поиск · Ctrl+K"
        onClick={() => {
          if (!document.querySelector('[aria-modal="true"]')) setOpen(true);
        }}
      />
      {createPortal(
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Поиск"
          closeLabel="Закрыть поиск"
          className="command-dialog"
        >
          <div className="command-input" ref={panel}>
            <Search size={20} aria-hidden="true" />
            <input
              ref={input}
              aria-label="Поиск команд, игроков, матчей, разделов и настроек"
              placeholder="Команда, игрок, матч, раздел или настройка"
              value={query}
              role="combobox"
              aria-expanded="true"
              aria-controls="global-search-results"
              aria-autocomplete="list"
              aria-activedescendant={results.length ? `search-result-${selected}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(
                    (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) %
                      Math.max(1, results.length),
                  );
                }
                if (e.key === 'Enter' && results[selected]) {
                  e.preventDefault();
                  choose(results[selected]!);
                }
              }}
            />
          </div>
          <p className="command-hint">
            {query ? 'Результаты по загруженным данным' : 'Недавние переходы и разделы'}
          </p>
          <div
            className="command-results"
            id="global-search-results"
            role="listbox"
            aria-label="Результаты поиска"
            tabIndex={-1}
          >
            {results.map((item, i) => (
              <button
                id={`search-result-${i}`}
                key={item.key}
                role="option"
                aria-selected={i === selected}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="command-kind">{labels[item.target.kind]}</span>
              </button>
            ))}
            {!results.length && (
              <p className="command-empty">
                Совпадений нет. Поиск работает по тому, что вы уже открывали.
              </p>
            )}
          </div>
          <p className="command-hint">↑ ↓ выбор · Enter открыть · Esc закрыть</p>
        </Dialog>,
        document.querySelector('.app-root') ?? document.body,
      )}
    </>
  );
}
