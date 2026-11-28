// ==========================================
// 🧪 テスト: 週キーと週次サマリ判定
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { isWeekKey, jstParts, summaryDueWeek, weekKeyOf } from "../src/week.js";

// JST の日時を UTC の Date で表すヘルパー (JST = UTC+9)
function jst(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

test("weekKeyOf: ISO 週番号 (木曜基準)", () => {
  assert.equal(weekKeyOf(jst(2026, 11, 19)), "2026-W47"); // 木曜
  assert.equal(weekKeyOf(jst(2026, 11, 16)), "2026-W47"); // 月曜 (週の初め)
  assert.equal(weekKeyOf(jst(2026, 11, 22)), "2026-W47"); // 日曜 (週の終わり)
  assert.equal(weekKeyOf(jst(2026, 11, 23)), "2026-W48"); // 翌月曜
});

test("weekKeyOf: 年境界の ISO 週年", () => {
  assert.equal(weekKeyOf(jst(2026, 1, 1)), "2026-W01");
  assert.equal(weekKeyOf(jst(2025, 12, 29)), "2026-W01"); // ISO 年では 2026 年の第 1 週
  assert.equal(weekKeyOf(jst(2027, 1, 1)), "2026-W53"); // ISO 年では 2026 年の第 53 週
  assert.equal(weekKeyOf(jst(2026, 12, 31)), "2026-W53");
});

test("weekKeyOf: JST の日付境界で週が切り替わる", () => {
  // 2026-11-15 (日) 23:59 JST は W46、16 日 00:00 JST から W47
  assert.equal(weekKeyOf(new Date("2026-11-15T14:59:00Z")), "2026-W46");
  assert.equal(weekKeyOf(new Date("2026-11-15T15:00:00Z")), "2026-W47");
});

test("jstParts: 曜日と時刻", () => {
  const p = jstParts(jst(2026, 11, 23, 9, 0)); // 月曜 9:00
  assert.equal(p.isoWeekday, 0);
  assert.equal(p.hour, 9);
  const sun = jstParts(jst(2026, 11, 22, 23, 59)); // 日曜
  assert.equal(sun.isoWeekday, 6);
});

test("isWeekKey: 形式チェック", () => {
  assert.equal(isWeekKey("2026-W47"), true);
  assert.equal(isWeekKey("2026-W01"), true);
  assert.equal(isWeekKey("2026-W54"), false);
  assert.equal(isWeekKey("2026-47"), false);
  assert.equal(isWeekKey("2026-W47~1"), false); // 退避キーは週キーではない
});

test("summaryDueWeek: 月曜 9:00 ちょうどで先週分が対象になる", () => {
  const mon9 = jst(2026, 11, 23, 9, 0);
  assert.equal(summaryDueWeek(mon9, null), "2026-W47");
  assert.equal(summaryDueWeek(mon9, "2026-W46"), "2026-W47");
  assert.equal(summaryDueWeek(mon9, "2026-W47"), null); // 送信済み
});

test("summaryDueWeek: 月曜 9:00 より前は前々週が対象 (前回のサマリ時刻基準)", () => {
  const mon859 = jst(2026, 11, 23, 8, 59);
  assert.equal(summaryDueWeek(mon859, null), "2026-W46");
  assert.equal(summaryDueWeek(mon859, "2026-W46"), null);
});

test("summaryDueWeek: 週の途中でも未送信ならキャッチアップする", () => {
  const tue = jst(2026, 11, 24, 10, 0); // 火曜
  assert.equal(summaryDueWeek(tue, null), "2026-W47");
  assert.equal(summaryDueWeek(tue, "2026-W47"), null);
  const sun = jst(2026, 11, 22, 23, 0); // 日曜 (まだ週の途中)
  assert.equal(summaryDueWeek(sun, null), "2026-W46");
});
