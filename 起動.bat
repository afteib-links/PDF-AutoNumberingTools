@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ブラウザで http://127.0.0.1:8765/ を開きます。この窓は閉じないでください。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1"
if errorlevel 1 (
    echo 起動に失敗しました。PowerShell が使えるか確認してください。
    pause
)
