FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN addgroup -S app && adduser -S -G app -h /app app
WORKDIR /app
COPY app.py /app/app.py
RUN chown -R app:app /app
USER app
EXPOSE 8080
ENV PORT=8080
CMD ["python", "/app/app.py"]
