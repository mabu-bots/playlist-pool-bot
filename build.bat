@echo off
rem playlist-pool-bot 一括ビルド: 依存解決 → 型チェック付きビルド → テスト
setlocal
cd /d %~dp0
call npm install
if errorlevel 1 exit /b %errorlevel%
call npm test
if errorlevel 1 exit /b %errorlevel%
echo ビルドとテストが完了しました。起動: npm start (.env が必要です)
endlocal
