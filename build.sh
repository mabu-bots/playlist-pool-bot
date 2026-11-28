#!/usr/bin/env bash
# playlist-pool-bot 一括ビルド: 依存解決 → 型チェック付きビルド → テスト
set -euo pipefail
cd "$(dirname "$0")"
npm install
npm test
echo "ビルドとテストが完了しました。起動: npm start (.env が必要です)"
