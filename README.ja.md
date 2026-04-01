# pear-desktop-discord-radio 日本語 README

[English README](./README.md)

> v2 の正式構成は単一 repo です。repo root が patched Pear fork、本体の Discord bot/runtime は `apps/discord-radio-bot` にあります。

Windows ローカル専用の Discord ラジオ bot です。  
再生、検索、キュー管理の唯一の正は Pear Desktop で、この repo は Pear と Discord をつなぐ統合プロダクトとして動きます。

## repo 構成

- repo root: patched Pear Desktop fork と `direct-audio-export` plugin
- `apps/discord-radio-bot`: Discord runtime、`doctor`、launcher、FFmpeg bootstrap、slash command sync
- root wrapper entry points:
  - `pnpm start:radio-stack`
  - `pnpm doctor:radio-bot`
  - `pnpm test:radio-bot`
- サポート対象の構成に外部 sibling Pear repo は含みません

## プロダクト境界

- Windows 11 専用
- ローカル実行専用
- 1 guild のみ
- 1 controller user のみ
- 1 voice session のみ
- ルートコマンドは `/radio` のみ
- DB なし
- クラウドなし
- 公開 HTTP interactions endpoint なし

## 必要なもの

- Windows 11
- Node.js 24 以上
- Discord bot の token / application / guild 設定
- この repo root に含まれている patched Pear fork

`FFMPEG_DSHOW_AUDIO_DEVICE` は v2 の正式セットアップでは使いません。

## 最短手順

まず動かすだけなら、この手順がいちばん簡単です。

1. [apps/discord-radio-bot/.env.example](./apps/discord-radio-bot/.env.example) を元にして `E:\github\pear-desktop-discord-radio\.env` を作る
2. 同じ内容を `E:\github\pear-desktop-discord-radio\apps\discord-radio-bot\.env` にもコピーする
3. repo root で次を実行する

```powershell
pnpm install
pnpm build
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
```

4. repo root から Pear を起動する

```powershell
pnpm start:direct-audio-export
```

5. Pear 側で次を有効化する
   - API Server
   - `127.0.0.1`
   - `AUTH_AT_FIRST`
   - `Direct Audio Export (Spike)`
6. repo root に戻って次を実行する

```powershell
pnpm doctor:radio-bot
pnpm --dir apps/discord-radio-bot run sync-commands
```

7. bot を起動する

- step 4 から Pear を開いたままなら:

```powershell
pnpm --dir apps/discord-radio-bot run runtime
```

- Pear が起動していないなら統合起動を使う:

```powershell
pnpm start:radio-stack
```

8. Discord で通常の voice channel に入り、`/radio join` を実行する

`pnpm doctor:radio-bot` が `full-pass: YES` なら、起動前提はそろっています。

## Pear 側の設定

この repo root から起動した Pear で次を設定します。

1. API Server を有効化
2. bind を `127.0.0.1` にする
3. auth mode を `AUTH_AT_FIRST` にする
4. `Direct Audio Export (Spike)` plugin を有効化する

音声経路:

`Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice`

## 環境変数

変数定義の参考は [apps/discord-radio-bot/.env.example](./apps/discord-radio-bot/.env.example) です。

env の読み込み方は起動方法で分かれます。

- `pnpm start:radio-stack`、`pnpm doctor:radio-bot`、`pnpm test:radio-bot` のような root wrapper コマンドは、repo root の `.env` を bot package への fallback source として使います。
- `pnpm --dir apps/discord-radio-bot run sync-commands` や `pnpm --dir apps/discord-radio-bot run runtime` のような direct bot-package コマンドは、その root fallback を自動では受け取りません。そういうコマンドを使うときは、先に shell に環境変数を export するか、`apps/discord-radio-bot/.env` を置いてください。

