@echo off
cd /d "%~dp0"
title Gastos TI - CGR
echo ==========================================
echo   Gastos TI - arranque
echo ==========================================
echo.

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Se creo el archivo .env con la configuracion por defecto.
)
rem Un .env de la version anterior apuntaba a un PostgreSQL externo inexistente; se regenera.
type ".env" | find "cambia-esta-clave@localhost:5432" >nul 2>nul && (
  copy /y ".env.example" ".env" >nul
  echo Se actualizo .env para usar PostgreSQL embebido.
)

where docker >nul 2>nul
if %errorlevel%==0 goto docker

where node >nul 2>nul
if %errorlevel%==0 goto node

echo No se encontro Docker ni Node.js en esta PC.
echo.
echo Instala Node.js LTS desde https://nodejs.org y vuelve a ejecutar este archivo.
echo (No hace falta instalar PostgreSQL: la app trae uno embebido.)
echo.
pause
exit /b 1

:docker
echo Docker encontrado. Levantando PostgreSQL y la aplicacion...
docker compose up -d --build
if not %errorlevel%==0 (
  echo.
  echo Docker devolvio un error. Si Docker Desktop no esta abierto, abrelo, espera a que diga "Engine running" y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
goto esperar_inicio

:node
echo Node.js encontrado. Se usara PostgreSQL embebido (carpeta pgdata).
echo Verificando dependencias (la primera vez descarga PostgreSQL, puede tardar 1-2 minutos)...
call npm install --omit=dev --no-audit --no-fund
if not %errorlevel%==0 (
  echo.
  echo npm install fallo. Revisa la conexion a internet y vuelve a intentar.
  pause
  exit /b 1
)
curl -s -o nul http://localhost:3000/api/salud && goto listo
start "Gastos TI - servidor (no cierres esta ventana)" cmd /k "node server\index.js"

:esperar_inicio
echo.
echo Esperando a que la aplicacion responda...
set /a intentos=0
:esperar
set /a intentos+=1
timeout /t 2 >nul
curl -s -o nul http://localhost:3000/api/salud && goto listo
if %intentos% lss 60 goto esperar
echo.
echo La aplicacion no respondio en 2 minutos. Revisa el archivo servidor.log
echo o la ventana "Gastos TI - servidor" para ver el error.
pause
exit /b 1

:listo
echo.
echo Listo. Abriendo http://localhost:3000
start http://localhost:3000
echo Desde otra PC de la red usa http://IP-DE-ESTA-PC:3000 (ipconfig para ver la IP).
echo Para detener: cierra la ventana "Gastos TI - servidor".
timeout /t 6 >nul
