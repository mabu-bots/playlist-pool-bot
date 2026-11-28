// ==========================================
// 🧪 テスト: Spotify 連携の設定判定と追加処理
// ==========================================
// 実際の Spotify API は呼ばない。fetch を差し替えて模擬する。
// /export がフォールバックへ進む条件は「spotifyConfigFromEnv が null を
// 返すこと」であり、ここでその判定とバッチ追加の挙動を検証する。
// フォールバックの文面生成 (buildExportMarkdown) は pool.test.ts で検証する。
import assert from "node:assert/strict";
import test from "node:test";
import {
  SpotifyAddError,
  addTracksToPlaylist,
  spotifyConfigFromEnv,
  type SpotifyConfig,
} from "../src/spotify.js";

const FULL = {
  SPOTIFY_CLIENT_ID: "dummy-client-id",
  SPOTIFY_CLIENT_SECRET: "dummy-client-secret",
  SPOTIFY_REFRESH_TOKEN: "dummy-refresh-token",
  SPOTIFY_PLAYLIST_ID: "dummy-playlist-id",
} as NodeJS.ProcessEnv;

test("spotifyConfigFromEnv: 4 つ揃えば設定を返す", () => {
  const cfg = spotifyConfigFromEnv(FULL);
  assert.ok(cfg);
  assert.equal(cfg.clientId, "dummy-client-id");
  assert.equal(cfg.playlistId, "dummy-playlist-id");
});

test("spotifyConfigFromEnv: 1 つでも欠ければ null (フォールバック)", () => {
  for (const key of Object.keys(FULL)) {
    const env = { ...FULL };
    delete env[key];
    assert.equal(spotifyConfigFromEnv(env), null, `${key} が無い場合は null`);
  }
});

test("spotifyConfigFromEnv: 空文字・空白だけは未設定扱い", () => {
  assert.equal(spotifyConfigFromEnv({ ...FULL, SPOTIFY_REFRESH_TOKEN: "" }), null);
  assert.equal(spotifyConfigFromEnv({ ...FULL, SPOTIFY_CLIENT_ID: "  " }), null);
  assert.equal(spotifyConfigFromEnv({}), null);
});

const CFG: SpotifyConfig = {
  clientId: "dummy-client-id",
  clientSecret: "dummy-client-secret",
  refreshToken: "dummy-refresh-token",
  playlistId: "dummy-playlist-id",
};

function trackIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `track${i}`);
}

// fetch を差し替えて Spotify API を模擬する (addBatchResults: バッチごとの成否)
function stubFetch(addBatchResults: boolean[]): () => void {
  const original = globalThis.fetch;
  let addCalls = 0;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes("accounts.spotify.com")) {
      return { ok: true, json: async () => ({ access_token: "dummy-token" }) };
    }
    const ok = addBatchResults[addCalls] ?? true;
    addCalls += 1;
    return { ok, json: async () => ({}) };
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("addTracksToPlaylist: 100 件ごとに分割して全件追加する", async () => {
  const restore = stubFetch([true, true]);
  try {
    const result = await addTracksToPlaylist(CFG, trackIds(101));
    assert.equal(result.added, 101);
    assert.equal(result.playlistUrl, "https://open.spotify.com/playlist/dummy-playlist-id");
  } finally {
    restore();
  }
});

test("addTracksToPlaylist: バッチ途中失敗時は追加済み件数をエラーに含める", async () => {
  const restore = stubFetch([true, false]); // 1 バッチ目 (100 件) 成功、2 バッチ目失敗
  try {
    await assert.rejects(addTracksToPlaylist(CFG, trackIds(101)), (err: unknown) => {
      assert.ok(err instanceof SpotifyAddError);
      assert.equal(err.added, 100);
      return true;
    });
  } finally {
    restore();
  }
});
