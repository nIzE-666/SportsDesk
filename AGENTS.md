# Instructions for coding agents (SportsDesk)

You are a worker doing one step of a plan. The lead agent gave you a task file (`TASK.md` in the root of your folder) and will review your work. Nobody can answer questions while you work: when something is unclear, choose the conservative option and say so in your report.

## Where you work

- Work only inside the current folder, which is your own git worktree on its own branch. Never touch other folders, other worktrees or the main checkout.
- Never run `git push`, `git rebase`, `git reset --hard`, `git commit --amend`, `git switch`, `git worktree` or `git config`, and never create or delete branches.
- `node_modules` is already installed: do not run `npm install`, `npm ci` or `npm update`, and do not add dependencies.
- Use only the ports named in `TASK.md`. Stop every dev server and browser you start before you finish.
- Do not edit `AGENTS.md`, `opencode.json` or `TASK.md`, and do not commit `TASK.md`.

## Secrets

Never read, print, copy or change keys or tokens: nothing under `%LOCALAPPDATA%`, `src-tauri/keys/`, `.env*` or the app's secret store. Use the test fixtures (`e2e/uiFixture.ts`, `src/test/fixtures/`) rather than real data unless `TASK.md` says otherwise.

## The project

- Windows desktop app: Tauri 2, React 19, TypeScript, Vite; native code in `src-tauri/` (Rust). Read the surrounding code first and follow its style, layout and naming.
- All UI text is Russian. Wording follows section 5.4 of `UI_SIMPLIFICATION_PLAN_2026-11-10.md`: at most one short sentence under a heading, plain words, no internal terms (Rust, SQLite, DPAPI, localStorage, кеш, токен), no data source names in ordinary text.
- Data honesty: show a dash or nothing for an unknown value; never invent a number, minute, status or date.
- Styles use the existing CSS variables; no inline `style=` attributes.

## Checks before you commit

1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check` (fix with `npx prettier --write <your files>`)
4. `npx vitest run <your test files or folder> --maxWorkers=1`
5. If you changed files in `e2e/`: `npm run typecheck:e2e`.
6. Playwright only for the specs `TASK.md` names, on your port: `SPORTSDESK_E2E_PORT=<port> npx playwright test <spec>`. Never run the whole suite or `npm run test:visual:update`, and never edit `e2e/*-snapshots/`.

## Commit

One commit on your branch when the work is finished and the checks pass: a short English lowercase subject describing the user-visible change, a body saying what changed and how it was verified, then a blank line and `Co-Authored-By: DeepSeek V4.1 Flash <noreply@opencode.ai>`.

## Final report

End with a short report in English:

- **Commit**: hash and subject.
- **Changes**: what changed, file by file.
- **Checks**: each command you ran and its result.
- **Not verified**: what you could not check and why.
- **Notes**: decisions you had to make, and anything you noticed but left alone.

Never claim a check you did not run or a result you did not see.
