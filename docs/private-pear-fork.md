# Private Pear Patch

This document records the supported Pear-side patch set for the v2 direct-audio-export path.

## Supported Topology

- This repo root contains the patched Pear Desktop code.
- The Discord bot/runtime package lives under [apps/discord-radio-bot](../apps/discord-radio-bot).
- The supported launch contract for the Pear side is the root script:
  - `pnpm start:direct-audio-export`
- No external sibling Pear repository is part of the supported setup.

## One-Time Setup

At the repo root:

1. `pnpm install`
2. `pnpm build`

In the bot package:

1. `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`

For direct bot-package commands, make the environment available either by exporting the variables in the current shell or by placing a matching `.env` in `apps/discord-radio-bot/`. The repo-root `.env` fallback applies automatically only when you go through the root wrapper commands.

The integrated startup path is:

1. `pnpm doctor:radio-bot`
2. `pnpm --dir apps/discord-radio-bot run sync-commands`
3. `pnpm start:radio-stack`

## Runtime Contract

- Host: `127.0.0.1`
- Port: `26538`
- direct-audio-export plugin: enabled in the Pear app built from this repo root
- Launcher default: `PEAR_DESKTOP_DIR` is optional and defaults to this repo root

## Pear-Side Patch Lineage

The supported root patch set includes the direct-audio-export work that originally landed as:

1. `7d9ab600da3ed9ef5b20cd9eac644abd84bdb882` `feat: add direct audio export plugin transport`
2. `c8e276d6ad7fbd85fc2544da113818b15ccc72ed` `fix: suppress local monitor while export client is attached`
3. `d73f2823edfce290bb134858d899891d40c23b03` `fix: keep bootstrap freshness alive while producer is idle`

Those changes are now represented as code inside this repository root rather than in a separate sibling repo.

## Verification Notes

- Root `pnpm install` completed during the topology migration.
- Root `pnpm build` is the expected Pear-side setup command.
- Bot-side verification is driven through `pnpm doctor:radio-bot`, `pnpm test:radio-bot`, and `pnpm start:radio-stack`.
- Manual Windows verification for the supported path is tracked in [windows-soak-checklist.md](./windows-soak-checklist.md) and [windows-soak-results-template.md](./windows-soak-results-template.md).
