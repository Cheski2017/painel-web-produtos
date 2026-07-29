; Instalador do "Painel de Ofertas" para Windows, feito com Inno Setup
; (gratuito: https://jrsoftware.org/isdl.php).
;
; Como gerar o instalador (PainelOfertasSetup.exe):
;   1. Instale o Inno Setup (versão 6.x) na sua máquina de desenvolvimento.
;   2. Abra este arquivo (setup.iss) no Inno Setup, ou rode pela linha de
;      comando: "ISCC.exe setup.iss"
;   3. O instalador final aparece em installer\output\PainelOfertasSetup.exe
;
; O que o instalador faz na máquina do cliente (só a máquina "servidor"
; precisa disso - outros computadores da rede só usam o navegador):
;   - Copia os arquivos da aplicação.
;   - Roda instalar-servico.ps1, que confere/instala o Node.js se faltar,
;     registra uma Tarefa Agendada que inicia o servidor no boot (mesmo sem
;     login) e reinicia sozinha se cair, e libera a porta no Firewall.
;   - Abre o navegador na tela de login/configuração no final.

#define MyAppName "Painel de Ofertas"
#define MyAppVersion "1.0.2"
#define MyAppPublisher "Meu Mercado"
#define MyAppExeName "node.exe"

[Setup]
AppId={{91377723-AE1C-41D2-87E3-A64444504DBF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\PainelOfertas
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=PainelOfertasSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
; .env só é copiado se ainda não existir (não sobrescreve configuração numa
; atualização/reinstalação por cima de uma instalação já configurada)
Source: "..\.env.example"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\data"; Permissions: everyone-modify

[Icons]
Name: "{group}\Abrir {#MyAppName}"; Filename: "{app}\scripts\abrir-painel.bat"; WorkingDir: "{app}\scripts"
Name: "{group}\Verificar status"; Filename: "{app}\scripts\verificar-status.bat"; WorkingDir: "{app}\scripts"
Name: "{group}\Iniciar"; Filename: "{app}\scripts\iniciar.bat"; WorkingDir: "{app}\scripts"
Name: "{group}\Parar"; Filename: "{app}\scripts\parar.bat"; WorkingDir: "{app}\scripts"
Name: "{group}\Reiniciar"; Filename: "{app}\scripts\reiniciar.bat"; WorkingDir: "{app}\scripts"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\scripts\abrir-painel.bat"; WorkingDir: "{app}\scripts"; Description: "Abrir o Painel de Ofertas no navegador"; Flags: postinstall shellexec nowait skipifsilent runasoriginaluser

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\desinstalar-servico.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoverServicoPainelOfertas"

[Code]
procedure ExecutarInstaladorDeServico;
var
  ResultCode: Integer;
  Parametros: String;
begin
  Parametros := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\instalar-servico.ps1') + '"';
  if not Exec('powershell.exe', Parametros, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('Não consegui iniciar o PowerShell para configurar o início automático. ' +
           'Rode manualmente "instalar-servico.ps1" (como Administrador) na pasta scripts.',
           mbError, MB_OK);
    exit;
  end;
  if ResultCode <> 0 then
  begin
    MsgBox('A configuração automática terminou com um erro (código ' + IntToStr(ResultCode) + '). ' +
           'Os arquivos já foram copiados normalmente - você pode rodar "instalar-servico.ps1" ' +
           '(como Administrador) na pasta scripts para tentar de novo, ou revisar a mensagem ' +
           'que apareceu na janela do PowerShell.',
           mbError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    ExecutarInstaladorDeServico;
end;
