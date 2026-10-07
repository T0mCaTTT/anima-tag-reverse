@echo off
chcp 65001 >nul
title Anima 标签知识库 · 本地服务
cd /d "%~dp0"
echo.
echo   Anima 标签知识库 —— 启动本地服务
echo   （请勿直接双击 anima-tag-exhibition.html：那样浏览器会拦住数据加载）
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode
node "scripts\serve-kb.mjs" %*
set RC=%ERRORLEVEL%
echo.
if "%RC%"=="3" goto end
if "%RC%"=="0" goto stopped
echo   [!] Start failed. exit code = %RC%  (see the message above)
echo       Port busy by another program?  node "scripts\serve-kb.mjs" 8200
goto end
:nonode
echo   [!] Node.js not found. Install Node 18+ from https://nodejs.org then retry.
goto end
:stopped
echo   Server stopped.
echo.
:end
pause >nul