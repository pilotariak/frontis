ARG SUBGRAPH
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
COPY subgraphs/${SUBGRAPH}/package.json ./subgraphs/${SUBGRAPH}/

RUN bun install

# Copy source
COPY subgraphs/${SUBGRAPH}/ ./subgraphs/${SUBGRAPH}/

ENV SUBGRAPH=${SUBGRAPH}

CMD bun run subgraphs/${SUBGRAPH}/index.ts
