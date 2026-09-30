@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 바뀐 내용을 GitHub에 올립니다...
git add -A
git commit -m "update %date% %time%"
git push
echo.
echo 1~2분 뒤 실험 링크에 반영됩니다. (브라우저에서 Ctrl+F5 로 새로고침)
pause
