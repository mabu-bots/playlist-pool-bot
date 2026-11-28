// ==========================================
// 📋 週次サマリのスケジューラ
// ==========================================
// 📋 月曜 9:00 (Asia/Tokyo) に、先週のプール件数と書き出し案内を
// 登録チャンネルへ投稿する。時刻判定は week.ts の純粋関数で行い、
// ここでは「どの guild へ何を送るか」の計画 (planSummaries) と
// 1 分間隔のループを担当する。
import type { Store } from "./store.js";
import { summaryDueWeek } from "./week.js";

export interface SummaryPlan {
  guildId: string;
  channelId: string;
  // サマリ対象の週キー (終わったばかりの週)
  weekKey: string;
  // その週のプール件数
  count: number;
}

// ------------------------------------------
// 🗺️ 送信計画
// ------------------------------------------
// 送信済みフラグは「送信に成功した後」に立てる。
// 計画時点でフラグを立てると、送信に失敗した週のサマリが二度と
// 送られなくなるため、計画だけではフラグを立てず、WeeklyScheduler が
// 送信成功後に markSummarySent する。未送信の間は planSummaries が
// 同じ計画を返し続け、次回 tick で再試行される。
// プールが 0 件の週は送るものがないので、計画時点でフラグだけ立てて
// 投稿しない。
export function planSummaries(store: Store, now: Date = new Date()): SummaryPlan[] {
  const state = store.data;
  const plans: SummaryPlan[] = [];
  for (const [guildId, channelId] of Object.entries(state.summaryChannels)) {
    const due = summaryDueWeek(now, state.lastSummaryWeek[guildId] ?? null);
    if (due === null) continue;
    const count = store.poolFor(guildId, due).length;
    if (count === 0) {
      store.markSummarySent(guildId, due);
      continue;
    }
    plans.push({ guildId, channelId, weekKey: due, count });
  }
  return plans;
}

// サマリ投稿の文面
export function buildSummaryMessage(plan: SummaryPlan): string {
  return [
    `📋 **週次プレイリストプール サマリ (${plan.weekKey})**`,
    `先週のプールは **${plan.count} 曲** でした。おつかれさまでした！`,
    "今週のプールが新しく始まっています。`/add` で曲を追加、`/export` で今週分をいつでも書き出せます。",
  ].join("\n");
}

// ------------------------------------------
// ⏰ 1 分間隔ループ
// ------------------------------------------
export interface SchedulerDeps {
  store: Store;
  send: (plan: SummaryPlan) => Promise<void>;
  log: (msg: string) => void;
}

export class WeeklyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  // tick の再入ガード: 前回の tick (送信) が長引いても次 tick と重ねず、
  // 同じサマリの二重投稿を防ぐ
  private tickRunning = false;

  constructor(private deps: SchedulerDeps) {}

  start(): void {
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60 * 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.tickRunning) return;
    this.tickRunning = true;
    try {
      const plans = planSummaries(this.deps.store);
      for (const plan of plans) {
        try {
          await this.deps.send(plan);
          // 送信に成功してから送信済みフラグを立てる (失敗時は次回 tick で再試行)
          this.deps.store.markSummarySent(plan.guildId, plan.weekKey);
        } catch (err) {
          this.deps.log(
            `週次サマリの送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.deps.log(
        `週次サマリの判定に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }
}
