@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title KhanehYar - GitHub + Vercel

cd /d "%~dp0"

echo.
echo  ==============================================
echo    KhanehYar - Push to GitHub + Deploy to Vercel
echo  ==============================================
echo.

REM -- Check required tools --
where git >nul 2>nul <nul
if errorlevel 1 (
    echo  [ERROR] git is not installed - install it from git-scm.com
    goto :fail
)
where node >nul 2>nul <nul
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed - install it from nodejs.org
    goto :fail
)

REM -- Repo URL can be passed as an argument: deploy.bat https://github.com/USER/REPO.git --
set "REPO_URL_ARG=%~1"

echo  What do you want to do?
echo    [1] Push to GitHub + deploy to Vercel
echo    [2] Push to GitHub only
echo    [3] Deploy to Vercel only
echo.
set "CHOICE="
set /p CHOICE= Your choice - default 1 :
if "!CHOICE!"=="" set "CHOICE=1"

if "!CHOICE!"=="1" goto :run_both
if "!CHOICE!"=="2" goto :run_github
if "!CHOICE!"=="3" goto :run_vercel
echo  Invalid choice - running option 1.
goto :run_both

:run_both
call :do_github || goto :fail
call :do_vercel  || goto :fail
goto :done

:run_github
call :do_github || goto :fail
goto :done

:run_vercel
call :do_vercel || goto :fail
goto :done

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
    >>.gitignore echo .vercel/
    >>.gitignore echo dist/
    >>.gitignore echo .env
    >>.gitignore echo .env.local
    >>.gitignore echo .env.*.local
    >>.gitignore echo .DS_Store
    >>.gitignore echo Thumbs.db
    echo  .gitignore created.
)

REM -- Set git identity if not configured --
git config user.name >nul 2>nul <nul
if not errorlevel 1 goto :git_id_ok
echo  git identity is not configured.
set "GIT_NAME="
set /p GIT_NAME= GitHub username :
set "GIT_EMAIL="
set /p GIT_EMAIL= GitHub email :
git config user.name "!GIT_NAME!"
git config user.email "!GIT_EMAIL!"

:git_id_ok
git add -A
git commit -m "KhanehYar v3.0 - phone auth + OTP + QR invite" >nul 2>nul
git branch -M main

REM -- Connect to remote repository --
git remote get-url origin >nul 2>nul <nul
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
echo.
echo  Successfully pushed to GitHub.
exit /b 0

REM =============== Vercel ===============
:do_vercel
echo.
echo  ===== Vercel =====
echo.

where vercel >nul 2>nul <nul
if not errorlevel 1 goto :vercel_run
echo  Vercel CLI is not installed - installing...
call npm install -g vercel
if errorlevel 1 (
    echo  [ERROR] Failed to install the Vercel CLI.
    exit /b 1
)

:vercel_run
echo.
echo  Note: if this is the first time and you are not logged in, a browser window will open for login.
echo  Deploying to Vercel...
call vercel --prod --yes
if errorlevel 1 (
    echo  [ERROR] Deploy failed - run "vercel login" manually and try again.
    exit /b 1
)
echo.
echo  Successfully deployed to Vercel.
exit /b 0

:done
echo.
echo  ==============================================
echo  Done!
echo  App URL: https://NAME-OF-PROJECT.vercel.app
echo  Install on iPhone: open the URL in Safari,
echo  then Share and Add to Home Screen
echo  ==============================================
echo.
pause
exit /b 0

:fail
echo.
echo  The operation stopped with an error.
pause
exit /b 1
