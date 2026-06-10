; Mithras Threat Defence Agent — Windows installer
; Built with Inno Setup 6 (https://jrsoftware.org/isinfo.php).
; To compile: run installer\build.ps1 (which stages the payload and
; invokes ISCC.exe). Output: installer\output\MithrasAgent-Setup.exe

#define MyAppName "Mithras Threat Defence"
#define MyAppPublisher "Peritus Digital Pty Ltd"
#define MyAppURL "https://www.mithras.com.au"
#define MyAppSupportURL "https://www.mithras.com.au"
#define MyAppApiUrl "https://api.mithras.com.au"
#define MyAppServiceName "MithrasAgent"
; Read the version from agent.version so it's never out of sync.
#define MyAppVersion ReadIni(SourcePath + "..\agent\runtime-powershell\agent.version", "", "", "0.0.0")
#if MyAppVersion == "0.0.0"
  #define MyAppVersion Trim(FileRead(FileOpen(SourcePath + "..\agent\runtime-powershell\agent.version")))
#endif

[Setup]
; AppId is a stable UUID — uninstaller / upgrade detection keys off this.
; Never change it once shipped to customers.
AppId={{B7A1F9E0-3C44-4D11-B1DE-2A7E1F6C9B41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppSupportURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Mithras
DisableDirPage=yes
DefaultGroupName=Mithras
DisableProgramGroupPage=yes
LicenseFile=eula.txt
OutputDir=output
OutputBaseFilename=MithrasAgent-Setup-{#MyAppVersion}
SetupIconFile=assets\mithras.ico
WizardImageFile=assets\wizard-banner.bmp
WizardSmallImageFile=assets\wizard-small.bmp
WizardImageStretch=yes
WizardStyle=modern
Compression=lzma2/ultra
SolidCompression=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\mithras.ico
; Match the look of bigger SaaS installers — no "click finish to restart"
; nag, no command-line console flashing.
ShowLanguageDialog=no
CloseApplications=force
RestartIfNeededByRun=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The whole agent runtime: lib\*.psm1, vendor\nssm.exe, install/uninstall
; scripts, mithras.ico, sysmon-config.xml. Stage these into installer\payload
; first via build.ps1.
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "assets\mithras.ico"; DestDir: "{app}"; DestName: "mithras.ico"; Flags: ignoreversion

[Run]
; Install the agent. install-agent.ps1 handles service registration via NSSM,
; HMAC enrolment, DPAPI config write, legacy migration from PeritusSecureAgent.
; Status text in the wizard reflects the high-level step; PowerShell runs hidden.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\install-agent.ps1"" -ApiBaseUrl ""{#MyAppApiUrl}"" -EnrollmentToken ""{code:GetEnrolmentCode}"" -ServiceName ""{#MyAppServiceName}"""; \
  Flags: runhidden waituntilterminated; \
  StatusMsg: "Installing the Mithras Threat Defence Agent..."

; Optional: open the portal after install (driven by a checkbox on the
; finish page that defaults on).
[Code]
var
  CodePage: TInputQueryWizardPage;
  EnrolmentCode: String;

procedure InitializeWizard;
var
  PrefillCode: String;
begin
  CodePage := CreateInputQueryPage(
    wpLicense,
    'Connect this endpoint',
    'Paste your enrolment code from the Mithras portal',
    'Generate a code at https://www.mithras.com.au/login → Agents → Download. ' +
    'It links this endpoint to your tenant.'
  );
  CodePage.Add('Enrolment code:', False);

  // Honour /CODE=xxx on the command line (silent MSP deployments via RMM).
  PrefillCode := ExpandConstant('{param:CODE|}');
  if PrefillCode <> '' then begin
    CodePage.Values[0] := PrefillCode;
    EnrolmentCode := PrefillCode;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = CodePage.ID then begin
    EnrolmentCode := Trim(CodePage.Values[0]);
    if EnrolmentCode = '' then begin
      MsgBox(
        'Please paste the enrolment code from your Mithras portal.' + #13#10#13#10 +
        'You can generate one at https://www.mithras.com.au/login → Agents → Download.',
        mbError, MB_OK
      );
      Result := False;
    end;
  end;
end;

// Skip the enrolment page entirely if the customer passed /CODE=xxx on the
// command line. Lets MSPs deploy the .exe silently via RMM tools.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = CodePage.ID then
    if Trim(ExpandConstant('{param:CODE|}')) <> '' then
      Result := True;
end;

function GetEnrolmentCode(Param: String): String;
begin
  Result := EnrolmentCode;
end;

[UninstallRun]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\uninstall-agent.ps1"" -ServiceName ""{#MyAppServiceName}"""; \
  Flags: runhidden waituntilterminated; \
  RunOnceId: "MithrasUninstallAgent"

[Tasks]
Name: "openportal"; Description: "Open the Mithras portal when setup finishes"; GroupDescription: "After install:"; Flags: unchecked

[Icons]
Name: "{group}\Open Mithras Portal"; Filename: "{#MyAppURL}/login"; IconFilename: "{app}\mithras.ico"
Name: "{group}\Uninstall Mithras Threat Defence"; Filename: "{uninstallexe}"

[Run]
; Conditional portal open after the install completes.
Filename: "{#MyAppURL}/login"; Description: "Open the Mithras portal"; Flags: postinstall shellexec nowait; Tasks: openportal
