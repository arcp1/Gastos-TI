@echo off
cd /d "%~dp0"
echo Deteniendo Gastos TI...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
if exist "pgdata\postmaster.pid" "node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe" -D "pgdata" stop -m fast >nul 2>nul
echo Servidor detenido.
timeout /t 3 >nul
