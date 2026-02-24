@echo off
cd /d "%~dp0"
start "FRC Engineer - Backend" cmd /c start-backend.bat
start "FRC Engineer - Frontend" cmd /c start-frontend.bat

powershell -NoProfile -Command "$url='http://localhost:3000'; for($i=0; $i -lt 60; $i++){ try { $r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -ge 200){ Start-Process $url; break } } catch {}; Start-Sleep -Seconds 1 }"
