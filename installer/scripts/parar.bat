@echo off
REM Controlar a tarefa agendada exige ser Administrador - pede elevacao (UAC)
REM automaticamente se quem clicou nao for admin.
powershell -NoProfile -Command "Start-Process schtasks -ArgumentList '/End','/TN','PainelOfertasServidor' -Verb RunAs -Wait"
echo.
echo Parado. Para ligar de novo, use "Iniciar" no Menu Iniciar (ou reinicie o computador).
pause
