# Contributing

このプロジェクトは、運用者の全リポジトリで共通の開発手順
(aegis-app/aegis-bot で確立した方式) に従います。

## 開発手順

1. **まず Issue を作る。** すべての変更は Issue から始める
   (Issue テンプレート使用)。目的・作業内容・完了条件を書く。
2. **`main` からブランチを切る。** 名前は `<type>/<issue番号>-<slug>`、
   例: `feat/12-export-history`、`fix/9-summary-resend`、`docs/3-readme`。
3. **実装とテスト。** ローカルでビルドとテストを実行し、両方通す。
   - ビルド: `npm run build` (または `./build.sh` / `build.bat`)
   - テスト: `npm test`
4. **Pull Request を作る。** PR テンプレートを埋め、本文に
   `Closes #<番号>` と書いて Issue と紐付ける。
5. **CI が通ったら "Rebase and merge" で `main` に取り込み**、
   ブランチを削除する。

## コミットメッセージ

Conventional Commits + 英語の件名で書く。

```
feat: add export history command
fix: mark summary as sent only after a successful post
docs: update documentation for v1.0.0
```

使う type: `feat` / `fix` / `docs` / `test` / `chore` / `refactor`。

## リリース

`main` から切る。バージョンを上げてタグ `vX.Y.Z` を打ち、GitHub
Release はノートのみ (バイナリは添付しない)。

## 注意

- 秘密情報をコミットしない。設定は `.env` に置く (`.env.example`
  参照)。`.env` は git 管理外。
- 状態ファイル `data/` も git 管理外 (プールや設定は運用データ)。
