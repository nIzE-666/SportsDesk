// Dev-only mockup of the «Главное» screen: static markup in home-mockup.html,
// styles in homeMockup.css. Lets the owner judge the look before the kit is reworked.
import '@fontsource-variable/manrope';
import '../src/kit/showcaseFonts';
import './homeMockup.css';

const root = document.documentElement;
const toggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') root.classList.add('hm-light');
const syncLabel = () => {
  if (toggle)
    toggle.textContent = root.classList.contains('hm-light') ? 'Тёмная тема' : 'Светлая тема';
};
toggle?.addEventListener('click', () => {
  root.classList.toggle('hm-light');
  syncLabel();
});
syncLabel();

// Real club crests, the same images the app shows: taken from the match feed
// on 16 November through the app's local bridge.
const CREST_BASE = 'https://cdn.pitchapi.dev/images/teams/';
const CRESTS: Record<string, string> = {
  ars: 'cc89aa6a111b43694223ca0506940e05f825369c259a6c8bf4ab8cf8b080a05b',
  che: 'a007eabb180fc489edfd1ca2d5cd11da574050ff0abe5cbe2ca4e2bfec082c07',
  mu: 'd64e82187ecc985ae095feba4db1dd6607f7009424f39a745102713bb0e1e6bb',
  avl: 'fba3bf0754a20dffd4acc44c3d5f6b12f7d8ab9c79ae6000a745d30385cd631c',
  rom: 'ad80e0ea1049979b20dd51e024dc82d40e9b665e8081ab02534310f38427b4ef',
  mia: '2356ceb729cbf662a24dc087badee27d7d9db87c787d9e01801a6473a72e336d',
  clt: '351d9bbbcf87efe605157514bf3b52105d6fe5c8438a994e5b4870f3f890a206',
  sas: '6d1458229c36991186c0335b8d5656e50422806805f2bf064712147162e428c8',
  fio: '52f92c4c2ae57c14bc3d2ead58a2f899ab2fa12bebb91e6f627af2b99608dfce',
  ata: '108eb0aab69689251ffd6d722eff62fd754c93e39c20909a373b26464bbb38be',
  bol: '666c2362e7fc4aa2380cdb768cfe1a9539333a548feb4268b900ebba19278439',
  bay: '1e2afd379a7d354c930f790c1f9ab0c2b50654cf4d47f20ffb269b8cfe309bca',
  bvb: '9a049cf470f5e8a1b096c1ac46c7a742944c23a6c82be592fd7f2889aa476de5',
  rma: '9e7141c583abe50554615387c99815ee3663d1a4f888549679523d2acd7f716c',
  atm: 'e7ed0850dc75498dd5989ac217e4c9345476f9967d89385e5ece1ef5bcd8a330',
  get: '20e0f7f9929f4ff5886dc12a076fc16c191d455f36be5c2f90d9fd83798d9f77',
  ala: 'e9f08977249bc4545a47dee37f4730f023cab2f5f4a76a34ce20c185665d2d56',
};
for (const img of document.querySelectorAll<HTMLImageElement>('img[data-crest]')) {
  const hash = CRESTS[img.dataset.crest ?? ''];
  if (hash) img.src = `${CREST_BASE}${hash}.webp`;
}

// Geometry comes from data attributes, so the markup carries no inline styles.
for (const el of document.querySelectorAll<HTMLElement>('[data-at]')) {
  el.style.setProperty('--at', `${el.dataset.at}%`);
}
for (const el of document.querySelectorAll<HTMLElement>('[data-min]')) {
  const minute = Math.min(Number(el.dataset.min), 94);
  el.style.setProperty('--at', `${(minute / 94) * 100}%`);
}
const track = document.querySelector<HTMLElement>('[data-now]');
if (track) track.style.setProperty('--now', `${track.dataset.now}%`);

// Countdowns run from the mockup's «now», Thursday 19:30.
const pad = (n: number) => String(n).padStart(2, '0');
const timers = Array.from(document.querySelectorAll<HTMLElement>('[data-countdown]'));
const started = Date.now();
const tick = () => {
  const passed = Math.floor((Date.now() - started) / 1000);
  for (const el of timers) {
    const left = Math.max(0, Number(el.dataset.countdown) - passed);
    const days = Math.floor(left / 86400);
    const hours = Math.floor((left % 86400) / 3600);
    const minutes = Math.floor((left % 3600) / 60);
    const seconds = left % 60;
    const cells = el.querySelectorAll<HTMLElement>('[data-unit]');
    if (cells.length === 0) {
      el.textContent = `${pad(days * 24 + hours)}:${pad(minutes)}:${pad(seconds)}`;
      continue;
    }
    for (const cell of cells) {
      const unit = cell.dataset.unit;
      if (unit === 'd') cell.textContent = String(days);
      else if (unit === 'h') cell.textContent = pad(hours);
      else if (unit === 'm') cell.textContent = pad(minutes);
      else cell.textContent = pad(seconds);
    }
  }
};
tick();
window.setInterval(tick, 1000);

// Filter: Всё · Футбол · Формула 1.
const main = document.querySelector<HTMLElement>('.hm-main');
const filters = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter]'));
for (const button of filters) {
  button.addEventListener('click', () => {
    if (main) main.dataset.view = button.dataset.filter ?? 'all';
    for (const other of filters) {
      const on = other === button;
      other.classList.toggle('is-on', on);
      other.setAttribute('aria-pressed', String(on));
    }
  });
}

// A past match lights up on the week track and on its card together.
const linked = (key: string | undefined, on: boolean) => {
  if (!key) return;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-match="${key}"]`)) {
    el.classList.toggle('is-linked', on);
  }
};
for (const el of document.querySelectorAll<HTMLElement>('[data-match]')) {
  const key = el.dataset.match;
  el.addEventListener('mouseenter', () => linked(key, true));
  el.addEventListener('mouseleave', () => linked(key, false));
  el.addEventListener('focus', () => linked(key, true));
  el.addEventListener('blur', () => linked(key, false));
}

// Shelf arrows move by one card.
for (const shelf of document.querySelectorAll<HTMLElement>('[data-shelf]')) {
  const row = shelf.querySelector<HTMLElement>('.hm-shelf-row');
  if (!row) continue;
  const prev = shelf.querySelector<HTMLButtonElement>('[data-dir="-1"]');
  const next = shelf.querySelector<HTMLButtonElement>('[data-dir="1"]');
  const step = () => {
    const first = row.firstElementChild;
    return first instanceof HTMLElement ? first.offsetWidth + 16 : 300;
  };
  const sync = () => {
    if (prev) prev.disabled = row.scrollLeft <= 2;
    if (next) next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
  };
  prev?.addEventListener('click', () => row.scrollBy({ left: -step() }));
  next?.addEventListener('click', () => row.scrollBy({ left: step() }));
  row.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
}
