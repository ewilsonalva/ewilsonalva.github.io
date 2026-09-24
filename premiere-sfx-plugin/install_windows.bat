@echo off
REM Installs the SFX Library panel for Premiere Pro (Windows).
set "DEST=%APPDATA%\Adobe\CEP\extensions\SFXLibrary"
echo Installing to %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0SFXLibrary" "%DEST%\" /e /i /q /y >nul
REM Allow unsigned extensions (CEP 9 - 13 covers Premiere Pro 2019 through 2026)
for %%V in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Done. Restart Premiere Pro, then open Window ^> Extensions ^> SFX Library.
pause
