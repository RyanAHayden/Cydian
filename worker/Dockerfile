# Cydian's server (website, /api/fetch, /sign/*) in Docker: the Worker's code on Node (worker/node.mjs).
# Build from the repo root:  docker build -f worker/Dockerfile -t cydian .  &&  docker run -p 8787:8787 cydian
FROM node:22-alpine
WORKDIR /cydian
COPY worker/ worker/
COPY web/app/ web/app/
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
USER node
CMD ["node", "worker/node.mjs"]
