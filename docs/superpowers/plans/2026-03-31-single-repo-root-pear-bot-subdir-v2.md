# Single-Repo Root-Pear / Bot-Subdir v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current v2 setup into one integrated repository where the root is the patched Pear fork and the Discord bot/runtime lives under `apps/discord-radio-bot/`.

**Architecture:** The migration keeps the direct-audio-export runtime path and Pear authority model intact, but changes repository topology. Pear-root becomes the upstream-tracking base, the bot becomes a sub-package, and root scripts/docs become thin orchestration and product entry points.

**Tech Stack:** Pear Desktop (Electron/Vite), TypeScript/ESM, Node 24, pnpm, FFmpeg bootstrap, Discord.js, @discordjs/voice

---

## File Map

### Current sources

- Current bot repo root: `E:\github\pear-desktop-discord-radio\`
- Current patched Pear repo: `E:\github\pear-desktop-direct-audio-export\`

### Target structure

- Root becomes the patched Pear repo layout:
  - `package.json`
  - `src/`
  - `web/`
  - `tests/`
  - `assets/`
  - `vite-plugins/`
  - `electron.vite.config.mts`
  - `eslint.config.mjs`
- Bot moves under:
  - `apps/discord-radio-bot/package.json`
  - `apps/discord-radio-bot/src/`
  - `apps/discord-radio-bot/tests/`
  - `apps/discord-radio-bot/config/`
  - `apps/discord-radio-bot/scripts/`
  - `apps/discord-radio-bot/.env.example`
  - `apps/discord-radio-bot/tsconfig.json`
  - `apps/discord-radio-bot/eslint.config.js`
- Integrated docs remain at root:
  - `README.md`
  - `README.ja.md`
  - `docs/`
  - `AGENTS.md`
- Root orchestration scripts remain at root:
  - `scripts/`

### Files that should disappear from root bot layout

- root `src/` bot runtime tree
- root `tests/` bot tests
- root `config/` bot config
- root `.env.example` bot env template
- root `tsconfig.json` bot-only config
- root `eslint.config.js` bot-only lint config
- root `package.json` bot package
- root `pnpm-lock.yaml` bot lockfile

### Files that need root-orchestration replacements

- root `package.json` scripts for integrated launch/test/doctor wrappers
- root `README.md`
- root `README.ja.md`
- root `docs/private-pear-fork.md`
- root `docs/architecture-review.md`
- root `docs/windows-soak-checklist.md`
- root `docs/windows-soak-results-template.md`
- root `AGENTS.md`

---

### Task 1: Snapshot and import the patched Pear root

**Files:**
- Copy in: top-level Pear files from `E:\github\pear-desktop-direct-audio-export\`
- Preserve: root `docs/`, root `.codex/`, root `.git/`
- Test: root `package.json`, root `src/plugins/direct-audio-export/`

- [ ] **Step 1: Capture the current root and Pear-root inventories**

Run:

```powershell
Get-ChildItem -Force E:\github\pear-desktop-discord-radio | Select-Object Name
Get-ChildItem -Force E:\github\pear-desktop-direct-audio-export | Select-Object Name
```

Expected: clear before/after inventory for the migration.

- [ ] **Step 2: Write a failing topology assertion**

Create/update:

```text
tests/repo-topology-check.txt
```

Content:

```text
Root should contain Pear app files such as web/, assets/, electron.vite.config.mts.
Bot runtime should no longer live at root src/ and tests/.
```

Expected: a human-readable migration guard before file moves begin.

- [ ] **Step 3: Replace root Pear-facing files from the patched Pear repo**

Copy these into root from `E:\github\pear-desktop-direct-audio-export\`:

```text
src/
web/
assets/
tests/
vite-plugins/
package.json
pnpm-lock.yaml
electron.vite.config.mts
eslint.config.mjs
tsconfig.json
tsconfig.test.json
electron-builder.yml
.editorconfig
.gitattributes
.npmrc
.prettierrc
license
changelog.md
renovate.json
README.md (temporary; it will be rewritten in a later task)
```

Expected: root now physically matches the patched Pear fork baseline plus this repo’s docs/scripts extras.

- [ ] **Step 4: Restore this repo’s integrated docs and orchestration files over the imported root**

Keep/reapply:

```text
docs/
scripts/
AGENTS.md
README.md
README.ja.md
```

Expected: root contains Pear runtime code plus this project’s product docs and orchestration files.

- [ ] **Step 5: Commit the root import baseline**

Run:

```powershell
git add .
git commit -m "chore: import patched pear root baseline"
```

Expected: one commit that establishes the new repo root topology baseline.

---

### Task 2: Move the Discord bot into `apps/discord-radio-bot`

**Files:**
- Create: `apps/discord-radio-bot/`
- Move: current bot `src/`, `tests/`, `config/`, `.env.example`, `eslint.config.js`, `tsconfig.json`, `package.json`, `scripts/bootstrap-ffmpeg.mjs`, `scripts/bootstrap-ffmpeg-paths.mjs`
- Modify: bot-local path assumptions after move
- Test: `apps/discord-radio-bot/package.json`, `apps/discord-radio-bot/src/cli/*.ts`

- [ ] **Step 1: Create the bot subdirectory skeleton**

Create:

```text
apps/discord-radio-bot/
apps/discord-radio-bot/src/
apps/discord-radio-bot/tests/
apps/discord-radio-bot/config/
apps/discord-radio-bot/scripts/
```

- [ ] **Step 2: Write the failing bot-entry expectation**

Create:

```text
apps/discord-radio-bot/README.migration.md
```

Content:

```markdown
The bot package must contain the Discord runtime, doctor, launcher logic, config, tests, and FFmpeg bootstrap scripts.
Root should no longer be the bot package.
```

- [ ] **Step 3: Move the bot package files into the subdirectory**

Move these current bot assets into `apps/discord-radio-bot/`:

```text
src/
tests/
config/
.env.example
eslint.config.js
package.json
tsconfig.json
scripts/bootstrap-ffmpeg.mjs
scripts/bootstrap-ffmpeg-paths.mjs
```

Expected: the bot package is self-contained under `apps/discord-radio-bot/`.

- [ ] **Step 4: Rewrite bot package paths after the move**

Adjust these kinds of references inside the moved bot package:

```text
dist output paths
relative docs links
FFmpeg cache paths
launcher path resolution
.env loading from bot package root
```

Concrete targets to inspect and fix:

```text
apps/discord-radio-bot/src/cli/env.ts
apps/discord-radio-bot/src/launcher/resolve-pear-desktop.ts
apps/discord-radio-bot/scripts/bootstrap-ffmpeg.mjs
apps/discord-radio-bot/scripts/bootstrap-ffmpeg-paths.mjs
apps/discord-radio-bot/tests/**/*
apps/discord-radio-bot/package.json
```

- [ ] **Step 5: Run bot-package tests from its new home**

Run:

```powershell
cd E:\github\pear-desktop-discord-radio\apps\discord-radio-bot
pnpm lint
pnpm typecheck
pnpm test
```

Expected: bot package passes in-place from the subdirectory.

- [ ] **Step 6: Commit the bot move**

Run:

```powershell
git add .
git commit -m "refactor: move discord radio bot into app subdirectory"
```

Expected: one commit that isolates bot code under `apps/discord-radio-bot/`.

---

### Task 3: Add root orchestration for the integrated product

**Files:**
- Modify: root `package.json`
- Modify/Create: root `scripts/` wrapper helpers
- Modify: `apps/discord-radio-bot/src/launcher/resolve-pear-desktop.ts`
- Test: root wrapper script behavior and bot launcher resolution

- [ ] **Step 1: Write the failing wrapper-script contract**

Add a root-level note file:

```text
scripts/radio-stack-contract.txt
```

Content:

```text
Root must expose:
- pnpm start:radio-stack
- pnpm doctor:radio-bot
- pnpm test:radio-bot
These commands delegate to apps/discord-radio-bot while using the root Pear app as the launch target.
```

- [ ] **Step 2: Point bot launcher resolution at repo root, not a sibling repo**

Update:

```text
apps/discord-radio-bot/src/launcher/resolve-pear-desktop.ts
apps/discord-radio-bot/tests/launcher/resolve-pear-desktop.test.ts
```

The new contract should resolve Pear launch to the repository root by default.

- [ ] **Step 3: Add root wrapper scripts**

Modify root `package.json` to include:

```json
{
  "scripts": {
    "start:radio-stack": "pnpm --dir apps/discord-radio-bot run launch",
    "doctor:radio-bot": "pnpm --dir apps/discord-radio-bot run doctor",
    "test:radio-bot": "pnpm --dir apps/discord-radio-bot run test"
  }
}
```

If the exact root script names must differ because of Pear upstream collisions, keep the `radio-bot` suffix and preserve the same semantics.

- [ ] **Step 4: Verify root orchestration works**

Run:

```powershell
cd E:\github\pear-desktop-discord-radio
pnpm run doctor:radio-bot
pnpm run test:radio-bot
```

Expected: commands delegate into the bot sub-package successfully.

- [ ] **Step 5: Commit root orchestration**

Run:

```powershell
git add .
git commit -m "feat: add root orchestration for radio bot package"
```

Expected: one commit that turns the repo into a single integrated entry point.

---

### Task 4: Rewrite docs and repo guidance to the new topology

**Files:**
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/private-pear-fork.md`
- Modify: `docs/architecture-review.md`
- Modify: `docs/windows-soak-checklist.md`
- Modify: `docs/windows-soak-results-template.md`
- Modify: `AGENTS.md`
- Modify: `docs/review-findings.md`

