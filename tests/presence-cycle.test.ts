// ==========================================
// 🧪 テスト: プレゼンス・サイクル (純粋関数のみ)
// ==========================================
// startPresenceCycle は実クライアントが要るため対象外とし、
// 文字列生成と送信タイミング計算を検証する。
import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESENCE_SEND_LEAD_MS,
  formatElapsedMinutes,
  nextPresenceSend,
  presenceCycleText,
} from "../src/presence-cycle.js";

test("formatElapsedMinutes: 分粒度の整形", () => {
  assert.equal(formatElapsedMinutes(0), "0分");
  assert.equal(formatElapsedMinutes(26 * 60_000), "26分");
  assert.equal(formatElapsedMinutes(86 * 60_000), "1時間26分");
  assert.equal(formatElapsedMinutes(60 * 60_000), "1時間00分");
  assert.equal(formatElapsedMinutes(-5_000), "0分"); // 負数は 0 に丸める
});

test("presenceCycleText: Unix 分の偶奇で 2 パターンを切り替える", () => {
  const startedAt = Date.parse("2026-11-28T00:00:00Z");
  // 偶数分 → 経過時間 (startedAt から 120 分後 = Unix 分は偶数)
  const even = new Date(startedAt + 120 * 60_000);
  assert.equal(Math.floor(even.getTime() / 60_000) % 2, 0);
  assert.equal(presenceCycleText("Bot", startedAt, even), "Bot | 起動して 2時間00分");
  // 奇数分 → 現在時刻 (JST)
  const odd = new Date(startedAt + 121 * 60_000);
  assert.equal(Math.floor(odd.getTime() / 60_000) % 2, 1);
  assert.equal(presenceCycleText("Bot", startedAt, odd), "Bot | 現在時刻 11:01 JST");
});

test("nextPresenceSend: 次の境界の 200ms 前を返す", () => {
  const now = Date.parse("2026-11-28T00:00:10.000Z"); // 分の途中
  const { sendAt, boundary } = nextPresenceSend(now);
  assert.equal(boundary, Date.parse("2026-11-28T00:01:00.000Z"));
  assert.equal(sendAt, boundary - PRESENCE_SEND_LEAD_MS);
});

test("nextPresenceSend: 送信予定を過ぎていれば翌分の境界へ前進する", () => {
  const boundary = Date.parse("2026-11-28T00:01:00.000Z");
  const now = boundary - 100; // 次の境界まで 100ms (リード 200ms を過ぎている)
  const r = nextPresenceSend(now);
  assert.equal(r.boundary, boundary + 60_000);
  assert.equal(r.sendAt, boundary + 60_000 - PRESENCE_SEND_LEAD_MS);
});