必須:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_CONTROLLER_USER_ID`
- `PEAR_CLIENT_ID`

任意:

- `PEAR_HOST` 既定値: `127.0.0.1`
- `PEAR_PORT` 既定値: `26538`
- `PEAR_DESKTOP_DIR` override 用。既定はこの repo root
- `FFMPEG_PATH` fallback 用
- `LOG_LEVEL`

注意:

- `PEAR_HOST` は `127.0.0.1` 以外を許可しません
- `FFMPEG_PATH` は通常運用の既定値ではなく fallback です

## インストール

統合 workspace のセットアップは repo root から行います。

```powershell
pnpm install
pnpm build
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
```

- `pnpm install`: root Pear と bot package の依存をまとめて入れます
- `pnpm build`: root Pear を build します
- `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`: pin 済み BtbN `win64-lgpl-shared-8.0` build を `apps/discord-radio-bot/.cache/ffmpeg/` に展開します

FFmpeg 解決順は固定です。

1. app-managed bot-package cache
2. `FFMPEG_PATH`
3. `PATH`

詳細:

- [docs/ffmpeg-management.md](./docs/ffmpeg-management.md)
- [docs/ffmpeg-notice.md](./docs/ffmpeg-notice.md)

## slash command 同期

runtime 起動では自動同期しません。bot package から明示的に同期します。

```powershell
pnpm --dir apps/discord-radio-bot run sync-commands
```

この direct bot-package コマンドを実行する前に、shell export 済みの環境変数か `apps/discord-radio-bot/.env` を用意してください。

## `doctor`

root wrapper から実行します。

```powershell
pnpm doctor:radio-bot
```

主に見るもの:

- Pear host が `127.0.0.1` か
- Pear auth endpoint に到達できるか
- Pear WebSocket endpoint に到達できるか
- plugin export transport が見つかるか
- export PCM contract が runtime 用に成立しているか
- FFmpeg がどこから見つかったか
- export -> Ogg/Opus encode smoke test が通るか

すべて通ると `full-pass: YES` になります。

## 起動

Pear 側のコマンドは root にあります。

```powershell
pnpm dev
pnpm start
pnpm start:direct-audio-export
```

統合起動の正式入口は root wrapper です。

```powershell
pnpm start:radio-stack
```

`pnpm start:radio-stack` は bot package launcher を使って Pear root を解決し、Pear readiness を待ってから Discord runtime を起動します。

Pear がすでに起動済みで bot だけ動かしたいなら:

```powershell
pnpm --dir apps/discord-radio-bot run runtime
```

## 使えるコマンド

### `/radio join`

- controller user の現在いる通常 voice channel に参加します
- すでに別 channel に接続済みなら、その channel に移動します
- stage channel は拒否します
- controller user が VC にいなければ失敗します

### `/radio leave`

- relay を止めて VC から抜けます

### `/radio add query:<string> placement:<queue|next>`

- Pear で検索します
- 結果は Discord の select menu で選びます
- 選んだ曲を Pear のキューに直接追加します
- bot 側の独自キューは作りません

### `/radio now`

- Pear 由来の現在曲を表示します
- `offline | connecting | ready | degraded` を区別します

### `/radio control action:<play|pause|toggle|next|previous>`

- Pear にそのまま制御を送ります

## よく使うコマンド

root entry points:

```text
pnpm start:radio-stack
pnpm doctor:radio-bot
pnpm test:radio-bot
pnpm install
pnpm build
pnpm dev
pnpm start
pnpm start:direct-audio-export
```

bot package 専用:

```text
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
pnpm --dir apps/discord-radio-bot run sync-commands
pnpm --dir apps/discord-radio-bot run runtime
pnpm --dir apps/discord-radio-bot run lint
pnpm --dir apps/discord-radio-bot run typecheck
pnpm --dir apps/discord-radio-bot run test
```

## 実装メモ

- Pear 側 patch は repo root にあります
- Discord runtime は [apps/discord-radio-bot](./apps/discord-radio-bot) にあります
- runtime は gateway-only です
- audio relay は Pear direct audio export + FFmpeg `libopus` / `ogg` を使います
- FFmpeg 解決順は app-managed -> `FFMPEG_PATH` -> `PATH` です

追加 docs:

- [docs/private-pear-fork.md](./docs/private-pear-fork.md)
- [docs/windows-soak-checklist.md](./docs/windows-soak-checklist.md)
- [docs/windows-soak-results-template.md](./docs/windows-soak-results-template.md)

## 手動 Windows 確認

1. repo root で `pnpm install` と `pnpm build`
2. `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`
3. repo root の Pear を起動し API Server を確認
4. `Direct Audio Export (Spike)` plugin を有効化
5. `pnpm doctor:radio-bot` で `full-pass: YES`
6. direct bot-package コマンド用に、shell export か `apps/discord-radio-bot/.env` を用意
7. `pnpm --dir apps/discord-radio-bot run sync-commands`
8. `pnpm start:radio-stack`
9. `/radio join`、`/radio add`、`/radio now`、`/radio control`、`/radio leave` を確認

## 制約

- ネイティブ Windows 11 専用です
- 単一 guild / 単一 controller user です
- 対応 voice channel は通常 guild VC のみです
- 正式な統合起動経路は `pnpm start:radio-stack` です
- slash command は runtime 起動時に自動同期しません
- source install では初回 `bootstrap:ffmpeg` にネットワークが必要です