- [ ] **Step 1: Write the failing documentation assertions**

Create:

```text
docs/topology-migration-checklist.txt
```

Content:

```text
Docs must say:
- root is the patched Pear fork
- bot code lives in apps/discord-radio-bot
- no sibling Pear repo is required anymore
- root scripts are the integrated entry points
```

- [ ] **Step 2: Rewrite README files to the single-repo topology**

Update both README files so they explain:

```text
root = patched Pear fork
apps/discord-radio-bot = bot/runtime package
root commands are the entry point
no external sibling Pear repo is part of the supported topology
```

- [ ] **Step 3: Rewrite private-fork and architecture docs**

Update:

```text
docs/private-pear-fork.md
docs/architecture-review.md
```

They must describe the private Pear patch as code inside this repo root, not as an external sibling repo.

- [ ] **Step 4: Rewrite soak docs and AGENTS guidance**

Update:

```text
docs/windows-soak-checklist.md
docs/windows-soak-results-template.md
AGENTS.md
```

They must use the new root+subdir launch/setup model.

- [ ] **Step 5: Append review findings for the topology migration**

Update:

```text
docs/review-findings.md
```

Add a new dated pass describing the topology migration and its verification boundaries.

- [ ] **Step 6: Commit docs/guidance rewrite**

Run:

