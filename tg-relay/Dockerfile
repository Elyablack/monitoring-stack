FROM python:3.14-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN addgroup -S app && adduser -S -G app -h /app app
WORKDIR /app

COPY app /app/app
RUN chown -R app:app /app

USER app
EXPOSE 8080
ENV PORT=8080

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

CMD ["python", "-m", "app.main"]
