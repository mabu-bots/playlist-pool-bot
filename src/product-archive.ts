// ==========================================
// 🗃️ 生成物のサーバー保存 (確認用アーカイブ)
// ==========================================
// 🗃️ /export が生成した Markdown ファイルを Bot のサーバー側に保存し、
// 何が書き出されたかを後から確認できるようにする。保存先は運営者だけが
// 見られるサーバー内 (既定: data/archive)。
//
// - 生成ファイル (.md) と、1 行 1 件の index.jsonl (いつ・誰が・どの週の
//   プールを・何件書き出したか) をセットで残す
// - 保持は最大 30 日 かつ 最大 1,000 件。超えたファイルは古い順に
//   自動削除する (index.jsonl は記録として残す)
// - 保存に失敗しても書き出し自体は失敗させない (呼び出し側で握る)
// - 止めたいときは環境変数 PRODUCT_ARCHIVE=off。保存先は PRODUCT_ARCHIVE_DIR
import { appendFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ARCHIVE_MAX_ITEMS = 1000;
export const ARCHIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_ARCHIVE_DIR = "data/archive";

export interface ProductArchiveEntry {
  kind: "playlist-export";
  guildId: string | null;
  channelId: string | null;
  requesterId: string;
  weekKey: string;
  entryCount: number;
}

export function archiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.PRODUCT_ARCHIVE ?? "").trim().toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
}

export function archiveDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRODUCT_ARCHIVE_DIR?.trim() || DEFAULT_ARCHIVE_DIR;
}

// ファイル名: 時刻順に並ぶよう UTC タイムスタンプ + 実行者 + 週キー
export function buildArchiveFileName(date: Date, requesterId: string, weekKey: string): string {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  return `${stamp}_${requesterId}_${weekKey}.md`;
}

export interface ArchiveFileInfo {
  name: string;
  mtimeMs: number;
}

// 削除対象の選定 (純ロジック): 保持期間を超えたものを消し、それでも
// 上限件数を超える場合は古い順に消す。対象は .md のみ。
export function selectPruneTargets(
  files: ArchiveFileInfo[],
  now: number,
  maxItems: number = ARCHIVE_MAX_ITEMS,
  maxAgeMs: number = ARCHIVE_MAX_AGE_MS,
): string[] {
  const mds = files
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  const targets: string[] = [];
  const fresh = mds.filter((f) => {
    if (now - f.mtimeMs > maxAgeMs) {
      targets.push(f.name);
      return false;
    }
    return true;
  });
  const excess = fresh.length - maxItems;
  if (excess > 0) {
    for (const f of fresh.slice(0, excess)) targets.push(f.name);
  }
  return targets;
}

// 生成ファイルとメタデータを保存し、ついでに古いファイルを掃除する。
export async function saveProductArchive(
  dir: string,
  entry: ProductArchiveEntry,
  content: Buffer,
  now: Date = new Date(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const fileName = buildArchiveFileName(now, entry.requesterId, entry.weekKey);
  await writeFile(join(dir, fileName), content);
  const record = { ts: now.toISOString(), file: fileName, ...entry };
  await appendFile(join(dir, "index.jsonl"), JSON.stringify(record) + "\n", "utf8");
  const names = await readdir(dir);
  const infos: ArchiveFileInfo[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const s = await stat(join(dir, name));
    infos.push({ name, mtimeMs: s.mtimeMs });
  }
  for (const target of selectPruneTargets(infos, now.getTime())) {
    await unlink(join(dir, target)).catch(() => {});
  }
  return fileName;
}
