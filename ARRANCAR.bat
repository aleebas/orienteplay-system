@echo off
chcp 65001 >nul
title Sistema de Animalitos - MY SONS

echo.
echo  ==================================================
echo    SISTEMA DE ANIMALITOS - MY SONS
echo  ==================================================
echo.

echo  Cerrando procesos node anteriores...
taskkill /F /IM node.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

echo  [1/3] Arrancando Backend  ^(http://localhost:3001^)...
start "Animalitos BACKEND" /D "%~dp0backend" cmd /k "npm start"
timeout /t 4 /nobreak >nul

echo  [2/3] Arrancando Frontend ^(http://localhost:5173^)...
start "Animalitos FRONTEND" /D "%~dp0frontend" cmd /k "npm run dev"
timeout /t 6 /nobreak >nul

echo  [3/3] Abriendo navegador...
start "" "http://localhost:5173"

echo.
echo  ====================================
echo   Sistema corriendo:
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo  ====================================
echo.
echo  Puedes cerrar esta ventana.
echo  Para apagar: cierra las ventanas BACKEND y FRONTEND.
echo.
pause
