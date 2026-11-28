// ==========================================
// 🟢 Spotify Web API 連携
// ==========================================
// 🟢 /export 用。リフレッシュトークンでアクセストークンを取り、
// 対象プレイリストへトラックを追加する。
// 認証情報が 1 つでも欠けていれば「未設定」として扱い、呼び出し側は
// 検索リンク付きリストのフォールバックに切り替える。

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  playlistId: string;
}

// 環境変数の組から Spotify 設定を作る。揃っていなければ null
export function spotifyConfigFromEnv(env: NodeJS.ProcessEnv): SpotifyConfig | null {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = env.SPOTIFY_CLIENT_SECRET?.trim();
  const refreshToken = env.SPOTIFY_REFRESH_TOKEN?.trim();
  const playlistId = env.SPOTIFY_PLAYLIST_ID?.trim();
  if (!clientId || !clientSecret || !refreshToken || !playlistId) return null;
  return { clientId, clientSecret, refreshToken, playlistId };
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
// プレイリスト追加 API は 1 リクエスト最大 100 件
const ADD_BATCH_SIZE = 100;

async function fetchAccessToken(cfg: SpotifyConfig): Promise<string> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Spotify のトークン取得に失敗しました (${res.status})`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Spotify のトークン応答に access_token がありません");
  return data.access_token;
}

export interface SpotifyAddResult {
  // 実際に追加した曲数
  added: number;
  // プレイリストの URL
  playlistUrl: string;
}

// バッチの途中で追加に失敗したことを表すエラー。
// 先行バッチは追加済みのままなので、何件まで追加できたかを保持し、
// 呼び出し側が「追加済み分」を記録して再試行時の重複を防げるようにする。
export class SpotifyAddError extends Error {
  readonly added: number;
  readonly playlistUrl: string;

  constructor(message: string, added: number, playlistUrl: string) {
    super(message);
    this.name = "SpotifyAddError";
    this.added = added;
    this.playlistUrl = playlistUrl;
  }
}

// トラック ID 群をプレイリストへ追加する (100 件ごとに分割)
export async function addTracksToPlaylist(
  cfg: SpotifyConfig,
  trackIds: string[],
): Promise<SpotifyAddResult> {
  const token = await fetchAccessToken(cfg);
  const playlistUrl = `https://open.spotify.com/playlist/${cfg.playlistId}`;
  let added = 0;
  for (let i = 0; i < trackIds.length; i += ADD_BATCH_SIZE) {
    const batch = trackIds.slice(i, i + ADD_BATCH_SIZE);
    const res = await fetch(`${API_BASE}/playlists/${cfg.playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch.map((id) => `spotify:track:${id}`) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new SpotifyAddError(
        `Spotify への曲追加に失敗しました (${res.status})`,
        added,
        playlistUrl,
      );
    }
    added += batch.length;
  }
  return { added, playlistUrl };
}
