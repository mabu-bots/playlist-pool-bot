// ==========================================
// 🎶 プールの操作 (純粋関数)
// ==========================================
// 🎶 週ごとの曲プールに対する追加・削除・整形を、副作用なしで扱う。
// 重複判定と 1 人あたりの上限判定もここで行う。状態の永続化は
// store.ts が担当し、このモジュールは配列を受け取って新しい配列を
// 返すだけにする (元の配列は決して変更しない)。
import { spotifySearchUrl, type ParsedTrackInput } from "./track.js";

// 1 人が 1 週にプールできる曲数
export const WEEKLY_LIMIT_PER_USER = 20;
// /list で表示する最大件数 (Discord の文字数制限への配慮)
export const LIST_DISPLAY_LIMIT = 50;

export interface PoolEntry {
  // 重複判定キー (ParsedTrackInput.key)
  key: string;
  // Spotify トラック ID (自由テキストの場合は null)
  trackId: string | null;
  // 表示用テキスト
  text: string;
  // 追加したユーザーの ID と表示名
  addedBy: string;
  addedByName: string;
  // 追加時刻 (ISO 文字列)
  addedAt: string;
}

export interface PoolUser {
  id: string;
  name: string;
}

// ------------------------------------------
// ➕ 追加
// ------------------------------------------
export type AddResult =
  | { ok: true; entries: PoolEntry[]; entry: PoolEntry; position: number }
  | { ok: false; reason: "duplicate" | "limit" };

// entries は変更せず、新しい配列を返す
export function addToPool(
  entries: PoolEntry[],
  parsed: ParsedTrackInput,
  user: PoolUser,
  now: Date,
): AddResult {
  if (entries.some((e) => e.key === parsed.key)) {
    return { ok: false, reason: "duplicate" };
  }
  const mine = entries.filter((e) => e.addedBy === user.id).length;
  if (mine >= WEEKLY_LIMIT_PER_USER) {
    return { ok: false, reason: "limit" };
  }
  const entry: PoolEntry = {
    key: parsed.key,
    trackId: parsed.trackId,
    text: parsed.text,
    addedBy: user.id,
    addedByName: user.name,
    addedAt: now.toISOString(),
  };
  const next = [...entries, entry];
  return { ok: true, entries: next, entry, position: next.length };
}

// ------------------------------------------
// 🗑️ 削除
// ------------------------------------------
export type RemoveResult =
  | { ok: true; entries: PoolEntry[]; removed: PoolEntry }
  | { ok: false; reason: "not_found" | "forbidden" };

// number は /list の表示番号 (1 始まり)。自分の曲だけ削除でき、
// 管理者 (isAdmin) は他人の曲も削除できる。
export function removeFromPool(
  entries: PoolEntry[],
  number: number,
  requesterId: string,
  isAdmin: boolean,
): RemoveResult {
  const idx = number - 1;
  if (!Number.isInteger(number) || idx < 0 || idx >= entries.length) {
    return { ok: false, reason: "not_found" };
  }
  const target = entries[idx];
  if (target.addedBy !== requesterId && !isAdmin) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, entries: entries.filter((_, i) => i !== idx), removed: target };
}

// ------------------------------------------
// 📋 整形
// ------------------------------------------
// Embed の description 上限 (4,096 字) に対する安全マージン付きの上限
export const LIST_CHUNK_MAX_CHARS = 4000;

// 番号付き一覧の行を作る (追加した人の表示名付き)
export function formatPoolLines(entries: PoolEntry[], limit = LIST_DISPLAY_LIMIT): string[] {
  const shown = entries.slice(0, limit);
  const lines = shown.map((e, i) => `${i + 1}. ${e.text} (@${e.addedByName})`);
  if (entries.length > limit) {
    lines.push(`…他 ${entries.length - limit} 件`);
  }
  return lines;
}

// 行の配列を、結合後の文字数が maxChars 以下になる塊に分割する。
// 1 行だけで maxChars を超える場合はその行を切り詰める。
export function chunkLinesByLength(lines: string[], maxChars = LIST_CHUNK_MAX_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const rawLine of lines) {
    const line = rawLine.length > maxChars ? `${rawLine.slice(0, maxChars - 1)}…` : rawLine;
    const nextLength = current.length === 0 ? line.length : currentLength + 1 + line.length;
    if (current.length > 0 && nextLength > maxChars) {
      chunks.push(current);
      current = [line];
      currentLength = line.length;
    } else {
      current.push(line);
      currentLength = nextLength;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// /list 用: 件数制限済みの行を文字数でも分割し、Embed description の配列にする
export function buildListDescriptions(
  entries: PoolEntry[],
  maxChars = LIST_CHUNK_MAX_CHARS,
): string[] {
  return chunkLinesByLength(formatPoolLines(entries), maxChars).map((chunk) => chunk.join("\n"));
}

// 書き出し用に、Spotify へ直接追加できる曲とテキストのみの曲へ分ける
export function partitionEntries(entries: PoolEntry[]): {
  withTrackId: PoolEntry[];
  textOnly: PoolEntry[];
} {
  return {
    withTrackId: entries.filter((e) => e.trackId !== null),
    textOnly: entries.filter((e) => e.trackId === null),
  };
}

// フォールバック書き出し (Markdown): トラックはその URL、
// 自由テキストは Spotify 検索リンク付きで並べる
export function buildExportMarkdown(entries: PoolEntry[], weekKey: string): string {
  const lines: string[] = [`## プレイリストプール ${weekKey} (${entries.length} 曲)`];
  entries.forEach((e, i) => {
    if (e.trackId !== null) {
      lines.push(`${i + 1}. ${e.text} (@${e.addedByName})`);
    } else {
      lines.push(`${i + 1}. [${e.text}](${spotifySearchUrl(e.text)}) (@${e.addedByName})`);
    }
  });
  return lines.join("\n");
}
