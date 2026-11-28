// ==========================================
// 🗄️ 状態ストア (JSON ファイル)
// ==========================================
// 🗄️ 週ごとのプール、週次サマリの送信先と送信済みフラグ、Spotify へ
// 書き出し済みの記録を保持する。
// 書き込みは tmp ファイル + rename で原子的 (atomic) に行う。
// 状態の更新は「複製した次状態を保存できてからメモリへ差し替える」
// 方式: 保存に失敗した操作はメモリにも残らず、次の成功した保存で
// こっそり永続化されることもない。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { addToPool, removeFromPool, type AddResult, type PoolEntry, type RemoveResult } from "./pool.js";
import type { ParsedTrackInput } from "./track.js";
import { weekKeyOf } from "./week.js";

// ------------------------------------------
// 🧩 型
// ------------------------------------------
export interface State {
  // guildId -> weekKey -> プール
  // 手動リセットで退避したプールは "<weekKey>~<連番>" のキーに入る
  pools: Record<string, Record<string, PoolEntry[]>>;
  // guildId -> 週次サマリの送信先チャンネル ID
  summaryChannels: Record<string, string>;
  // guildId -> 最後にサマリを送った週キー (重複防止フラグ)
  lastSummaryWeek: Record<string, string>;
  // guildId -> weekKey -> Spotify へ書き出し済みの trackId 一覧 (/export の冪等性)
  exportedTracks: Record<string, Record<string, string[]>>;
}

export function emptyState(): State {
  return { pools: {}, summaryChannels: {}, lastSummaryWeek: {}, exportedTracks: {} };
}

// guild ごとに保持するプールのキー数 (古い週から間引く)
const POOL_KEYS_CAP = 12;

// ------------------------------------------
// 💾 読み書き
// ------------------------------------------
export class Store {
  private state: State;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.state = emptyState();
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf-8"));
        if (parsed && typeof parsed === "object") {
          this.state = { ...emptyState(), ...parsed };
        }
      } catch {
        // 壊れた状態ファイルで Bot を止めない: 空の状態で起動する
        this.state = emptyState();
      }
    }
  }

  get data(): State {
    return this.state;
  }

  // 次状態をファイルへ書く (成功しなければ例外。メモリ状態は触らない)
  private writeState(next: State): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
    renameSync(tmp, this.path);
  }

  // guild ごとに直近のプールだけを残す (週キーの辞書順 = 時系列順)
  private trimState(state: State): void {
    for (const guildId of Object.keys(state.pools)) {
      const weeks = state.pools[guildId];
      const keys = Object.keys(weeks).sort();
      if (keys.length > POOL_KEYS_CAP) {
        state.pools[guildId] = Object.fromEntries(
          keys.slice(keys.length - POOL_KEYS_CAP).map((k) => [k, weeks[k]]),
        );
      }
    }
    for (const guildId of Object.keys(state.exportedTracks)) {
      const weeks = state.exportedTracks[guildId];
      const keys = Object.keys(weeks).sort();
      if (keys.length > POOL_KEYS_CAP) {
        state.exportedTracks[guildId] = Object.fromEntries(
          keys.slice(keys.length - POOL_KEYS_CAP).map((k) => [k, weeks[k]]),
        );
      }
    }
  }

  // 現在の状態を保存する。保存に成功してからメモリ状態を差し替える
  save(): void {
    const next = structuredClone(this.state);
    this.trimState(next);
    this.writeState(next);
    this.state = next;
  }

  // 変更を加えた次状態を保存し、成功した場合だけメモリへ反映する。
  // 保存に失敗すると例外が伝播し、メモリ状態は変更前のままになる。
  private commit(mutate: (draft: State) => void): void {
    const next = structuredClone(this.state);
    mutate(next);
    this.trimState(next);
    this.writeState(next);
    this.state = next;
  }

  // ------------------------------------------
  // 🎶 プールの操作
  // ------------------------------------------
  poolFor(guildId: string, weekKey: string): PoolEntry[] {
    return this.state.pools[guildId]?.[weekKey] ?? [];
  }

  currentPool(guildId: string, now: Date): PoolEntry[] {
    return this.poolFor(guildId, weekKeyOf(now));
  }

  addEntry(
    guildId: string,
    parsed: ParsedTrackInput,
    user: { id: string; name: string },
    now: Date,
  ): AddResult {
    const weekKey = weekKeyOf(now);
    const result = addToPool(this.poolFor(guildId, weekKey), parsed, user, now);
    if (result.ok) {
      const entries = result.entries;
      this.commit((draft) => {
        (draft.pools[guildId] ??= {})[weekKey] = entries;
      });
    }
    return result;
  }

  removeEntry(
    guildId: string,
    number: number,
    requesterId: string,
    isAdmin: boolean,
    now: Date,
  ): RemoveResult {
    const weekKey = weekKeyOf(now);
    const result = removeFromPool(this.poolFor(guildId, weekKey), number, requesterId, isAdmin);
    if (result.ok) {
      const entries = result.entries;
      this.commit((draft) => {
        (draft.pools[guildId] ??= {})[weekKey] = entries;
      });
    }
    return result;
  }

  // 今週のプールを退避して空にする (/pool new)。
  // 退避先キー ("<weekKey>~<連番>") を返す。空なら null。
  resetCurrentPool(guildId: string, now: Date): string | null {
    const weekKey = weekKeyOf(now);
    const weeks = this.state.pools[guildId] ?? {};
    const current = weeks[weekKey] ?? [];
    if (current.length === 0) return null;
    let n = 1;
    while (weeks[`${weekKey}~${n}`] !== undefined) n += 1;
    const archiveKey = `${weekKey}~${n}`;
    this.commit((draft) => {
      const draftWeeks = (draft.pools[guildId] ??= {});
      draftWeeks[archiveKey] = current;
      draftWeeks[weekKey] = [];
    });
    return archiveKey;
  }

  // ------------------------------------------
  // 📋 週次サマリの設定
  // ------------------------------------------
  setSummaryChannel(guildId: string, channelId: string): void {
    this.commit((draft) => {
      draft.summaryChannels[guildId] = channelId;
    });
  }

  markSummarySent(guildId: string, weekKey: string): void {
    this.commit((draft) => {
      draft.lastSummaryWeek[guildId] = weekKey;
    });
  }

  // ------------------------------------------
  // ✅ Spotify 書き出し済みの記録 (/export の冪等性)
  // ------------------------------------------
  exportedTrackIds(guildId: string, weekKey: string): Set<string> {
    return new Set(this.state.exportedTracks[guildId]?.[weekKey] ?? []);
  }

  markTracksExported(guildId: string, weekKey: string, trackIds: string[]): void {
    if (trackIds.length === 0) return;
    this.commit((draft) => {
      const weeks = (draft.exportedTracks[guildId] ??= {});
      const merged = new Set(weeks[weekKey] ?? []);
      for (const id of trackIds) merged.add(id);
      weeks[weekKey] = [...merged];
    });
  }
}
