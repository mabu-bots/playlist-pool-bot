// ==========================================
// 🧪 テスト: コマンド実行ログの整形
// ==========================================
import assert from "node:assert/strict";
import test from "node:test";
import { formatExecutionLog, summarizeError } from "../src/execution-log.js";

const NOW = new Date("2026-11-28T03:00:00.000Z");

test("成功時はメタ情報のみの1行になる (入力テキストは含まない)", () => {
  const line = formatExecutionLog(
    { cmd: "add", route: "slash", guildId: "g1", channelId: "c1", userId: "u1", ok: true },
    NOW,
  );
  assert.equal(
    line,
    "[exec] 2026-11-28T03:00:00.000Z cmd=add route=slash guild=g1 channel=c1 user=u1 result=ok",
  );
});

test("DM (guild なし) の表記", () => {
  const line = formatExecutionLog(
    { cmd: "list", route: "slash", guildId: null, channelId: null, userId: "u1", ok: true },
    NOW,
  );
  assert.ok(line.includes("guild=-"));
  assert.ok(line.includes("channel=-"));
});

test("失敗時はエラーの要点が付く", () => {
  const line = formatExecutionLog(
    {
      cmd: "export",
      route: "slash",
      guildId: "g1",
      channelId: "c1",
      userId: "u1",
      ok: false,
      error: new Error("boom"),
    },
    NOW,
  );
  assert.ok(line.includes("result=error"));
  assert.ok(line.includes('error="Error: boom"'));
});

test("summarizeError: 改行と引用符を潰して1行化する", () => {
  const s = summarizeError(new Error('a\nb "quoted"'));
  assert.equal(s, "Error: a b 'quoted'");
  assert.equal(summarizeError("plain"), "plain");
});

test("summarizeError: 長すぎるエラーは切り詰める", () => {
  const s = summarizeError(new Error("x".repeat(200)));
  assert.ok(s.length <= 101);
  assert.ok(s.endsWith("…"));
});
