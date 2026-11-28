// ==========================================
// 📝 コマンド実行ログ
// ==========================================
// 📝 コマンドが実行されるたびに標準出力へ 1 行のメタ情報を残す
// (pm2 の out ログに残る)。起動ログには時刻が付かないため、ISO 形式の
// タイムスタンプを自前で付ける。
// ユーザーの入力テキスト (オプション値・本文) は記録せず、コマンド名・
// ID・成否だけを残す。書式は全 Bot 共通:
//   [exec] <ISO時刻> cmd=<名前> route=<slash|context|prefix> guild=<ID>
//          channel=<ID> user=<ID> result=<ok|error>
// 失敗時は末尾に error="<要点>" が付く。
// なお週次サマリ投稿 (スケジューラー) はコマンド実行ではないため対象外。

export type CommandRoute = "slash" | "context" | "prefix";

export interface ExecutionLogEntry {
  cmd: string;
  route: CommandRoute;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  ok: boolean;
  error?: unknown;
}

// エラーを 1 行の要点に整形する (空白を潰し、引用符を置換し、長すぎれば切り詰める)
export function summarizeError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const oneLine = raw.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return oneLine.length > 100 ? oneLine.slice(0, 100) + "…" : oneLine;
}

export function formatExecutionLog(entry: ExecutionLogEntry, now: Date = new Date()): string {
  const parts = [
    "[exec]",
    now.toISOString(),
    `cmd=${entry.cmd}`,
    `route=${entry.route}`,
    `guild=${entry.guildId ?? "-"}`,
    `channel=${entry.channelId ?? "-"}`,
    `user=${entry.userId}`,
    `result=${entry.ok ? "ok" : "error"}`,
  ];
  if (!entry.ok) parts.push(`error="${summarizeError(entry.error)}"`);
  return parts.join(" ");
}

export function logExecution(entry: ExecutionLogEntry): void {
  console.log(formatExecutionLog(entry));
}
