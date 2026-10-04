@echo off
setlocal

REM OrbitWatch launcher
REM Place this .bat file in the ROOT of the OrbitWatch repository.
REM It uses the folder containing this file, so no drive letter or user-specific path is required.

set "ROOT=%~dp0"

where wt.exe >nul 2>&1
if errorlevel 1 (
    echo Windows Terminal ^(wt.exe^) was not found.
    echo Install or open Windows Terminal to use the 3-tab launcher.
    echo.
    pause
    exit /b 1
)

start "" wt.exe -w new ^
    new-tab --title "OrbitWatch Backend" powershell.exe -NoExit -Command "Set-Location -LiteralPath '%ROOT%backend'" ^
    ; new-tab --title "OrbitWatch Frontend" powershell.exe -NoExit -Command "Set-Location -LiteralPath '%ROOT%frontend'" ^
    ; new-tab --title "OrbitWatch" powershell.exe -NoExit -Command "Set-Location -LiteralPath '%ROOT%'"

endlocal
