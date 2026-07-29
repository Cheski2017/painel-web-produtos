@echo off
title Desinstalar Painel de Ofertas
net session >nul 2>&1
if %errorLevel% == 0 goto :admin

echo Pedindo permissao de administrador (uma janela do Windows vai aparecer)...
powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
exit /b

:admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\desinstalar-servico.ps1"
echo.
echo Feito. Os paineis salvos e a configuracao continuam em "app\data" e
echo "app\.env" - apague a pasta inteira manualmente se quiser remover tudo.
echo.
pause
