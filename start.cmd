@echo off
setlocal
cd /d "%~dp0"
echo hd_conflicttool
type "%~dp0VERSION.txt"
echo The browser opens when ready. If it does not, open http://127.0.0.1:5158.
start "" /b powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$url = 'http://127.0.0.1:5158'; for ($attempt = 0; $attempt -lt 20; $attempt++) { try { $status = Invoke-RestMethod -Uri ($url + '/api/status') -TimeoutSec 1; if ($status.ready -and $status.converter -eq 'CodeWalker.Core') { Start-Process -FilePath $url; exit } } catch {} ; Start-Sleep -Milliseconds 500 }"
echo Press Ctrl+C to stop. Converter diagnostics appear in this window.
"%~dp0dotnet\dotnet.exe" "%~dp0converter\YmapConverter.dll"
set "exit_code=%errorlevel%"
if not "%exit_code%"=="0" pause
exit /b %exit_code%
