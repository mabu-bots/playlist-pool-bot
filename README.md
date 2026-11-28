# Playlist Pool Bot

| バージョン | 状態 | 稼働先 | 実装 |
|---|---|---|---|
| 1.0.0 | 稼働中 | 台3 minase (pm2) | TypeScript / discord.js v14 / Node.js |

サーバーのみんなで曲を持ち寄って、週次のプレイリストを作る Discord Bot です。
1 週間を 1 プールとして曲を集め、`/export` で Spotify プレイリストへ書き出します
(未連携の場合は検索リンク付きリストを投稿します)。

📜 更新履歴: [CHANGELOG.md](CHANGELOG.md) / 🛠️ 設計: [DESIGN.md](DESIGN.md)

## ✨ 機能

- **曲のプール**: `/add` で今週のプールに曲を追加。Spotify トラック URL /
  `spotify:track:` URI / 自由テキスト (曲名・アーティスト名) のどれでも受け付けます
- **重複・上限チェック**: 同じトラック・同じテキストは重複として弾きます。
  1 人あたり週 20 曲まで
- **週の自動切り替わり**: プールは ISO 週 (月曜始まり、Asia/Tokyo) ごとに分かれており、
  週が替われば自動で新しいプールになります
- **書き出し**: Spotify 連携が設定されていればプレイリストへ直接追加。
  未設定なら Spotify 検索リンク付きのリストを投稿します
- **週次サマリ**: 月曜 9:00 (Asia/Tokyo) に、先週のプール件数を登録チャンネルへ
  自動投稿します

## 📝 コマンド

| コマンド | 内容 |
|---|---|
| `/add <song>` | 今週のプールに曲を追加 (URL / URI / テキスト) |
| `/list` | 今週のプール一覧 (番号・追加した人付き) |
| `/remove <number>` | 番号の曲を取り消す (自分の曲のみ。サーバー管理者は他人の曲も可) |
| `/export` | 今週のプールを書き出す (Spotify 連携時はプレイリストへ追加) |
| `/pool new` | 今週のプールを退避して新しいプールを開始 (サーバー管理権限が必要) |
| `/pool channel` | このチャンネルを週次サマリの投稿先に登録 (サーバー管理権限が必要) |

`/pool new` で退避したプールは状態ファイル内に `<週キー>~<連番>` として残ります
(誤操作時の復旧用。通常のコマンドからは参照しません)。

`/export` が生成した Markdown ファイルは、後から確認できるよう Bot のサーバー内
(`data/archive/`) に自動保存されます。`index.jsonl` に日時・実行者・週キー・
件数が記録され、保持は最大30日／最大1000件 (古い順に自動削除)。この保存先は
運営者だけが見られます。止める場合は環境変数 `PRODUCT_ARCHIVE=off`。

## ⚙️ 環境変数

| 変数 | 必須 | 意味 |
|---|---|---|
| `DISCORD_TOKEN` | ○ | Discord 開発者ポータルで作成した Bot のトークン |
| `CLIENT_ID` | ○ | アプリケーション (Bot) のクライアント ID |
| `GUILD_ID` | - | 設定すると、そのサーバーにだけコマンドを即時登録する (開発用) |
| `STATE_PATH` | - | 状態ファイルのパス (既定 `data/state.json`) |
| `SPOTIFY_CLIENT_ID` | - | Spotify アプリの Client ID (連携用、4 つ一組) |
| `SPOTIFY_CLIENT_SECRET` | - | Spotify アプリの Client Secret (連携用、4 つ一組) |
| `SPOTIFY_REFRESH_TOKEN` | - | プレイリストを編集するアカウントのリフレッシュトークン |
| `SPOTIFY_PLAYLIST_ID` | - | 書き出し先プレイリストの ID |
| `PRODUCT_ARCHIVE` | - | `off` で生成物のサーバー保存を無効化 |
| `PRODUCT_ARCHIVE_DIR` | - | 生成物の保存先 (既定 `data/archive`) |

## 🚀 セットアップ

