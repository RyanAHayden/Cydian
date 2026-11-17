# zsign (https://github.com/zhlynn/zsign, MIT: fits Cydian's GPL-3.0-or-later) signs IPAs for POST /sign (I5,
# web/signer/, docs/signing.md). Built from a pinned commit (tag v1.1.3), its tarball checked by hash.
FROM python:3.13-slim AS zsign
ARG ZSIGN_COMMIT=9299685bab7ef99827e06e5dfda93af747386590
ARG ZSIGN_SHA256=97bcc2dbbc0dc5f092dc4a33cbe1f9fdbd5c83bdc291da23db45044d4396270e
RUN apt-get update && apt-get install -y --no-install-recommends g++ make pkg-config libssl-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o zsign.tgz "https://github.com/zhlynn/zsign/archive/${ZSIGN_COMMIT}.tar.gz" \
    && echo "${ZSIGN_SHA256}  zsign.tgz" | sha256sum -c - \
    && tar xzf zsign.tgz && cd "zsign-${ZSIGN_COMMIT}/build/linux" && make -j"$(nproc)" \
    && install -m 755 ../../bin/zsign /usr/local/bin/zsign \
    && install -D -m 644 ../../LICENSE /usr/local/share/licenses/zsign/LICENSE

FROM python:3.13-slim
# node runs web/app/core/ on the server (upgrade checks for push, F10, and /api/upgrades, F11)
# libstdc++6: zsign is C++ (it links the image's own libssl3).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=zsign /usr/local/bin/zsign /usr/local/bin/zsign
COPY --from=zsign /usr/local/share/licenses/zsign /usr/local/share/licenses/zsign
WORKDIR /app
COPY web/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY web/app.py web/fetch.py web/push.py web/push.mjs ./
COPY web/app ./app
COPY web/signer ./signer
# Push subscribers and the VAPID key (F10) live here; compose mounts a volume, which takes this owner.
RUN mkdir /data && chown 568:568 /data
ENV CYDIAN_DATA=/data
USER 568:568
EXPOSE 8080
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"
# gthread so slow upstream repo fetches (F3) don't block page loads. One worker (gunicorn's default): the signer keeps
# its 10-minute tokens in this process's memory (web/signer/__init__.py).
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-k", "gthread", "--threads", "32", "--timeout", "120", "app:app"]
