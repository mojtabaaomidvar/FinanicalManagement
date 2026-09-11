@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title KhanehYar - Full Deploy - GitHub + VPS Backend + VPS Frontend

cd /d "%~dp0"

echo.
echo  ==============================================
echo    KhanehYar - Full Deploy
echo    Code     : GitHub  - push
echo    Backend  : ParsPack VPS  - git pull + docker compose
echo    Frontend : ParsPack VPS  - build + upload dist
echo  ==============================================
echo.

REM -- keyword args: deploy.bat all / backend / frontend / github / config --
set "CHOICE="
if /i "%~1"=="all"      set "CHOICE=1"
if /i "%~1"=="backend"  set "CHOICE=2"
if /i "%~1"=="frontend" set "CHOICE=3"
if /i "%~1"=="github"   set "CHOICE=4"
if /i "%~1"=="config"   goto :setup_config
set "REPO_URL_ARG="
if not "%~1"=="" if "!CHOICE!"=="" set "REPO_URL_ARG=%~1"

REM -- Check required tools --
where git >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] git is not installed - install it from git-scm.com
    goto :fail
)
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed - install it from nodejs.org
    goto :fail
)

REM =============== Config (saved in deploy-config.bat, gitignored) ===============
call :load_config

if not "!CHOICE!"=="" goto :dispatch

echo  What do you want to do?
echo    [1] Deploy all - GitHub + Backend + Frontend
echo    [2] Backend only - VPS
echo    [3] Frontend only - VPS
echo    [4] Push to GitHub only
echo    [5] Change server settings - SSH address / paths
echo.
set "CHOICE="
set /p CHOICE= Your choice - default 1 : 
if "!CHOICE!"=="" set "CHOICE=1"

:dispatch
if "!CHOICE!"=="1" goto :run_all
if "!CHOICE!"=="2" goto :run_backend
if "!CHOICE!"=="3" goto :run_frontend
if "!CHOICE!"=="4" goto :run_github
if "!CHOICE!"=="5" goto :setup_config
echo  Invalid choice - running option 1.
goto :run_all

REM =============== Runners ===============
:run_all
call :do_github   || goto :fail
call :do_backend  || goto :fail
call :do_frontend || goto :fail
goto :done

:run_backend
call :do_backend || goto :fail
goto :done

:run_frontend
call :do_frontend || goto :fail
goto :done

:run_github
call :do_github || goto :fail
goto :done

REM =============== Config helpers ===============
:load_config
set "SSH_TARGET="
set "SERVER_DIR="
set "WEB_DIR="
set "API_URL="
if exist "deploy-config.bat" call "deploy-config.bat"
REM Defaults for configs saved before the frontend moved off Vercel,
REM so an existing deploy-config.bat keeps working without re-running setup.
if "!WEB_DIR!"=="" set "WEB_DIR=/var/www/khaneyar"
if "!API_URL!"=="" set "API_URL=https://api.khaanehyar.ir"
if not "!SSH_TARGET!"=="" if not "!SERVER_DIR!"=="" goto :eof
echo  First run - server settings are needed. They will be saved
echo  in deploy-config.bat - which is gitignored and stays on this PC only.
echo.
goto :prompt_config

:setup_config
call :prompt_config
echo  Settings saved.
pause
exit /b 0

:prompt_config
set "SSH_TARGET="
set /p SSH_TARGET= SSH address like root@185.x.x.x :
if "!SSH_TARGET!"=="" (
    echo  [ERROR] SSH address cannot be empty.
    goto :prompt_config
)
set "SERVER_DIR="
set /p SERVER_DIR= Path of backend on server - Enter for /opt/khaneyar/backend :
if "!SERVER_DIR!"=="" set "SERVER_DIR=/opt/khaneyar/backend"
set "WEB_DIR="
set /p WEB_DIR= Web root for the PWA - Enter for /var/www/khaneyar :
if "!WEB_DIR!"=="" set "WEB_DIR=/var/www/khaneyar"
set "API_URL="
set /p API_URL= Backend URL for the build - Enter for https://api.khaanehyar.ir :
if "!API_URL!"=="" set "API_URL=https://api.khaanehyar.ir"
> "deploy-config.bat" echo set "SSH_TARGET=!SSH_TARGET!"
>>"deploy-config.bat" echo set "SERVER_DIR=!SERVER_DIR!"
>>"deploy-config.bat" echo set "WEB_DIR=!WEB_DIR!"
>>"deploy-config.bat" echo set "API_URL=!API_URL!"
echo  Saved: !SSH_TARGET!  -^>  !SERVER_DIR!  ^|  web: !WEB_DIR!
echo.
goto :eof

