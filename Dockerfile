FROM python:3.13-slim
# node runs web/app/core/ on the server (upgrade checks for push, F10, and /api/upgrades, F11)
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY web/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY web/app.py web/fetch.py ./
COPY web/app ./app
USER 568:568
EXPOSE 8080
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"
# gthread so slow upstream repo fetches (F3) don't block page loads
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-k", "gthread", "--threads", "32", "--timeout", "120", "app:app"]
