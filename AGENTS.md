# Project
This repository is `pear-desktop-discord-radio`.

## Product intent
A personal Windows-only local Discord radio bot that uses Pear Desktop as the playback/search/queue authority. In the supported v2 topology, the patched Pear fork lives at the repo root and the Node bot/runtime package lives under `apps/discord-radio-bot`.

## Hard rules
- Pear is the single source of truth for playback state and queue.
- Do not create a second queue in the bot.
- Do not add cloud hosting, public HTTP interactions, or a database in v1.
- Do not reintroduce the old stock-Pear/helper path as the supported runtime; the current supported path is the root direct-audio-export Pear patch plus the Node bot runtime.
- Prefer Node built-ins over extra dependencies when practical.
- Keep the single-repo topology: root = patched Pear fork, `apps/discord-radio-bot` = bot/runtime package.
- Prefer root wrapper entry points where they exist; use explicit `pnpm --dir apps/discord-radio-bot run ...` commands for bot-only operations.
- Optimize for clarity, debuggability, and Windows reliability over cleverness.
