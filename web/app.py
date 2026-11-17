"""Cydian's web server. Thin: serves the shared frontend in web/app/ (fetch proxy and push come later)."""
from pathlib import Path

from flask import Flask, send_from_directory

APP_DIR = Path(__file__).resolve().parent / "app"

app = Flask(__name__, static_folder=None)


@app.get("/healthz")
def healthz():
    return "ok\n", 200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}


@app.get("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.get("/<path:path>")
def static_file(path):
    # send_from_directory refuses paths that leave APP_DIR and 404s missing files.
    resp = send_from_directory(APP_DIR, path)
    if path.endswith(".js"):
        resp.mimetype = "text/javascript"  # ES modules need a JS MIME type in every browser
    return resp


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=True)
