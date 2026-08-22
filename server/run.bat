@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "QE_PORT=%~1"
if "%QE_PORT%"=="" set "QE_PORT=8770"

rem 优先复用本机已有依赖，避免每次启动都创建环境。
python -c "import fastapi,uvicorn,httpx,bs4" >nul 2>&1
if not errorlevel 1 goto :global

if not exist .venv\Scripts\python.exe (
  echo [1/2] 创建后端运行环境并安装依赖...
  python -m venv .venv || goto :err
)
.venv\Scripts\python.exe -c "import fastapi,uvicorn,httpx,bs4" >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python.exe -m pip install -q --upgrade pip || goto :err
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt || goto :err
)
echo [2/2] 启动后端 http://127.0.0.1:%QE_PORT%
.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port %QE_PORT%
exit /b %errorlevel%

:global
echo [1/1] 使用本机 Python 启动后端 http://127.0.0.1:%QE_PORT%
python -m uvicorn main:app --host 127.0.0.1 --port %QE_PORT%
exit /b %errorlevel%

:err
echo 后端启动失败，请确认已安装 Python 3.10+。> startup-error.log
exit /b 1
