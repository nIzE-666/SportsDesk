#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

// Prints a Markdown diff of two text inventories written by e2e/contrast.pw.ts.
// Usage: node scripts/uiInventoryDiff.mjs before.json after.json

function usage() {
  console.error('Usage: node scripts/uiInventoryDiff.mjs <before.json> <after.json>');
  process.exit(2);
}

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) usage();

async function load(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries))
    throw new Error(`${path}: expected an array or an object with an entries array`);
  return entries;
}

const before = await load(beforePath);
const after = await load(afterPath);

const groupKey = (entry) => `${entry.stop}\u0000${entry.theme}`;
const groups = new Map();
const groupOf = (entry) => {
  const key = groupKey(entry);
  if (!groups.has(key))
    groups.set(key, { stop: entry.stop, theme: entry.theme, before: [], after: [] });
  return groups.get(key);
};
for (const entry of before) groupOf(entry).before.push(entry);
for (const entry of after) groupOf(entry).after.push(entry);

const byText = (entries) => {
  const map = new Map();
  for (const entry of entries) {
    const list = map.get(entry.text) ?? [];
    list.push(entry);
    map.set(entry.text, list);
  }
  return map;
};

const roleName = (entry) =>
  entry.role === 'other' && entry.color ? `other (${entry.color})` : entry.role;
const size = (entry) => `${entry.fontSize}px`;
const weight = (entry) => `${entry.fontWeight}`;

const sections = [];
for (const group of [...groups.values()].sort(
  (first, second) =>
    first.stop.localeCompare(second.stop, 'ru') || first.theme.localeCompare(second.theme),
)) {
  const beforeByText = byText(group.before);
  const afterByText = byText(group.after);
  const texts = [...new Set([...beforeByText.keys(), ...afterByText.keys()])];
  const disappeared = [];
  const appeared = [];
  const changed = [];

  for (const text of texts) {
    const oldList = beforeByText.get(text) ?? [];
    const newList = afterByText.get(text) ?? [];
    const paired = Math.min(oldList.length, newList.length);
    for (let index = 0; index < paired; index += 1) {
      const oldEntry = oldList[index];
      const newEntry = newList[index];
      const changes = [];
      if (roleName(oldEntry) !== roleName(newEntry))
        changes.push(`role \`${roleName(oldEntry)}\` → \`${roleName(newEntry)}\``);
      if (size(oldEntry) !== size(newEntry))
        changes.push(`size ${size(oldEntry)} → ${size(newEntry)}`);
      if (weight(oldEntry) !== weight(newEntry))
        changes.push(`weight ${weight(oldEntry)} → ${weight(newEntry)}`);
      if (changes.length) changed.push(`- \`${text}\`: ${changes.join('; ')}`);
    }
    for (let index = paired; index < oldList.length; index += 1) disappeared.push(`- \`${text}\``);
    for (let index = paired; index < newList.length; index += 1) appeared.push(`- \`${text}\``);
  }

  if (!disappeared.length && !appeared.length && !changed.length) continue;
  const lines = [`## ${group.stop} — ${group.theme}`];
  if (disappeared.length) lines.push('', '### Disappeared', ...disappeared);
  if (appeared.length) lines.push('', '### Appeared', ...appeared);
  if (changed.length) lines.push('', '### Changed', ...changed);
  sections.push(lines.join('\n'));
}

if (sections.length) process.stdout.write(`# Text inventory diff\n\n${sections.join('\n\n')}\n`);
