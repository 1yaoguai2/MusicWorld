@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   MusicWorld 本地音乐播放器
echo ============================================
echo.

set "PY="
python --version >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
    echo [!] 没有找到 Python，无法启动本地服务器。
    echo.
    echo     解决方法一：安装 Python ^(https://www.python.org/downloads/^)
    echo     解决方法二：直接双击 index.html，在页面里点「导入音乐文件夹」
    echo                  ^(需要 Chrome 或 Edge 浏览器^)
    echo.
    pause
    exit /b 1
)

echo [1/2] 扫描 music / lyrics 文件夹...
%PY% tools\scan.py
echo.
echo [2/2] 启动本地服务器...
%PY% tools\server.py

pause
