// ==========================================
// 🚀 エントリポイント
// ==========================================
// 🚀 Discord へログインし、コマンド登録・対話処理・週次サマリを
// 開始する。特権インテントは使わない (Guilds のみ)。
import { Client, Events, GatewayIntentBits, REST, Routes, type TextChannel } from "discord.js";
import { commandData, handleCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { logExecution } from "./execution-log.js";
import { WeeklyScheduler, buildSummaryMessage, type SummaryPlan } from "./scheduler.js";
import { Store } from "./store.js";
import { attachReadyWatchdog } from "./watchdog.js";
import { startPresenceCycle } from "./presence-cycle.js";

const config = loadConfig();
const store = new Store(config.statePath);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Gateway 安全構造: READY が来ないサイレント停滞を検知して終了する (watchdog.ts)
attachReadyWatchdog(client);

// ------------------------------------------
// 📝 コマンド登録 (起動時に自動)
// ------------------------------------------
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commandData,
    });
    console.log(`コマンドをギルド ${config.guildId} に登録しました`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });
    console.log("コマンドをグローバルに登録しました");
  }
}

// ------------------------------------------
// 📋 週次サマリの送信
// ------------------------------------------
async function sendSummary(plan: SummaryPlan): Promise<void> {
  const channel = await client.channels.fetch(plan.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    // 送信失敗として例外にし、スケジューラが次回 tick で再試行できるようにする
    // (送信済みフラグは送信成功後にだけ立つ)
    throw new Error(`サマリ送信先チャンネル ${plan.channelId} が見つかりません`);
  }
  await (channel as TextChannel).send({
    content: buildSummaryMessage(plan),
    allowedMentions: { parse: [] },
  });
  console.log(`週次サマリを送信しました: ${plan.weekKey} (${plan.count} 曲) -> #${plan.channelId}`);
}

// ------------------------------------------
// ▶️ 起動
// ------------------------------------------
client.once(Events.ClientReady, (c) => {
  // プレゼンスは全 Bot 共通のサイクル表示 (presence-cycle.ts)
  startPresenceCycle(c);
  console.log(
    `ログインしました: ${c.user.tag} / Spotify 連携: ${config.spotify ? "あり" : "なし (フォールバック動作)"}`,
  );
  const scheduler = new WeeklyScheduler({
    store,
    send: sendSummary,
    log: (msg) => console.warn(msg),
  });
  scheduler.start();
  console.log("週次サマリのスケジューラを開始しました (月曜 9:00 JST)");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const meta = {
    cmd: interaction.commandName,
    route: "slash" as const,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  };
  try {
    await handleCommand(interaction, { store, spotify: config.spotify });
    logExecution({ ...meta, ok: true });
  } catch (err) {
    logExecution({ ...meta, ok: false, error: err });
    console.error("コマンド処理でエラーが発生しました:", err);
    const msg = "処理中にエラーが発生しました。時間をおいて再度お試しください。";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg, allowedMentions: { parse: [] } }).catch(() => undefined);
    } else {
      await interaction
        .reply({ content: msg, ephemeral: true, allowedMentions: { parse: [] } })
        .catch(() => undefined);
    }
  }
});

await registerCommands();
await client.login(config.token);
