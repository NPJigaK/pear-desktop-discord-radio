# Single-Repo Root-Pear / Bot-Subdir v2 Design

Date: 2026-03-31

## Summary

Restructure the v2 codebase into a single repository where the root is the patched Pear Desktop fork and the Discord bot/runtime lives under `apps/discord-radio-bot/`.

This replaces the temporary sibling-repo/private-fork arrangement. The goal is to keep upstream Pear tracking practical while still shipping a single integrated product repository for this bot.

## Why This Design

The project now depends on Pear-side direct audio export. That means the Pear patch is no longer a peripheral dependency; it is part of the product's core runtime path.

At the same time, this project is not trying to become a generic Pear fork. The product remains the personal Discord radio bot, with Pear acting as the playback/search/queue authority and the bot acting as the Discord adapter and relay runtime.

Given those constraints, the best long-term shape is:

- one repository
- root organized around Pear upstream tracking
- bot/runtime isolated in a dedicated subdirectory
- root-level docs/scripts as the single user-facing entry point

This balances:

- easier Pear upstream merges
- clearer ownership boundaries
- a single repo for product development
- better understandability for future contributors

## Decision

Adopt this repository topology:

- repo root: patched Pear Desktop fork
- `apps/discord-radio-bot/`: Discord bot/runtime, doctor, launcher integration, FFmpeg bootstrap logic, tests, and product-specific docs/code that only belong to the bot
- `docs/`: integrated product documentation
- `scripts/`: root-level orchestration and wrapper scripts

The runtime product remains:

- Pear is the only source of truth for playback, search, and queue
- the supported audio path is Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice
- no bot-side queue or alternate playback authority is introduced

## Repository Topology

Target high-level structure:

```text
/
  package.json                  # Pear-root package
  src/                          # Pear application and patched direct-audio-export code
  docs/                         # integrated product docs
  scripts/                      # root orchestration helpers
  apps/
    discord-radio-bot/
      package.json              # bot-specific package
      src/
      tests/
      config/
      scripts/
      .env.example
```

The root remains the Pear fork. The bot is intentionally not mixed into Pear-root `src/`.

## Boundaries

### Pear-root responsibilities

- track Pear upstream
- contain the direct-audio-export plugin/private Pear patch
- build and run the Pear application
- expose the export transport used by the bot

### Bot-subdir responsibilities

- Discord command handling
- Pear API/WebSocket coordination
- FFmpeg discovery/bootstrap/encode
- doctor/preflight
- runtime supervision and launcher-side orchestration
- soak-oriented product verification

### Root-level shared responsibilities

- integrated README and setup flow
- scripts that start the full radio stack
- documentation describing the whole product

## Package and Script Strategy

Use two packages inside one repository:

- root `package.json`: Pear-root package, kept close to upstream
- `apps/discord-radio-bot/package.json`: bot/runtime package

Do not try to collapse the bot dependencies back into Pear-root `package.json`. That would make upstream tracking noisier and blur the product boundaries.

Root should provide these integrated wrapper scripts for the product:

- `pnpm start:radio-stack`
- `pnpm doctor:radio-bot`
- `pnpm test:radio-bot`

Those wrappers delegate into `apps/discord-radio-bot/`, while Pear-root scripts stay focused on Pear.

## Upstream Tracking Rules

Treat the root as the Pear fork and keep the delta understandable:

1. keep Pear-upstream code at root
2. keep product-specific bot code under `apps/discord-radio-bot/`
3. keep the direct-audio-export patch clearly scoped and documented
4. avoid putting bot-only dependencies and scripts into Pear-root unless they are integration wrappers

This makes future Pear merges substantially easier than a bot-root layout, while still preserving a single product repo.

## Migration Plan

The migration should proceed in this order:

1. establish a clean Pear-root baseline in this repo
2. move current bot code into `apps/discord-radio-bot/`
3. update imports, scripts, paths, and tests to the new bot subdirectory
4. replace sibling-repo assumptions with same-repo root/subdir orchestration
5. update docs, soak guides, and AGENTS guidance to the new topology
6. rerun lint, typecheck, test, and manual Windows stack verification

## Non-Goals

This migration does not change:

- the approved `/radio` command surface
- Pear as playback/search/queue authority
- the FFmpeg strategy
- the direct-audio-export runtime path
- the Windows-only local-only product scope

This migration is about repository topology and maintainability, not product expansion.

## Risks

### Risk: migration churn

Moving the bot into a subdirectory will touch scripts, test paths, docs, and launcher assumptions.

Mitigation:

- do the move in explicit phases
- keep wrapper commands at root
- rerun full repo verification after each phase

### Risk: root docs become ambiguous

A Pear-root repo can look like “just a Pear fork” unless the root docs clearly describe the integrated product.

Mitigation:

- keep root README product-focused
- explicitly document `apps/discord-radio-bot/` as product-specific code

### Risk: upstream merges accidentally disturb bot integration

Mitigation:

- keep bot code isolated under `apps/discord-radio-bot/`
- keep Pear patch scope narrow and documented

## Testing and Verification

After migration, verification should cover both layers:

### Root/Pear verification

- Pear-root build still works
- direct-audio-export plugin/private patch still works

### Bot verification

- lint
- typecheck
- test
- doctor
- integrated launch path

### Manual Windows verification

- full `pnpm start:radio-stack` path
- `/radio join`
- `/radio add`
- `/radio now`
- `/radio control`
- `/radio leave`
- same-machine no-duplicate-audio behavior

## Recommendation

Proceed with a single integrated repo where:

- root is the patched Pear fork
- the bot lives under `apps/discord-radio-bot/`
- root docs and scripts represent the whole product

This is the best compromise between:

- single-repo simplicity
- contributor readability
- Pear upstream tracking
- long-term maintainability
