# iFizBox's server (website, /api/fetch, /sign/*) in Docker: the Worker's code on Node (worker/node.mjs).
# Build from the repo root:  docker build -f worker/Dockerfile -t cydian .  &&  docker run -p 8787:8787 cydian
FROM node:22-alpine
WORKDIR /cydian
COPY worker/ worker/
COPY web/app/ web/app/
# F187: reviews in /data/reviews.db; keep it with a volume: docker run -v cydian-data:/data …
RUN mkdir /data && chown node:node /data
ENV PORT=8787 HOST=0.0.0.0 REVIEWS_DB=/data/reviews.db
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "worker/node.mjs"]
