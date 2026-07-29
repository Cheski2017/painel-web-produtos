@echo off
setlocal enabledelayedexpansion
set "PORTA=3000"
if exist "%~dp0..\app\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%~dp0..\app\.env") do (
    if /i "%%A"=="PORT" if not "%%B"=="" set "PORTA=%%B"
  )
)
start "" "http://localhost:!PORTA!"
