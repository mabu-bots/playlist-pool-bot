// ==========================================
// 🧪 テスト: プールの操作 (純粋関数)
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  addToPool,
  buildExportMarkdown,
  buildListDescriptions,
  chunkLinesByLength,
  formatPoolLines,
  partitionEntries,
  removeFromPool,
  WEEKLY_LIMIT_PER_USER,
  type PoolEntry,
} from "../src/pool.js";
import { parseTrackInput } from "../src/track.js";

const ALICE = { id: "u1", name: "Alice" };
const BOB = { id: "u2", name: "Bob" };
const NOW = new Date("2026-11-19T03:00:00Z");

function parsed(raw: string) {
  const p = parseTrackInput(raw);
  assert.ok(p);
  return p;
}

function addOk(entries: PoolEntry[], raw: string, user = ALICE): PoolEntry[] {
  const r = addToPool(entries, parsed(raw), user, NOW);
  assert.ok(r.ok, `追加できるはず: ${raw}`);
  return r.entries;
}

test("addToPool: 追加でき、元の配列は変更されない", () => {
  const start: PoolEntry[] = [];
  const next = addOk(start, "曲A");
  assert.equal(start.length, 0);
  assert.equal(next.length, 1);
  assert.equal(next[0].addedByName, "Alice");
});

test("addToPool: 同一トラック (URL と URI) は重複として弾く", () => {
  const id = "4uLU6hMCjMI75M1A2tKUQC";
  const entries = addOk([], `https://open.spotify.com/track/${id}`);
  const r = addToPool(entries, parsed(`spotify:track:${id}`), BOB, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "duplicate");
  assert.equal(entries.length, 1); // 元のプールは変更されていない
});

test("addToPool: 自由テキストは正規化して重複判定する", () => {
  const entries = addOk([], "Song  Name");
  const r = addToPool(entries, parsed(" song name "), BOB, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "duplicate");
});

test("addToPool: 1 人あたり週 20 曲の上限", () => {
  let entries: PoolEntry[] = [];
  for (let i = 0; i < WEEKLY_LIMIT_PER_USER; i++) {
    entries = addOk(entries, `曲${i}`);
  }
  const r = addToPool(entries, parsed("曲オーバー"), ALICE, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "limit");
  // 他のユーザーはまだ追加できる
  const r2 = addToPool(entries, parsed("曲オーバー"), BOB, NOW);
  assert.equal(r2.ok, true);
});

test("removeFromPool: 自分の曲は消せる、他人の曲は消せない", () => {
  let entries = addOk([], "曲A", ALICE);
  entries = addOk(entries, "曲B", BOB);
  const forbidden = removeFromPool(entries, 1, BOB.id, false);
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.reason, "forbidden");
  const own = removeFromPool(entries, 2, BOB.id, false);
  assert.equal(own.ok, true);
  if (own.ok) {
    assert.equal(own.removed.text, "曲B");
    assert.equal(own.entries.length, 1);
  }
});

test("removeFromPool: 管理者は他人の曲も消せる", () => {
  const entries = addOk([], "曲A", ALICE);
  const r = removeFromPool(entries, 1, BOB.id, true);
  assert.equal(r.ok, true);
});

test("removeFromPool: 範囲外の番号は not_found", () => {
  const entries = addOk([], "曲A");
  assert.equal(removeFromPool(entries, 0, ALICE.id, false).ok, false);
  const r = removeFromPool(entries, 2, ALICE.id, false);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_found");
});

test("formatPoolLines: 番号と追加者名付き、上限を超えたら省略表示", () => {
  let entries = addOk([], "曲A", ALICE);
  entries = addOk(entries, "曲B", BOB);
  assert.deepEqual(formatPoolLines(entries), ["1. 曲A (@Alice)", "2. 曲B (@Bob)"]);
  const lines = formatPoolLines(entries, 1);
  assert.deepEqual(lines, ["1. 曲A (@Alice)", "…他 1 件"]);
});

test("chunkLinesByLength: 累計文字数で分割し、各塊が上限以下になる", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line-${i}-xxxxxxxxxx`);
  const chunks = chunkLinesByLength(lines, 65);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.join("\n").length <= 65);
  }
  assert.deepEqual(chunks.flat(), lines);
});

test("chunkLinesByLength: 1 行だけで上限を超える場合は切り詰める", () => {
  const chunks = chunkLinesByLength(["x".repeat(100)], 50);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0][0].length <= 50);
  assert.ok(chunks[0][0].endsWith("…"));
});

test("buildListDescriptions: 長い曲名でも各 description が上限以下になる", () => {
  let entries: PoolEntry[] = [];
  for (let i = 0; i < 30; i++) {
    entries = addOk(entries, `とても長い曲名のテストソング ${"あ".repeat(40)} ${i}`, i % 2 ? BOB : ALICE);
  }
  const descriptions = buildListDescriptions(entries, 1000);
  assert.ok(descriptions.length >= 2);
  for (const d of descriptions) assert.ok(d.length <= 1000);
});

test("partitionEntries と buildExportMarkdown: フォールバック書き出し", () => {
  const id = "4uLU6hMCjMI75M1A2tKUQC";
  let entries = addOk([], `https://open.spotify.com/track/${id}`, ALICE);
  entries = addOk(entries, "自由テキスト曲", BOB);
  const { withTrackId, textOnly } = partitionEntries(entries);
  assert.equal(withTrackId.length, 1);
  assert.equal(textOnly.length, 1);
  const md = buildExportMarkdown(entries, "2026-W47");
  assert.ok(md.startsWith("## プレイリストプール 2026-W47 (2 曲)"));
  assert.ok(md.includes(`1. https://open.spotify.com/track/${id} (@Alice)`));
  assert.ok(md.includes("2. [自由テキスト曲](https://open.spotify.com/search/"));
});
