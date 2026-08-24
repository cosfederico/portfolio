@echo off
setlocal enabledelayedexpansion

rem Converts every clip in _resources\videos to a small, silent, looping
rem .mp4 copy in _resources\videos-web, for use as background decoration
rem instead of the raw phone-camera originals (which run 20-150MB each).
rem Scaled down, capped to MAX_DURATION seconds, and stripped of audio,
rem since these only ever autoplay muted and small in the background -
rem full resolution/length/audio would just be wasted bandwidth.

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "SRC_DIR=%REPO_ROOT%\_resources\videos"
set "DEST_DIR=%REPO_ROOT%\_resources\videos-web"
set MAX_DIM=1280
set MAX_DURATION=15
set CRF=28

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ffmpeg not found on PATH.
  exit /b 1
)

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

set count=0
set skipped=0

for %%F in ("%SRC_DIR%\*.mp4" "%SRC_DIR%\*.mov") do (
  set "SRC=%%~fF"
  set "NAME=%%~nF"
  rem Source filenames can have spaces/parens (phone export names) - strip
  rem those from the output name so it's a clean, URL-safe asset path.
  set "SAFE=!NAME: =-!"
  set "SAFE=!SAFE:(=-!"
  set "SAFE=!SAFE:)=!"
  set "OUT=%DEST_DIR%\!SAFE!.mp4"

  if exist "!OUT!" (
    set /a skipped+=1
  ) else (
    echo Converting: %%~nxF
    rem force_divisible_by=2 matters for portrait/odd-ratio clips - libx264
    rem refuses odd pixel widths/heights.
    ffmpeg -y -loglevel error -i "!SRC!" -t %MAX_DURATION% -vf "scale=w=%MAX_DIM%:h=%MAX_DIM%:force_original_aspect_ratio=decrease:force_divisible_by=2" -r 24 -an -c:v libx264 -crf %CRF% -preset fast -movflags +faststart "!OUT!"
    set /a count+=1
  )
)

echo Done. Converted: %count%, already existed: %skipped%, output: %DEST_DIR%
endlocal
