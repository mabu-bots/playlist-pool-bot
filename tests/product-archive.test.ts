// ==========================================
// 🧪 テスト: 生成物のサーバー保存 (アーカイブ)
// ==========================================
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ARCHIVE_MAX_AGE_MS,
  archiveEnabled,
  buildArchiveFileName,
  saveProductArchive,
  selectPruneTargets,
  type ProductArchiveEntry,
} from "../src/product-archive.js";

const ENTRY: ProductArchiveEntry = {
  kind: "playlist-export",
  guildId: "g1",
  channelId: "c1",
  requesterId: "u1",
  weekKey: "2026-W47",
  entryCount: 3,
};

test("ファイル名は時刻順に並び、実行者と週キーを含む", () => {
  const name = buildArchiveFileName(new Date("2026-11-28T03:04:05.678Z"), "u1", "2026-W47");
  assert.equal(name, "20261128-030405Z_u1_2026-W47.md");
});

test("PRODUCT_ARCHIVE=off で無効、未設定は有効", () => {
  assert.equal(archiveEnabled({}), true);
  assert.equal(archiveEnabled({ PRODUCT_ARCHIVE: "off" }), false);
  assert.equal(archiveEnabled({ PRODUCT_ARCHIVE: " OFF " }), false);
  assert.equal(archiveEnabled({ PRODUCT_ARCHIVE: "false" }), false);
  assert.equal(archiveEnabled({ PRODUCT_ARCHIVE: "0" }), false);
  assert.equal(archiveEnabled({ PRODUCT_ARCHIVE: "on" }), true);
});

test("保存すると MD と index.jsonl の1行が残る", async () => {
  const dir = mkdtempSync(join(tmpdir(), "playlist-pool-archive-"));
  try {
    const fileName = await saveProductArchive(
      dir,
      ENTRY,
      Buffer.from("# export", "utf-8"),
      new Date("2026-11-28T03:04:05.000Z"),
    );
    assert.equal(readFileSync(join(dir, fileName), "utf-8"), "# export");
    const lines = readFileSync(join(dir, "index.jsonl"), "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.file, fileName);
    assert.equal(record.weekKey, "2026-W47");
    assert.equal(record.entryCount, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("保持期間超過と上限超過の選定 (.md のみ対象)", () => {
  const now = Date.parse("2026-11-28T00:00:00Z");
  const files = [
    { name: "old.md", mtimeMs: now - ARCHIVE_MAX_AGE_MS - 1 },
    { name: "a.md", mtimeMs: now - 1000 },
    { name: "b.md", mtimeMs: now - 500 },
    { name: "c.md", mtimeMs: now - 100 },
    { name: "index.jsonl", mtimeMs: now - ARCHIVE_MAX_AGE_MS - 1 },
  ];
  // 期間超過で old.md、上限 2 件に対して新しい 3 件 → 最も古い a.md も対象
  const targets = selectPruneTargets(files, now, 2);
  assert.deepEqual([...targets].sort(), ["a.md", "old.md"]);
});

test("実際に古いファイルがある状態で保存すると掃除される", async () => {
  const dir = mkdtempSync(join(tmpdir(), "playlist-pool-archive-"));
  try {
    const stale = join(dir, "stale.md");
    writeFileSync(stale, "old", "utf-8");
    const past = new Date(Date.now() - ARCHIVE_MAX_AGE_MS - 60_000);
    utimesSync(stale, past, past);
    await saveProductArchive(dir, ENTRY, Buffer.from("new", "utf-8"));
    const names = readdirSync(dir);
    assert.ok(!names.includes("stale.md"));
    assert.ok(names.includes("index.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