1. [Discord 開発者ポータル](https://discord.com/developers/applications) で
   アプリケーションを作成し、Bot を追加します。**特権インテントは不要**です
   (Guilds のみで動作します)。
2. Bot をサーバーへ招待します。スコープは `bot` と `applications.commands`、
   権限は「メッセージを送信」「埋め込みリンク」があれば十分です。
3. `.env.example` を `.env` にコピーし、`DISCORD_TOKEN` と `CLIENT_ID` を
   設定します。開発中は `GUILD_ID` を設定するとコマンド登録が即時反映されます。
4. 起動します。コマンドは起動時に自動登録されます。

```bash
npm install
npm run build
npm start
```

登録だけを先に行いたい場合は `npm run deploy` が使えます。

## 🔄 pm2 での常駐

```bash
pm2 start ecosystem.config.cjs
pm2 startup   # 表示されたコマンドを実行
pm2 save
```

## ⚙️ Spotify 連携 (任意)

`/export` を Spotify プレイリストへの直接追加にするには、`.env` に次の 4 つを
すべて設定します。1 つでも欠けている場合は連携なしとして動作し、`/export` は
検索リンク付きリストの投稿にフォールバックします。

| 変数 | 意味 |
|---|---|
| `SPOTIFY_CLIENT_ID` | Spotify アプリの Client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify アプリの Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | プレイリストを編集するアカウントのリフレッシュトークン |
| `SPOTIFY_PLAYLIST_ID` | 書き出し先プレイリストの ID |

取得手順の概要:

1. [Spotify for Developers](https://developer.spotify.com/dashboard) でアプリを作成し、
   Client ID / Client Secret を控えます。Redirect URI に
   `http://127.0.0.1:8888/callback` などを登録します。
2. 認可コードフローで一度だけ認可し、リフレッシュトークンを取得します。
   必要なスコープは、公開プレイリストへの追加なら `playlist-modify-public`、
   非公開プレイリストなら `playlist-modify-private` です。
   (認可 URL の組み立てとトークン交換は Spotify の公式ドキュメント
   "Authorization Code Flow" の手順どおりに、ブラウザと curl で行えます。)
3. 書き出し先プレイリストを開き、URL の
   `https://open.spotify.com/playlist/<ID>` の `<ID>` を `SPOTIFY_PLAYLIST_ID` に設定します。

連携時の `/export` の挙動:

- URL / URI で追加された曲は、そのままプレイリストへ追加されます
  (100 曲ごとに分割して送信)。
- 自由テキストで追加された曲は ID が分からないため直接追加できません。
  結果メッセージに曲名が列挙されるので、Spotify で検索して追加してください。
- API エラー時は、検索リンク付きリストの投稿に自動でフォールバックします。

## 📋 仕様メモ

- 状態 (プール・サマリ設定) は `data/state.json` に保存します
  (`STATE_PATH` で変更可能)。guild ごとに直近 12 件分のプールキーを保持します。
- 週の区切りは ISO 8601 の週番号 (月曜始まり) で、判定は Asia/Tokyo です。
- 週次サマリは月曜 9:00 を過ぎてから Bot が最初にチェックした時点で送られます
  (月曜に Bot が止まっていた場合は再開後にキャッチアップ送信されます)。
- 同じ曲を URL 形式と自由テキスト形式で別々に追加した場合は、形式が違うため
  重複として検出されません。

## 🧭 判断記録

設計判断の詳細は [DESIGN.md](DESIGN.md) の判断記録に集約しています。要点:

- 状態は JSON ファイル + 原子的書き込み (tmp → rename)。保存に成功してから
  メモリへ差し替えるため、失敗した操作が後から永続化されることはない
- 週次サマリの送信済みフラグは「送信成功後」に立てる (失敗した週を取りこぼさない)
- `/export` は書き出し済み trackId を記録して再追加を避ける。ただし既知の課題
  (旧 Issue #1) として冪等性には残件があり、本再作成では仕様変更せず引き継ぐ
  (詳細は DESIGN.md)
- プレゼンスは全 Bot 共通のサイクル表示 (Playing、1 分交代、200ms 先行送信)
- READY が 120 秒来ない停滞はウォッチドッグが検知し、プロセス終了 → pm2 再起動で回復する
