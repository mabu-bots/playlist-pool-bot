// ==========================================
// 🧪 テスト: 週次サマリの送信計画とスケジューラ
// ==========================================
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WeeklyScheduler, buildSummaryMessage, planSummaries } from "../src/scheduler.js";
import { Store } from "../src/store.js";
import { parseTrackInput } from "../src/track.js";

function jst(y: number, mo: number, d: number, h = 12, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

function tempStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "playlist-pool-sched-"));
  return { store: new Store(join(dir, "state.json")), dir };
}

const ALICE = { id: "u1", name: "Alice" };

function seedLastWeek(store: Store, count: number): void {
  for (let i = 0; i < count; i++) {
    const parsed = parseTrackInput(`先週の曲${i}`);
    assert.ok(parsed);
    store.addEntry("g1", parsed, ALICE, jst(2026, 11, 19)); // W47
  }
}

test("planSummaries: 月曜 9:00 に先週分を計画する (フラグは送信成功後)", () => {
  const { store, dir } = tempStore();
  store.setSummaryChannel("g1", "c1");
  seedLastWeek(store, 3);
  const mon9 = jst(2026, 11, 23, 9, 0);
  const plans = planSummaries(store, mon9);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].weekKey, "2026-W47");
  assert.equal(plans[0].count, 3);
  assert.equal(plans[0].channelId, "c1");
  // 計画だけでは送信済みフラグは立たない (送信失敗時の再試行のため)。
  // フラグが立つまでは同じ計画が返り続ける。
  assert.equal(store.data.lastSummaryWeek["g1"], undefined);
  assert.equal(planSummaries(store, mon9).length, 1);
  // 送信成功後にフラグを立てると、同じ週は二度と計画されない
  store.markSummarySent("g1", "2026-W47");
  assert.equal(store.data.lastSummaryWeek["g1"], "2026-W47");
  assert.equal(planSummaries(store, mon9).length, 0);
  assert.equal(planSummaries(store, jst(2026, 11, 24, 10)).length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("WeeklyScheduler: 送信失敗時はフラグを立てず次回 tick で再試行し、成功後に立てる", async () => {
  // 実時刻で due になる週を対象にするため、最小限のフェイク Store で tick を駆動する
  const marked: string[] = [];
  let sendAttempts = 0;
  const fakeStore = {
    data: { pools: {}, summaryChannels: { g1: "c1" }, lastSummaryWeek: {}, exportedTracks: {} },
    poolFor: () => [{ key: "k", trackId: null, text: "曲", addedBy: "u1", addedByName: "Alice", addedAt: "" }],
    markSummarySent: (_guildId: string, weekKey: string) => {
      marked.push(weekKey);
    },
  };
  const scheduler = new WeeklyScheduler({
    store: fakeStore as unknown as Store,
    send: async () => {
      sendAttempts += 1;
      if (sendAttempts === 1) throw new Error("送信失敗 (ダミー)");
    },
    log: () => undefined,
  });
  const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);
  await tick(); // 1 回目: 送信失敗 → フラグは立たない
  assert.equal(sendAttempts, 1);
  assert.equal(marked.length, 0);
  await tick(); // 2 回目: 再試行して成功 → フラグが立つ
  assert.equal(sendAttempts, 2);
  assert.equal(marked.length, 1);
});

test("WeeklyScheduler: tick 実行中は再入せず、同じサマリを二重送信しない", async () => {
  let sendCalls = 0;
  let releaseSend: (() => void) | null = null;
  const fakeStore = {
    data: { pools: {}, summaryChannels: { g1: "c1" }, lastSummaryWeek: {}, exportedTracks: {} },
    poolFor: () => [{ key: "k", trackId: null, text: "曲", addedBy: "u1", addedByName: "Alice", addedAt: "" }],
    markSummarySent: () => undefined,
  };
  const scheduler = new WeeklyScheduler({
    store: fakeStore as unknown as Store,
    send: () => {
      sendCalls += 1;
      // 送信が長引く状況を再現する (手動で解放するまで終わらない)
      return new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    },
    log: () => undefined,
  });
  const tick = (scheduler as unknown as { tick(): Promise<void> }).tick.bind(scheduler);
  const first = tick(); // 1 回目: 送信でブロックされる
  await tick(); // 2 回目: 再入ガードで即座に返り、送信は増えない
  assert.equal(sendCalls, 1);
  releaseSend!();
  await first;
  // ガードが解放された後は次の tick が通常どおり動く
  const third = tick();
  assert.equal(sendCalls, 2);
  releaseSend!();
  await third;
});

test("planSummaries: プールが 0 件の週は投稿せずフラグだけ立てる", () => {
  const { store, dir } = tempStore();
  store.setSummaryChannel("g1", "c1");
  const plans = planSummaries(store, jst(2026, 11, 23, 9, 0));
  assert.equal(plans.length, 0);
  assert.equal(store.data.lastSummaryWeek["g1"], "2026-W47");
  rmSync(dir, { recursive: true, force: true });
});

test("planSummaries: サマリ先が未登録の guild は対象外", () => {
  const { store, dir } = tempStore();
  seedLastWeek(store, 1);
  assert.equal(planSummaries(store, jst(2026, 11, 23, 9, 0)).length, 0);
  assert.equal(store.data.lastSummaryWeek["g1"], undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("buildSummaryMessage: 件数と週キーを含む", () => {
  const msg = buildSummaryMessage({ guildId: "g1", channelId: "c1", weekKey: "2026-W47", count: 5 });
  assert.ok(msg.includes("2026-W47"));
  assert.ok(msg.includes("5 曲"));
});
