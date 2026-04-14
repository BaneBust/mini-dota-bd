@echo off
cd /d "%~dp0"
echo.
echo === Mini-Dota DB Update ===
echo.
set /p MSG="Beschreibung der Änderung: "
git add .
git commit -m "%MSG%"
git push
echo.
echo Fertig! Seite ist in ~1 Minute live.
pause
