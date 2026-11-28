// ==========================================
// 🎮 プレゼンス・サイクル (全 Bot 共通)
// ==========================================
// 🎮 Playing で 1 分ごとに次の 2 パターンを交互に表示する。
//   経過時間: <Bot名> | 起動して 1時間26分 (起点はログイン完了時)
//   現在時刻: <Bot名> | 現在時刻 19:24 JST
// 値は「次の分の境界時点」のものを計算し、境界の 200ms 前に先行送信する
// (Discord のプレゼンス伝播遅延の実測中央値 190ms と相殺し、切り替えが
// 境界にほぼ一致するようにする。実測: 着地は境界の ±20ms 以内)。
// 位相は Unix 分の偶奇で決まるため、全 Bot が同時に切り替わる。
// 従来の Watching「/help | {ping}ms」(5 分更新) はこのサイクルに置き換えた。
import { ActivityType, type Client } from "discord.js";

export const PRESENCE_SEND_LEAD_MS = 200;

let startedAtMs: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

// ⏱️ 経過時間を分粒度で整形する (1時間26分 / 26分 / 0分)
export function formatElapsedMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? `${hours}時間${String(minutes).padStart(2, "0")}分`
    : `${minutes}分`;
}

// 🎮 時刻 at におけるプレゼンス文字列を返す
export function presenceCycleText(
  botName: string,
  startedAt: number,
  at: Date,
): string {
  const phase = Math.floor(at.getTime() / 60_000) % 2;
  if (phase === 1) {
    const jst = new Date(at.getTime() + 9 * 3_600_000);
    const hh = String(jst.getUTCHours()).padStart(2, "0");
    const mm = String(jst.getUTCMinutes()).padStart(2, "0");
    return `${botName} | 現在時刻 ${hh}:${mm} JST`;
  }
  return `${botName} | 起動して ${formatElapsedMinutes(at.getTime() - startedAt)}`;
}

// ⏰ 次の分の境界と、その値で先行送信すべき時刻を返す。送信予定時刻を
// 過ぎている場合は翌分の境界へ前進する (過ぎた予定で即時発火を繰り返すと
// 送信を連打して Gateway レート制限にかかるため、この前進処理が必須)。
export function nextPresenceSend(nowMs: number): {
  sendAt: number;
  boundary: number;
} {
  let boundary = Math.floor(nowMs / 60_000) * 60_000 + 60_000;
  let sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  if (sendAt <= nowMs) {
    boundary += 60_000;
    sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  }
  return { sendAt, boundary };
}

// 👀 現在のプレゼンス文字列 (参照用)
export function currentPresenceText(client: Client): string {
  const name = client.user?.username ?? "";
  return presenceCycleText(name, startedAtMs ?? Date.now(), new Date());
}

function applyPresence(client: Client, at: Date): void {
  if (!client.user || startedAtMs === null) return;
  const text = presenceCycleText(client.user.username, startedAtMs, at);
  try {
    client.user.setActivity(text, { type: ActivityType.Playing });
    console.log(`[presence-cycle] ${text}`);
  } catch (error) {
    console.error("[presence-cycle] presence update failed:", error);
  }
}

// 🚀 サイクルを開始する。呼び出しのたびに現在の値を即時適用し、
// 境界タイマーは多重起動しても 1 本だけ動く。経過時間の起点は最初の
// 呼び出し時刻に固定される (再接続や再適用ではリセットしない)。
export function startPresenceCycle(client: Client): void {
  if (startedAtMs === null) startedAtMs = Date.now();
  applyPresence(client, new Date());
  if (timer !== null) return;
  const tick = (): void => {
    const { sendAt, boundary } = nextPresenceSend(Date.now());
    timer = setTimeout(() => {
      // 値は送信時刻ではなく境界時点のものを使う (先行送信)
      applyPresence(client, new Date(boundary));
      tick();
    }, Math.max(0, sendAt - Date.now()));
    timer.unref?.();
  };
  tick();
}
