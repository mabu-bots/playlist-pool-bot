// ==========================================
// 🧪 テスト: READY ウォッチドッグの判定ロジック
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { ReadyWatchdog } from "../src/watchdog.js";

const LIMIT = 120_000;
const T0 = 1_700_000_000_000;

test("ReadyWatchdog: 起動直後は期限切れでない", () => {
  const wd = new ReadyWatchdog(T0);
  assert.equal(wd.isExpired(T0, LIMIT), false);
  assert.equal(wd.isExpired(T0 + LIMIT - 1, LIMIT), false);
});

test("ReadyWatchdog: READY が来ないまま上限を超えたら期限切れ", () => {
  const wd = new ReadyWatchdog(T0);
  wd.observe(false, T0 + 10_000);
  assert.equal(wd.isExpired(T0 + LIMIT, LIMIT), true);
});

test("ReadyWatchdog: READY を受けたら期限切れにならない", () => {
  const wd = new ReadyWatchdog(T0);
  wd.observe(true, T0 + 60_000);
  assert.equal(wd.isExpired(T0 + LIMIT * 3, LIMIT), false);
});

test("ReadyWatchdog: READY 喪失の瞬間から数え直す", () => {
  const wd = new ReadyWatchdog(T0);
  wd.observe(true, T0 + 60_000); // READY
  wd.observe(false, T0 + 90_000); // 喪失 → ここから数える
  assert.equal(wd.isExpired(T0 + 90_000 + LIMIT - 1, LIMIT), false);
  assert.equal(wd.isExpired(T0 + 90_000 + LIMIT, LIMIT), true);
});

test("ReadyWatchdog: 発動後は起点がリセットされる", () => {
  const wd = new ReadyWatchdog(T0);
  assert.equal(wd.isExpired(T0 + LIMIT, LIMIT), true);
  wd.onFire(T0 + LIMIT);
  assert.equal(wd.isExpired(T0 + LIMIT, LIMIT), false);
  assert.equal(wd.isExpired(T0 + LIMIT * 2, LIMIT), true);
});
