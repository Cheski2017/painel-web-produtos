@echo off
title Instalar Painel de Ofertas
REM Confere se ja esta rodando como administrador; se nao, pede elevacao
REM (UAC) sozinho e reabre este mesmo arquivo ja elevado.
net session >nul 2>&1
if %errorLevel% == 0 goto :admin

echo Pedindo permissao de administrador (uma janela do Windows vai aparecer)...
powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
exit /b

:admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\instalar-servico.ps1"
echo.
pause
