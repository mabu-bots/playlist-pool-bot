// ==========================================
// 📌 スラッシュコマンドの定義とハンドラ
// ==========================================
// 📌 /add・/list・/remove・/export・/pool の 5 コマンド (うち /pool は
// サブコマンド 2 つ) を定義し、対話への応答を担当する。
// プールの状態操作は store.ts / pool.ts に委ね、ここは Discord との
// やり取りと文面の組み立てに専念する。
import {
  AttachmentBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  WEEKLY_LIMIT_PER_USER,
  buildExportMarkdown,
  buildListDescriptions,
  partitionEntries,
} from "./pool.js";
import { archiveDir, archiveEnabled, saveProductArchive } from "./product-archive.js";
import { SpotifyAddError, addTracksToPlaylist, type SpotifyConfig } from "./spotify.js";
import type { Store } from "./store.js";
import { parseTrackInput } from "./track.js";
import { weekKeyOf } from "./week.js";

// ユーザー入力テキストがメンションとして発火しないよう、全応答で ping を無効化する
const NO_MENTIONS = { parse: [] as never[] };

// ------------------------------------------
// 🧩 定義
// ------------------------------------------
export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("今週のプールに曲を追加します (Spotify URL / URI / 曲名など)")
    .addStringOption((o) =>
      o.setName("song").setDescription("Spotify トラック URL・URI、または曲名・アーティスト名").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("今週のプール一覧を表示します"),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("プールから曲を取り消します (自分の曲のみ、管理者は他人の曲も可)")
    .addIntegerOption((o) =>
      o.setName("number").setDescription("/list の番号").setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName("export")
    .setDescription("今週のプールを Spotify プレイリストへ書き出します (未連携時はリストを投稿)"),
  new SlashCommandBuilder()
    .setName("pool")
    .setDescription("プールの管理 (サーバー管理権限が必要)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("new").setDescription("今週のプールを退避して、新しい週を開始します"),
    )
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("このチャンネルを週次サマリ (月曜 9:00) の投稿先に登録します"),
    ),
];

export const commandData = commandBuilders.map((b) => b.toJSON());

// ------------------------------------------
// 🎛️ ハンドラ
// ------------------------------------------
export interface CommandDeps {
  store: Store;
  spotify: SpotifyConfig | null;
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  deps: CommandDeps,
): Promise<void> {
  switch (interaction.commandName) {
    case "add":
      return handleAdd(interaction, deps.store);
    case "list":
      return handleList(interaction, deps.store);
    case "remove":
      return handleRemove(interaction, deps.store);
    case "export":
      return handleExport(interaction, deps);
    case "pool":
      return handlePool(interaction, deps.store);
  }
}

function requireGuild(interaction: ChatInputCommandInteraction): string | null {
  return interaction.guildId;
}

