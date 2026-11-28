// ==========================================
// ⚙️ pm2 常駐設定 (playlist-pool-bot)
// ==========================================
// 起動: pm2 start ecosystem.config.cjs
// サーバー再起動後も自動で立ち上がるようにするには、pm2 startup が
// 表示するコマンドを実行してから pm2 save する。
//
// .env は Node の --env-file で読み込む (npm start と同じ方式)。
// 秘密情報は .env (git 管理外) にだけ置き、このファイルには書かない。
// READY ウォッチドッグ (src/watchdog.ts) が停滞を検知してプロセスを
// 終了させた場合も、pm2 の autorestart で再起動する前提の構成にする。

module.exports = {
  apps: [
    {
      name: "playlist-pool-bot",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      kill_timeout: 5000,
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
