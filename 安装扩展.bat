@echo off
chcp 65001 >nul
title DeepSeek 对话大纲 - 安装扩展
echo.
echo  ============================================================
echo   DeepSeek 对话大纲 - 安装说明
echo  ============================================================
echo.
echo   1. 稍后会打开 chrome://extensions
echo   2. 右上角打开「开发者模式」
echo   3. 点「加载已解压的扩展程序」
echo   4. 选择弹出的文件夹：ext
echo.
echo   安装后打开任意 DeepSeek 对话页，右下角会出现圆形按钮。
echo   改了 ext 里的文件后，回 chrome://extensions 点该扩展的刷新图标即可。
echo.
set "EXT_DIR=%~dp0ext"
echo   把扩展目录复制到剪贴板（方便在选择框里粘贴）：
echo   %EXT_DIR%
echo.
start "" chrome.exe "chrome://extensions"
start "" explorer.exe "%EXT_DIR%"
echo   （已在资源管理器里打开 ext 目录，地址栏里的路径可直接复制）
echo.
pause
