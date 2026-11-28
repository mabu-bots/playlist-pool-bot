// ==========================================
// 🐕 READY ウォッチドッグ (Gateway 安全構造)
// ==========================================
// 🐕 ログイン後に READY が来ない「サイレント停滞」を検知し、プロセスを
// 終了させて pm2 に再起動させる。接続自体は生きていてハートビート
// ACK も返る状態では discord.js の自動再接続が働かない場合がある
// ための保険。
// なお discord.js は Client を destroy すると同じインスタンスでは
// 再ログインできない (WebSocketManager が再接続不可になる) ため、
// 回復はプロセス再起動に委ねる。
import type { Client } from "discord.js";

// READY でない状態がこの時間続いたら停滞とみなす
export const NOT_READY_LIMIT_MS = 120_000;
// ウォッチドッグの確認間隔
export const WATCHDOG_INTERVAL_MS = 30_000;

// ------------------------------------------
// 🔍 READY 受信状況の追跡 (判定ロジック)
// ------------------------------------------
export class ReadyWatchdog {
  private notReadySince: number | null;

  constructor(now: number) {
    this.notReadySince = now;
  }

  // 現在の READY 状態を観測させる。READY でなくなった瞬間から数える
  observe(isReady: boolean, now: number): void {
    if (isReady) {
      this.notReadySince = null;
    } else if (this.notReadySince === null) {
      this.notReadySince = now;
    }
  }

  // 発動 (プロセス終了) の起点をリセットする
  onFire(now: number): void {
    this.notReadySince = now;
  }

  isExpired(now: number, limitMs: number): boolean {
    return this.notReadySince !== null && now - this.notReadySince >= limitMs;
  }
}

// ------------------------------------------
// 🔌 client への取り付け
// ------------------------------------------
// 停滞を検知したらログを残してプロセスを終了する (pm2 が再起動する)。
// 戻り値は停止関数 (終了処理・テスト用)。
export function attachReadyWatchdog(
  client: Client,
  options: {
    limitMs?: number;
    intervalMs?: number;
    log?: (message: string) => void;
    exit?: (code: number) => void;
  } = {},
): () => void {
  const limitMs = options.limitMs ?? NOT_READY_LIMIT_MS;
  const intervalMs = options.intervalMs ?? WATCHDOG_INTERVAL_MS;
  const log = options.log ?? ((message: string) => console.error(message));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const watchdog = new ReadyWatchdog(Date.now());
  const timer = setInterval(() => {
    const now = Date.now();
    watchdog.observe(client.isReady(), now);
    if (!watchdog.isExpired(now, limitMs)) return;
    log(
      `[watchdog] READY が ${Math.round(limitMs / 1000)} 秒以上来ないためプロセスを終了します (pm2 が再起動します)`,
    );
    watchdog.onFire(now);
    exit(1);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
