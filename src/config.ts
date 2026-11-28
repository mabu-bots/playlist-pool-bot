// ==========================================
// ⚙️ 設定 (.env)
// ==========================================
// ⚙️ 環境変数から Bot の設定を組み立てる。
// 実値は .env (git 管理外) にだけ置き、ここでは読むだけにする。
import { spotifyConfigFromEnv, type SpotifyConfig } from "./spotify.js";

export interface Config {
  // Discord Bot のトークン
  token: string;
  // アプリケーション (Bot) のクライアント ID
  clientId: string;
  // 開発用にコマンドを即時登録するギルド ID (任意)
  guildId: string | null;
  // 状態ファイルのパス
  statePath: string;
  // Spotify 連携 (未設定なら null → /export はフォールバック動作)
  spotify: SpotifyConfig | null;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`環境変数 ${name} が設定されていません (.env を確認してください)`);
  return v;
}

export function loadConfig(): Config {
  const guildId = process.env.GUILD_ID?.trim();
  return {
    token: required("DISCORD_TOKEN"),
    clientId: required("CLIENT_ID"),
    guildId: guildId ? guildId : null,
    statePath: process.env.STATE_PATH?.trim() || "data/state.json",
    spotify: spotifyConfigFromEnv(process.env),
  };
}
