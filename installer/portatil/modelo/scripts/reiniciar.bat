@echo off
REM Controlar a tarefa agendada exige ser Administrador - pede elevacao (UAC)
REM automaticamente se quem clicou nao for admin.
powershell -NoProfile -Command "Start-Process schtasks -ArgumentList '/End','/TN','PainelOfertasServidor' -Verb RunAs -Wait"
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "Start-Process schtasks -ArgumentList '/Run','/TN','PainelOfertasServidor' -Verb RunAs -Wait"
timeout /t 2 /nobreak >nul
call "%~dp0verificar-status.bat"
