// ==========================================
// 🧪 テスト: 曲入力のパースと正規化
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFreeText, parseTrackInput, spotifySearchUrl, trackUrl } from "../src/track.js";

const ID = "4uLU6hMCjMI75M1A2tKUQC"; // 22 文字の Base62

test("parseTrackInput: トラック URL (クエリ付き)", () => {
  const p = parseTrackInput(`https://open.spotify.com/track/${ID}?si=abc123`);
  assert.ok(p);
  assert.equal(p.trackId, ID);
  assert.equal(p.text, trackUrl(ID));
  assert.equal(p.key, `spotify:${ID}`);
});

test("parseTrackInput: ロケール付き URL", () => {
  const p = parseTrackInput(`https://open.spotify.com/intl-ja/track/${ID}`);
  assert.ok(p);
  assert.equal(p.trackId, ID);
});

test("parseTrackInput: spotify: URI", () => {
  const p = parseTrackInput(`spotify:track:${ID}`);
  assert.ok(p);
  assert.equal(p.trackId, ID);
  assert.equal(p.text, trackUrl(ID));
});

test("parseTrackInput: URL と URI は同じキーになる (重複判定)", () => {
  const a = parseTrackInput(`https://open.spotify.com/track/${ID}?si=x`);
  const b = parseTrackInput(`spotify:track:${ID}`);
  assert.ok(a && b);
  assert.equal(a.key, b.key);
});

test("parseTrackInput: 自由テキスト", () => {
  const p = parseTrackInput("  米津玄師 - Lemon  ");
  assert.ok(p);
  assert.equal(p.trackId, null);
  assert.equal(p.text, "米津玄師 - Lemon"); // 表示用は前後空白だけ除去
  assert.equal(p.key, "text:米津玄師 - lemon");
});

test("parseTrackInput: 空文字は null", () => {
  assert.equal(parseTrackInput(""), null);
  assert.equal(parseTrackInput("   "), null);
});

test("parseTrackInput: トラックでない Spotify URL はテキスト扱い", () => {
  const p = parseTrackInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  assert.ok(p);
  assert.equal(p.trackId, null);
  assert.ok(p.key.startsWith("text:"));
});

test("normalizeFreeText: 空白圧縮と小文字化", () => {
  assert.equal(normalizeFreeText("  A  B\tC "), "a b c");
  assert.equal(normalizeFreeText("ABC"), "abc");
});

test("spotifySearchUrl: エンコードされる", () => {
  assert.equal(
    spotifySearchUrl("a b&c"),
    "https://open.spotify.com/search/a%20b%26c",
  );
});
