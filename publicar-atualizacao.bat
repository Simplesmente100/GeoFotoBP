@echo off
setlocal

cd /d "%~dp0"

set "GIT_EXE="
if exist "C:\Program Files\Git\cmd\git.exe" set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
if not defined GIT_EXE if exist "C:\Program Files\Git\bin\git.exe" set "GIT_EXE=C:\Program Files\Git\bin\git.exe"
if not defined GIT_EXE set "GIT_EXE=git"

echo ==========================================
echo   Publicar atualizacao visual GeoFotoBP
echo ==========================================
echo.

"%GIT_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo ERRO: Git nao encontrado. Instale o Git e tente novamente.
  pause
  exit /b 1
)

echo [1/3] Adicionando arquivos...
"%GIT_EXE%" add index.html manifest.json
if errorlevel 1 (
  echo ERRO ao executar git add.
  pause
  exit /b 1
)

echo [2/3] Criando commit...
"%GIT_EXE%" commit -m "Atualiza visual com amarelo mais vivo e elegante"
if errorlevel 1 (
  echo Aviso: pode nao haver mudancas novas para commit.
)

echo [3/3] Enviando para o GitHub...
"%GIT_EXE%" push
if errorlevel 1 (
  echo ERRO ao executar git push.
  pause
  exit /b 1
)

echo.
echo Concluido com sucesso!
echo Aguarde alguns segundos para o deploy na Vercel.
pause