// ----- ➕ /add -----
async function handleAdd(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  const raw = interaction.options.getString("song", true);
  const parsed = parseTrackInput(raw);
  if (!parsed) {
    await interaction.reply({ content: "曲の指定が空です。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  // 表示名 (サーバーニックネーム優先) を使う
  const member = interaction.member;
  const displayName =
    member && "displayName" in member ? member.displayName : interaction.user.username;
  const result = store.addEntry(
    guildId,
    parsed,
    { id: interaction.user.id, name: displayName },
    new Date(),
  );
  if (!result.ok) {
    const msg =
      result.reason === "duplicate"
        ? "その曲は今週のプールにすでに入っています。"
        : `1 人あたり週 ${WEEKLY_LIMIT_PER_USER} 曲までです。今週の上限に達しています。`;
    await interaction.reply({ content: msg, ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  await interaction.reply({
    content: `🎵 プールに追加しました (${result.position} 曲目): ${result.entry.text}`,
    allowedMentions: NO_MENTIONS,
  });
}

// ----- 📋 /list -----
async function handleList(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  const now = new Date();
  const weekKey = weekKeyOf(now);
  const entries = store.currentPool(guildId, now);
  if (entries.length === 0) {
    await interaction.reply({
      content: `今週 (${weekKey}) のプールはまだ空です。\`/add\` で曲を追加してください。`,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  // 件数だけでなく文字数でも分割する (Embed description 上限対策)。
  // 2 塊目以降は followUp で送る。
  const descriptions = buildListDescriptions(entries);
  const makeEmbed = (description: string, index: number) =>
    new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle(
        index === 0
          ? `🎧 今週のプール (${weekKey} / ${entries.length} 曲)`
          : `🎧 今週のプール (${weekKey} / 続き ${index + 1})`,
      )
      .setDescription(description)
      .setTimestamp(new Date());
  await interaction.reply({ embeds: [makeEmbed(descriptions[0], 0)], allowedMentions: NO_MENTIONS });
  for (let i = 1; i < descriptions.length; i++) {
    await interaction.followUp({ embeds: [makeEmbed(descriptions[i], i)], allowedMentions: NO_MENTIONS });
  }
}

// ----- 🗑️ /remove -----
async function handleRemove(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  const number = interaction.options.getInteger("number", true);
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  const result = store.removeEntry(guildId, number, interaction.user.id, isAdmin, new Date());
  if (!result.ok) {
    const msg =
      result.reason === "not_found"
        ? `番号 ${number} の曲はプールにありません。`
        : "他人の曲は取り消せません (管理者は可能です)。";
    await interaction.reply({ content: msg, ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  await interaction.reply({
    content: `🗑️ プールから取り消しました: ${result.removed.text}`,
    allowedMentions: NO_MENTIONS,
  });
}

// ----- 📤 /export -----
// フォールバック書き出し: 平文だと 2,000 字上限を超えて届かないため、
// Markdown をファイル添付で送り、本文には短い案内だけを載せる。
async function editReplyWithExportFile(
  interaction: ChatInputCommandInteraction,
  content: string,
  entries: Parameters<typeof buildExportMarkdown>[0],
  weekKey: string,
): Promise<void> {
  const markdown = Buffer.from(buildExportMarkdown(entries, weekKey), "utf-8");
  const file = new AttachmentBuilder(markdown, {
    name: `playlist-pool-${weekKey}.md`,
  });
  await interaction.editReply({ content, files: [file], allowedMentions: NO_MENTIONS });
  // 確認用に、生成した書き出しファイルをサーバーへ保存する (product-archive.ts)。
  // 保存に失敗しても書き出し自体は成功扱いのままにする。
  if (archiveEnabled()) {
    try {
      await saveProductArchive(
        archiveDir(),
        {
          kind: "playlist-export",
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          requesterId: interaction.user.id,
          weekKey,
          entryCount: entries.length,
        },
        markdown,
      );
    } catch (e) {
      console.error("生成ファイルのアーカイブ保存に失敗しました:", e);
    }
  }
}

async function handleExport(
  interaction: ChatInputCommandInteraction,
  deps: CommandDeps,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  await interaction.deferReply();
  const now = new Date();
  const weekKey = weekKeyOf(now);
  const entries = deps.store.currentPool(guildId, now);
  if (entries.length === 0) {
    await interaction.editReply({
      content: `今週 (${weekKey}) のプールは空です。書き出す曲がありません。`,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  const { withTrackId, textOnly } = partitionEntries(entries);
  // 書き出し済みの曲は再送しない (/export の冪等性)
  const alreadyExported = deps.store.exportedTrackIds(guildId, weekKey);
  const pending = withTrackId.filter((e) => !alreadyExported.has(e.trackId!));

  // フォールバック: Spotify 未連携、または連携済みでも追加できる曲がない場合
  if (!deps.spotify || withTrackId.length === 0) {
    const reason = !deps.spotify
      ? "Spotify 連携が未設定のため、リスト形式で書き出します。"
      : "Spotify へ直接追加できる曲 (URL / URI で追加された曲) がないため、リスト形式で書き出します。";
    await editReplyWithExportFile(interaction, reason, entries, weekKey);
    return;
  }

  // 連携済みだが今週分はすべて書き出し済み
  if (pending.length === 0) {
    const lines = [
      `✅ 今週 (${weekKey}) の Spotify 対象曲 ${withTrackId.length} 曲はすべて書き出し済みです。再追加はしませんでした。`,
    ];
    if (textOnly.length > 0) {
      await editReplyWithExportFile(
        interaction,
        `${lines[0]}\n⚠️ テキストで追加された ${textOnly.length} 曲は添付ファイルから検索して追加してください。`,
        entries,
        weekKey,
      );
      return;
    }
    await interaction.editReply({ content: lines[0], allowedMentions: NO_MENTIONS });
    return;
  }

  try {
    const result = await addTracksToPlaylist(
      deps.spotify,
      pending.map((e) => e.trackId!),
    );
    deps.store.markTracksExported(
      guildId,
      weekKey,
      pending.map((e) => e.trackId!),
    );
    const lines = [
      `✅ Spotify プレイリストへ **${result.added} 曲** を追加しました: ${result.playlistUrl}`,
    ];
    if (alreadyExported.size > 0) {
      lines.push(`(書き出し済みの ${alreadyExported.size} 曲は再追加していません)`);
    }
    if (textOnly.length > 0) {
      lines.push(
        `⚠️ テキストで追加された ${textOnly.length} 曲は Spotify へ直接追加できないため、添付ファイルから検索して追加してください。`,
      );
      await editReplyWithExportFile(interaction, lines.join("\n"), entries, weekKey);
      return;
    }
    await interaction.editReply({ content: lines.join("\n"), allowedMentions: NO_MENTIONS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // バッチ途中まで追加済みなら、その分を書き出し済みとして記録し、
    // 件数を結果に含める (再試行で重複追加しないため)
    const addedSoFar = err instanceof SpotifyAddError ? err.added : 0;
    if (addedSoFar > 0) {
      try {
        deps.store.markTracksExported(
          guildId,
          weekKey,
          pending.slice(0, addedSoFar).map((e) => e.trackId!),
        );
      } catch {
        // 記録に失敗しても、追加済み件数の案内自体は返す
      }
    }
    const addedNote =
      addedSoFar > 0
        ? `${addedSoFar} 曲は追加済みです (再実行時は残りの曲だけを追加します)。`
        : "追加済みの曲はありません。";
    await editReplyWithExportFile(
      interaction,
      `⚠️ Spotify への書き出しに失敗しました (${detail})。${addedNote}リスト形式で書き出します。`,
      entries,
      weekKey,
    );
  }
}

// ----- 🛠️ /pool -----
async function handlePool(
  interaction: ChatInputCommandInteraction,
  store: Store,
): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true, allowedMentions: NO_MENTIONS });
    return;
  }
  // 宣言 (setDefaultMemberPermissions) だけでなく実行時にも確認する
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!isAdmin) {
    await interaction.reply({
      content: "このコマンドにはサーバー管理権限 (ManageGuild) が必要です。",
      ephemeral: true,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  const sub = interaction.options.getSubcommand();
  if (sub === "new") {
    const weekKey = weekKeyOf(new Date());
    const archived = store.resetCurrentPool(guildId, new Date());
    await interaction.reply({
      content: archived
        ? `🔄 今週 (${weekKey}) のプールを退避し (保存先: ${archived})、新しいプールを開始しました。`
        : `今週 (${weekKey}) のプールはすでに空です。`,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
  if (sub === "channel") {
    store.setSummaryChannel(guildId, interaction.channelId);
    await interaction.reply({
      content: "このチャンネルを週次サマリ (月曜 9:00) の投稿先に登録しました。",
      ephemeral: true,
      allowedMentions: NO_MENTIONS,
    });
    return;
  }
}
