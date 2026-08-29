@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title مالی من — GitHub + Vercel

cd /d "%~dp0"

echo.
echo  ==============================================
echo    مالی من — ارسال به GitHub + انتشار Vercel
echo  ==============================================
echo.

REM ── بررسی ابزارهای لازم ──
where git >nul 2>nul <nul
if errorlevel 1 (
    echo  [خطا] git نصب نیست — از git-scm.com نصب کنید.
    goto :fail
)
where node >nul 2>nul <nul
if errorlevel 1 (
    echo  [خطا] Node.js نصب نیست — از nodejs.org نصب کنید.
    goto :fail
)

REM ── آدرس مخزن به‌صورت آرگومان: deploy.bat https://github.com/mojtabaaomidvar/FinanicalManagement.git ──
set "REPO_URL_ARG=%~1"

echo  چه کاری انجام شود؟
echo    [1] ارسال به GitHub + انتشار روی Vercel
echo    [2] فقط ارسال به GitHub
echo    [3] فقط انتشار روی Vercel
echo.
set "CHOICE="
set /p CHOICE= انتخاب شما - پیش‌فرض 1 : 
if "!CHOICE!"=="" set "CHOICE=1"

if "!CHOICE!"=="1" goto :run_both
if "!CHOICE!"=="2" goto :run_github
if "!CHOICE!"=="3" goto :run_vercel
echo  انتخاب نامعتبر — گزینه 1 اجرا می‌شود.
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

REM ═══════════════ GitHub ═══════════════
:do_github
echo.
echo  ===== GitHub =====
echo.

if not exist ".git" (
    git init >nul 2>nul
    echo  مخزن git ساخته شد.
)

if not exist ".gitignore" (
    >.gitignore echo node_modules/
    >>.gitignore echo .vercel/
    >>.gitignore echo .DS_Store
    >>.gitignore echo Thumbs.db
    echo  فایل gitignore ساخته شد.
)

REM ── هویت git اگر تنظیم نشده باشد ──
git config user.name >nul 2>nul <nul
if not errorlevel 1 goto :git_id_ok
echo  تنظیمات هویت git کامل نیست.
set "GIT_NAME="
set /p GIT_NAME= نام کاربری GitHub : 
set "GIT_EMAIL="
set /p GIT_EMAIL= ایمیل GitHub : 
git config user.name "!GIT_NAME!"
git config user.email "!GIT_EMAIL!"

:git_id_ok
git add -A
git commit -m "Mali-Man v2.0 - Supabase + family + SMS" >nul 2>nul
git branch -M main

REM ── اتصال به مخزن راه دور ──
git remote get-url origin >nul 2>nul <nul
if not errorlevel 1 goto :has_remote

if not "!REPO_URL_ARG!"=="" (
    set "REPO_URL=!REPO_URL_ARG!"
    goto :set_remote
)
echo.
echo  آدرس مخزن GitHub را وارد کنید.
echo  مثال: https://github.com/USERNAME/REPO.git
echo  نکته: مخزن را در github.com بسازید — خالی و بدون README.
set "REPO_URL="
set /p REPO_URL= آدرس مخزن : 
if "!REPO_URL!"=="" (
    echo  [خطا] آدرس مخزن خالی است.
    exit /b 1
)

:set_remote
git remote add origin "!REPO_URL!"

:has_remote
echo.
echo  در حال ارسال به GitHub...
git push -u origin main
if errorlevel 1 (
    echo  [خطا] ارسال ناموفق — اینترنت، دسترسی و آدرس را چک کنید.
    echo  اگر مخزن از قبل فایل دارد، آن را خالی کنید و دوباره تلاش کنید.
    exit /b 1
)
echo.
echo  ارسال به GitHub با موفقیت انجام شد.
exit /b 0

REM ═══════════════ Vercel ═══════════════
:do_vercel
echo.
echo  ===== Vercel =====
echo.

where vercel >nul 2>nul <nul
if not errorlevel 1 goto :vercel_run
echo  Vercel CLI نصب نیست — در حال نصب...
call npm install -g vercel
if errorlevel 1 (
    echo  [خطا] نصب Vercel CLI ناموفق بود.
    exit /b 1
)

:vercel_run
echo.
echo  نکته: اگر اولین بار است و وارد نشده‌اید، مرورگر برای ورود باز می‌شود.
echo  در حال انتشار روی Vercel...
call vercel --prod --yes
if errorlevel 1 (
    echo  [خطا] انتشار ناموفق — دستور vercel login را دستی اجرا کنید و دوباره تلاش کنید.
    exit /b 1
)
echo.
echo  انتشار روی Vercel با موفقیت انجام شد.
exit /b 0

:done
echo.
echo  ==============================================
echo  تمام شد!
echo  آدرس اپ: https://NAME-OF-PROJECT.vercel.app
echo  نصب روی آیفون: آدرس را در Safari باز کنید،
echo  سپس Share و بعد Add to Home Screen
echo  ==============================================
echo.
pause
exit /b 0

:fail
echo.
echo  عملیات با خطا متوقف شد.
pause
exit /b 1
