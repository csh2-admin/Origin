@echo off
echo ==============================
echo  Origin - Starting up...
echo ==============================

:: Check for .env
if not exist "backend\.env" (
    echo ERROR: backend\.env not found.
    echo Copy backend\.env.example to backend\.env and fill in the values.
    pause
    exit /b 1
)

:: Install backend dependencies
echo Installing backend dependencies...
cd backend
pip install -r requirements.txt -q
cd ..

:: Build frontend
echo Building frontend...
cd frontend
call npm install --silent
call npm run build
cd ..

:: Start Flask serving everything on port 8000
echo.
echo ==============================
echo  Origin is running at:
echo  http://localhost:8000
echo ==============================
echo.
cd backend
set FLASK_APP=app.main
python -m flask run --host 0.0.0.0 --port 8000
