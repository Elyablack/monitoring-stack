FROM python:3.14-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd -r -u 10002 appuser

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY --chown=appuser:appuser app /app/app

USER appuser

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081"]
