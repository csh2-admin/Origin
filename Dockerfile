FROM python:3.13-slim AS backend
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM node:20-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY --from=backend /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=backend /usr/local/bin /usr/local/bin
COPY backend/ backend/
COPY --from=frontend /build/dist frontend/dist/
COPY backend/.env.example backend/.env

EXPOSE 8000
CMD ["python", "-m", "flask", "--app", "backend.app.main:app", "run", "--host", "0.0.0.0", "--port", "8000"]