```powershell
git add .
git commit -m "docs: rewrite repo guidance for single-repo v2 layout"
```

Expected: one commit that aligns all top-level docs and repo guidance to the new topology.

---

### Task 5: Final verification and Windows stack re-check

**Files:**
- Verify: root `package.json`
- Verify: `apps/discord-radio-bot/package.json`
- Verify: launcher/runtime/doctor docs

- [ ] **Step 1: Run root/Pear verification**

Run from root:

```powershell
pnpm build
pnpm typecheck
```

Expected: patched Pear root still builds and typechecks at the root package level.

- [ ] **Step 2: Run bot verification**

Run from root:

```powershell
pnpm run test:radio-bot
pnpm run doctor:radio-bot
```

Expected: bot package still passes and doctor succeeds against the same-repo Pear root.

- [ ] **Step 3: Run the integrated launch path**

Run from root:

```powershell
pnpm run start:radio-stack
```

Expected runtime evidence:

```text
Audio export provider selected for runtime.
FFmpeg selected for runtime.
Runtime started.
Discord client ready.
```

- [ ] **Step 4: Run manual Windows smoke flow**

Exercise:

```text
/radio join
/radio add
/radio now
/radio control
/radio leave
```

Expected:

```text
direct audio export path works
same-machine duplicate audio remains suppressed
no sibling-repo assumption is needed
```

- [ ] **Step 5: Commit final migration polish**

Run:

```powershell
git add .
git commit -m "chore: finalize single-repo v2 migration"
```

Expected: one final commit after verification-only or final small cleanup changes.

---

## Self-Review

### Spec coverage

- Root becomes patched Pear fork: Task 1
- Bot moves into `apps/discord-radio-bot/`: Task 2
- Root wrapper scripts: Task 3
- Docs/AGENTS/soak rewrite: Task 4
- Verification across both layers: Task 5

No design section is left without a task.

### Placeholder scan

Checked for `TBD`, `TODO`, vague “handle appropriately” language, and undefined phases. None remain.

### Type and path consistency

The plan consistently uses:

- root = Pear package
- `apps/discord-radio-bot/` = bot package
- root wrapper scripts:
  - `pnpm start:radio-stack`
  - `pnpm doctor:radio-bot`
  - `pnpm test:radio-bot`

No alternate directory names are introduced.
