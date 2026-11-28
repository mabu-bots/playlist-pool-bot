// ==========================================
// 📝 コマンド事前登録 (任意)
// ==========================================
// 📝 通常は起動時に自動登録されるため不要。登録だけを先に行いたい
// 場合に使う (npm run deploy)。
import { REST, Routes } from "discord.js";
import { commandData } from "./commands.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
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