REM =============== Backend - VPS over SSH ===============
:do_backend
where ssh >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] ssh not found - enable Windows OpenSSH Client
    echo  or install it from Settings - Apps - Optional Features.
    exit /b 1
)
echo.
echo  ===== Backend - ParsPack VPS =====
echo  Server: !SSH_TARGET!
echo  Path  : !SERVER_DIR!
echo.
echo  You may be asked for the server password 1 time.
echo  The build takes a few minutes - keep this window open.
echo.
ssh !SSH_TARGET! "cd !SERVER_DIR! && git pull && cd deploy && docker compose up -d --build && docker compose run --rm api alembic upgrade head && echo === HEALTH CHECK === && curl -s http://127.0.0.1:8000/api/v1/healthz && echo. && echo === BACKEND OK ==="
if errorlevel 1 (
    echo.
    echo  [ERROR] Backend deploy failed. Common causes:
    echo   - wrong password - run again
    echo   - first connect: answer "yes" to the fingerprint question
    echo   - git pull failed: run "git pull" by hand on the server once -
    echo     if the repo is private the server needs a deploy key
    echo   - check /opt/khaneyar/backend/deploy/.env exists on the server
    exit /b 1
)
exit /b 0

REM =============== Frontend - build + upload dist to the VPS ===============
REM Vercel was retired on 2026-09-10 - the live site is served by nginx on the
REM VPS from !WEB_DIR!, so "vercel --prod" updated nothing users could see.
:do_frontend
where ssh >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] ssh not found - enable Windows OpenSSH Client
    echo  or install it from Settings - Apps - Optional Features.
    exit /b 1
)
where tar >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] tar not found - needs Windows 10 build 1803 or newer.
    exit /b 1
)
echo.
echo  ===== Frontend - build + upload to VPS =====
echo  Server : !SSH_TARGET!
echo  Web dir: !WEB_DIR!
echo  API URL: !API_URL!
echo.

if not exist "node_modules" (
    echo  Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        exit /b 1
    )
)

REM VITE_API_URL must be set at BUILD time - Vite inlines it into the bundle.
set "VITE_API_URL=!API_URL!"
echo  Building - this takes a moment...
call npm run build
if errorlevel 1 (
    echo  [ERROR] Build failed - fix the errors above and try again.
    exit /b 1
)
if not exist "dist\index.html" (
    echo  [ERROR] dist\index.html not found - the build produced no output.
    exit /b 1
)

echo  Packing dist...
if exist "dist.tgz" del /q "dist.tgz"
tar -czf dist.tgz -C dist .
if errorlevel 1 (
    echo  [ERROR] Could not pack dist.
    exit /b 1
)

echo  Uploading...
scp dist.tgz !SSH_TARGET!:/tmp/khaneyar-dist.tgz
if errorlevel 1 (
    echo  [ERROR] Upload failed - check SSH access.
    del /q "dist.tgz" >nul 2>nul
    exit /b 1
)
del /q "dist.tgz" >nul 2>nul

