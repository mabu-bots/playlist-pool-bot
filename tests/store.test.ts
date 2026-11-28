// ==========================================
// 🧪 テスト: ストア (永続化・週の切り替わり・リセット)
// ==========================================
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../src/store.js";
import { parseTrackInput } from "../src/track.js";

function jst(y: number, mo: number, d: number, h = 12): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9));
}

function tempStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "playlist-pool-test-"));
  return { store: new Store(join(dir, "state.json")), dir };
}

const ALICE = { id: "u1", name: "Alice" };

function parsed(raw: string) {
  const p = parseTrackInput(raw);
  assert.ok(p);
  return p;
}

test("Store: 追加した曲が永続化され、再読込でも残る", () => {
  const { store, dir } = tempStore();
  const path = join(dir, "state.json");
  const r = store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 19));
  assert.equal(r.ok, true);
  const reopened = new Store(path);
  const pool = reopened.currentPool("g1", jst(2026, 11, 19));
  assert.equal(pool.length, 1);
  assert.equal(pool[0].text, "曲A");
  rmSync(dir, { recursive: true, force: true });
});

test("Store: 週が替わると新しいプールになる (ISO 週キーで分離)", () => {
  const { store, dir } = tempStore();
  store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 22)); // W47 の日曜
  assert.equal(store.currentPool("g1", jst(2026, 11, 22)).length, 1);
  assert.equal(store.currentPool("g1", jst(2026, 11, 23)).length, 0); // W48 の月曜
  // 先週分はキー指定で残っている
  assert.equal(store.poolFor("g1", "2026-W47").length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("Store: guild が違えばプールは混ざらない", () => {
  const { store, dir } = tempStore();
  store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 19));
  assert.equal(store.currentPool("g2", jst(2026, 11, 19)).length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("Store: /pool new で今週分が退避され、プールが空になる", () => {
  const { store, dir } = tempStore();
  store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 19));
  const archiveKey = store.resetCurrentPool("g1", jst(2026, 11, 19));
  assert.equal(archiveKey, "2026-W47~1");
  assert.equal(store.currentPool("g1", jst(2026, 11, 19)).length, 0);
  assert.equal(store.poolFor("g1", "2026-W47~1").length, 1);
  // 空のときは null、2 回目の退避は連番が進む
  assert.equal(store.resetCurrentPool("g1", jst(2026, 11, 19)), null);
  store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 19));
  assert.equal(store.resetCurrentPool("g1", jst(2026, 11, 19)), "2026-W47~2");
  rmSync(dir, { recursive: true, force: true });
});

test("Store: サマリ送信先と送信済みフラグの永続化", () => {
  const { store, dir } = tempStore();
  const path = join(dir, "state.json");
  store.setSummaryChannel("g1", "c1");
  store.markSummarySent("g1", "2026-W47");
  const reopened = new Store(path);
  assert.equal(reopened.data.summaryChannels["g1"], "c1");
  assert.equal(reopened.data.lastSummaryWeek["g1"], "2026-W47");
  rmSync(dir, { recursive: true, force: true });
});

test("Store: 書き出し済み trackId が guild+週キー単位で永続化される", () => {
  const { store, dir } = tempStore();
  const path = join(dir, "state.json");
  store.markTracksExported("g1", "2026-W47", ["trackA", "trackB"]);
  store.markTracksExported("g1", "2026-W47", ["trackB", "trackC"]); // 重複は 1 件にまとまる
  store.markTracksExported("g1", "2026-W48", ["trackD"]);
  assert.deepEqual([...store.exportedTrackIds("g1", "2026-W47")].sort(), ["trackA", "trackB", "trackC"]);
  assert.deepEqual([...store.exportedTrackIds("g1", "2026-W48")], ["trackD"]);
  assert.equal(store.exportedTrackIds("g2", "2026-W47").size, 0);
  const reopened = new Store(path);
  assert.deepEqual([...reopened.exportedTrackIds("g1", "2026-W47")].sort(), ["trackA", "trackB", "trackC"]);
  rmSync(dir, { recursive: true, force: true });
});

test("Store: 保存に失敗した操作はメモリにも残らず、次の保存でも永続化されない", () => {
  const { store, dir } = tempStore();
  const path = join(dir, "state.json");
  store.addEntry("g1", parsed("曲A"), ALICE, jst(2026, 11, 19));
  // tmp パスをディレクトリにして書き込みを失敗させる
  mkdirSync(`${path}.tmp`);
  assert.throws(() => store.addEntry("g1", parsed("曲B"), ALICE, jst(2026, 11, 19)));
  // 失敗した追加はメモリに残らない
  assert.equal(store.currentPool("g1", jst(2026, 11, 19)).length, 1);
  rmSync(`${path}.tmp`, { recursive: true, force: true });
  // 次の成功した保存でも、失敗した曲Bは永続化されない
  store.addEntry("g1", parsed("曲C"), ALICE, jst(2026, 11, 19));
  const reopened = new Store(path);
  const texts = reopened.currentPool("g1", jst(2026, 11, 19)).map((e) => e.text);
  assert.deepEqual(texts, ["曲A", "曲C"]);
  rmSync(dir, { recursive: true, force: true });
});

test("Store: 壊れた状態ファイルでも空で起動する", () => {
  const dir = mkdtempSync(join(tmpdir(), "playlist-pool-test-"));
  const path = join(dir, "state.json");
  writeFileSync(path, "{broken json", "utf-8");
  const store = new Store(path);
  assert.deepEqual(store.data.pools, {});
  rmSync(dir, { recursive: true, force: true });
});
