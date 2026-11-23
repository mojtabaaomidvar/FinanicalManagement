FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY ai_gateway/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt && useradd -m -u 10001 gateway
COPY app/__init__.py ./app/__init__.py
COPY app/core/__init__.py app/core/errors.py app/core/logging.py ./app/core/
COPY app/services/__init__.py app/services/sms_ai_protocol.py app/services/sms_ai_provider.py ./app/services/
COPY ai_gateway/__init__.py ai_gateway/app.py ai_gateway/check.py ./ai_gateway/
USER gateway
EXPOSE 8000
CMD ["uvicorn", "ai_gateway.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
