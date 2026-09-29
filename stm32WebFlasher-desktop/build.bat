@echo off
setlocal
cd /d "%~dp0"

deno task compile
if errorlevel 1 (
  echo.
  echo Failed to build stm32WebFlasher Desktop.
  exit /b 1
)

echo.
echo Build finished.
