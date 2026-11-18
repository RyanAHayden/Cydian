# iFizBox's server (website, /api/fetch, /sign/*) in Docker: the Worker's code on Node (worker/node.mjs).
# Build from the repo root:  docker build -f worker/Dockerfile -t ifizbox .  &&  docker run -p 8787:8787 ifizbox
FROM node:22-alpine
WORKDIR /ifizbox
COPY worker/ worker/
COPY web/app/ web/app/
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
USER node
CMD ["node", "worker/node.mjs"]
