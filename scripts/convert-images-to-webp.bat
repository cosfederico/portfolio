@echo off
setlocal enabledelayedexpansion

rem Converts every photo in assets-source\images to a resized .webp copy in
rem public\_resources\images-web, for use on the site instead of the raw
rem full-resolution originals (which run 15-50MB each). The originals live
rem OUTSIDE public/ on purpose - anything under public/ gets copied into
rem every Astro build as-is, and nobody needs to download 1.8GB of raw
rem source photos to view the site.

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "SRC_DIR=%REPO_ROOT%\assets-source\images"
set "DEST_DIR=%REPO_ROOT%\public\_resources\images-web"
set MAX_DIM=1600
set QUALITY=82

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ffmpeg not found on PATH.
  exit /b 1
)

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

set count=0
set skipped=0

for %%F in ("%SRC_DIR%\*.jpg" "%SRC_DIR%\*.jpeg" "%SRC_DIR%\*.png") do (
  set "SRC=%%~fF"
  set "NAME=%%~nF"
  set "OUT=%DEST_DIR%\!NAME!.webp"

  if exist "!OUT!" (
    set /a skipped+=1
  ) else (
    echo Converting: %%~nxF
    ffmpeg -y -loglevel error -i "!SRC!" -vf "scale=w=%MAX_DIM%:h=%MAX_DIM%:force_original_aspect_ratio=decrease" -c:v libwebp -quality %QUALITY% "!OUT!"
    set /a count+=1
  )
)

echo Done. Converted: %count%, already existed: %skipped%, output: %DEST_DIR%
endlocal
