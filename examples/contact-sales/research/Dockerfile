FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git jq python3 python-is-python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts @earendil-works/pi-coding-agent@0.85.0
COPY prompt.md parallel-search.mjs /opt/research/
WORKDIR /work
