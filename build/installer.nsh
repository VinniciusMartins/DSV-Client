!macro customInstall
  DetailPrint "Checking for PowerShell 7..."

  ; Only attempt on x64 Windows (MSI is x64)
  ${IfNot} ${RunningX64}
    DetailPrint "Skipping PS7 install: OS not x64."
    Goto done_ps7
  ${EndIf}

  ; 1) Check standard install path (PowerShell 7 keeps a stable '7' folder)
  StrCpy $0 ""
  IfFileExists "C:\Program Files\PowerShell\7\pwsh.exe" 0 +3
    StrCpy $0 "present"
    Goto decide

  ; 2) Try PATH lookup (in case user installed elsewhere)
  nsExec::ExecToStack 'cmd /c where pwsh.exe'
  Pop $1 ; exit code
  Pop $2 ; output / path(s)
  StrCmp $1 "0" 0 +2
    StrCpy $0 "present"

decide:
  StrCmp $0 "present" 0 install_ps7
    DetailPrint "PowerShell 7 already present."
    Goto done_ps7

install_ps7:
  DetailPrint "Installing PowerShell 7 (silent)..."
  ; The MSI was copied by electron-builder into $INSTDIR\resources\
  ; /qn = silent, /norestart = don't auto-reboot
  ExecWait 'msiexec /i "$INSTDIR\resources\PowerShell-7.5.2-win-x64.msi" /qn /norestart' $3
  DetailPrint "MSI exit code: $3"

done_ps7:
!macroend
