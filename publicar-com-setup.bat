@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set "REMOTE_URL=https://github.com/Simplesmente100/GeoFotoBP.git"
set "COMMIT_MSG=Atualiza visual com amarelo mais vivo e elegante"
set "GIT_EXE="

if exist "C:\Program Files\Git\cmd\git.exe" set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
if not defined GIT_EXE if exist "C:\Program Files\Git\bin\git.exe" set "GIT_EXE=C:\Program Files\Git\bin\git.exe"
if not defined GIT_EXE set "GIT_EXE=git"

echo ==========================================
echo   Setup + Sync + Publicacao GeoFotoBP
echo ==========================================

"%GIT_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo ERRO: Git nao encontrado.
  echo Instale o Git: winget install --id Git.Git -e
  pause
  exit /b 1
)

if not exist ".git" (
  echo [setup] Inicializando repositorio...
  "%GIT_EXE%" init
  if errorlevel 1 goto :erro
)

echo [setup] Garantindo branch main...
"%GIT_EXE%" branch -M main
if errorlevel 1 goto :erro

"%GIT_EXE%" remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [setup] Configurando remoto origin...
  "%GIT_EXE%" remote add origin %REMOTE_URL%
) else (
  echo [setup] Atualizando remoto origin...
  "%GIT_EXE%" remote set-url origin %REMOTE_URL%
)
if errorlevel 1 goto :erro

for /f "delims=" %%A in ('"%GIT_EXE%" config --global user.name 2^>nul') do set GIT_NAME=%%A
for /f "delims=" %%A in ('"%GIT_EXE%" config --global user.email 2^>nul') do set GIT_EMAIL=%%A

if "%GIT_NAME%"=="" (
  echo [setup] user.name nao configurado.
  set /p GIT_NAME=Digite seu nome para o Git: 
  if "!GIT_NAME!"=="" goto :erro
  "%GIT_EXE%" config --global user.name "!GIT_NAME!"
  if errorlevel 1 goto :erro
)

if "%GIT_EMAIL%"=="" (
  echo [setup] user.email nao configurado.
  set /p GIT_EMAIL=Digite seu email do GitHub: 
  if "!GIT_EMAIL!"=="" goto :erro
  "%GIT_EXE%" config --global user.email "!GIT_EMAIL!"
  if errorlevel 1 goto :erro
)

echo [1/5] Adicionando arquivos...
"%GIT_EXE%" add .
if errorlevel 1 goto :erro

echo [2/5] Criando commit local...
"%GIT_EXE%" commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo Aviso: nenhum arquivo novo para commit.
)

echo [3/5] Guardando arquivos locais para sincronizar com remoto...
"%GIT_EXE%" stash push -u -m "auto-sync-temp" >nul 2>&1

echo [4/5] Baixando atualizacoes do GitHub...
"%GIT_EXE%" pull origin main --allow-unrelated-histories
if errorlevel 1 (
  echo Tentando resolver conflitos padrao em index.html e manifest.json...
  "%GIT_EXE%" checkout --ours index.html manifest.json >nul 2>&1
  "%GIT_EXE%" add index.html manifest.json >nul 2>&1
  "%GIT_EXE%" commit -m "Resolve merge mantendo visual local" >nul 2>&1
)

echo [4.1/5] Restaurando alteracoes locais guardadas...
"%GIT_EXE%" stash pop >nul 2>&1

echo [4.2/5] Reaplicando arquivos principais...
"%GIT_EXE%" add .
if errorlevel 1 goto :erro

"%GIT_EXE%" commit -m "%COMMIT_MSG%" >nul 2>&1

echo [5/5] Enviando para GitHub...
"%GIT_EXE%" push -u origin main
if errorlevel 1 goto :erro

echo.
echo Concluido com sucesso. Aguarde o deploy na Vercel.
pause
exit /b 0

:erro
echo.
echo ERRO durante a execucao.
echo Se aparecer conflito, me envie a mensagem para eu ajustar automaticamente.
pause
exit /b 1