REM Unpack next to the live dir and swap - the site is never half-written.
REM The previous version stays in <dir>.old so a rollback is one mv away.
echo  Installing on the server...
ssh !SSH_TARGET! "set -e && rm -rf '!WEB_DIR!.new' && mkdir -p '!WEB_DIR!.new' && tar -xzf /tmp/khaneyar-dist.tgz -C '!WEB_DIR!.new' && rm -f /tmp/khaneyar-dist.tgz && rm -rf '!WEB_DIR!.old' && if [ -d '!WEB_DIR!' ]; then mv '!WEB_DIR!' '!WEB_DIR!.old'; fi && mv '!WEB_DIR!.new' '!WEB_DIR!' && chown -R www-data:www-data '!WEB_DIR!' 2>/dev/null || true && nginx -t && systemctl reload nginx && echo === FRONTEND OK ==="
if errorlevel 1 (
    echo.
    echo  [ERROR] Frontend deploy failed. Common causes:
    echo   - wrong password - run again
    echo   - nginx config test failed: run "nginx -t" on the server
    echo   - !WEB_DIR! not writable by this SSH user
    exit /b 1
)
echo  Frontend deployed successfully.
exit /b 0

REM =============== GitHub ===============
:do_github
echo.
echo  ===== GitHub =====
echo.

if not exist ".git" (
    git init >nul 2>nul
    echo  git repository created.
)

if not exist ".gitignore" (
    >.gitignore echo node_modules/
    >>.gitignore echo dist/
    >>.gitignore echo dist.tgz
    >>.gitignore echo .env
    >>.gitignore echo .env.local
    >>.gitignore echo .env.*.local
    >>.gitignore echo deploy-config.bat
    >>.gitignore echo .DS_Store
    >>.gitignore echo Thumbs.db
    echo  .gitignore created.
)

git config user.name >nul 2>nul
if not errorlevel 1 goto :git_id_ok
echo  git identity is not configured.
set "GIT_NAME="
set /p GIT_NAME= GitHub username : 
set "GIT_EMAIL="
set /p GIT_EMAIL= GitHub email : 
git config user.name "!GIT_NAME!"
git config user.email "!GIT_EMAIL!"

:git_id_ok
set "STAMP=%date% %time:~0,5%"
set "MSG=deploy %STAMP%"
set /p MSG= Commit message - press Enter for default : 
if "!MSG!"=="" set "MSG=deploy %STAMP%"

git add -A
git diff --cached --quiet >nul 2>nul
if errorlevel 1 (
    git commit -m "!MSG!" >nul 2>nul
    echo  Committed: !MSG!
) else (
    echo  Nothing to commit - code is already up to date.
)
git branch -M main

REM -- Connect to remote repository --
git remote get-url origin >nul 2>nul
if not errorlevel 1 goto :has_remote

if not "!REPO_URL_ARG!"=="" (
    set "REPO_URL=!REPO_URL_ARG!"
    goto :set_remote
)
echo.
echo  Enter your GitHub repository URL.
echo  Example: https://github.com/USERNAME/REPO.git
echo  Tip: create the repository on github.com - empty, without a README.
set "REPO_URL="
set /p REPO_URL= Repository URL : 
if "!REPO_URL!"=="" (
    echo  [ERROR] Repository URL is empty.
    exit /b 1
)

:set_remote
git remote add origin "!REPO_URL!"

:has_remote
echo.
echo  Pushing to GitHub...
git push -u origin main
if errorlevel 1 (
    echo  [ERROR] Push failed - check your internet, access rights and URL.
    echo  If the repository already contains files, empty it and try again.
    exit /b 1
)
echo  Successfully pushed to GitHub.
exit /b 0

:done
echo.
echo  ==============================================
echo  Done!
echo.
echo  Backend health: https://api.khaanehyar.ir/api/v1/healthz
echo  Frontend     : https://khaanehyar.ir
echo.
echo  Frontend looks unchanged? Hard-refresh once - the PWA service
echo  worker serves the old build until it picks up the new one.
echo  Rollback: mv !WEB_DIR!.old back over !WEB_DIR! on the server.
echo.
echo  Market tile says "not configured"?
echo  Add BRSAPI_KEY=your-key to the server file:
echo    !SERVER_DIR!/deploy/.env
echo  then run this script again - option 2 - backend only.
echo  ==============================================
echo.
pause
exit /b 0

:fail
echo.
echo  The operation stopped with an error.
pause
exit /b 1
