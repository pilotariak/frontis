FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
COPY subgraphs/package.json ./subgraphs/
COPY subgraphs/${SUBGRAPH}/package.json ./subgraphs/${SUBGRAPH}/

RUN bun install --frozen-lockfile

# Copy source
COPY subgraphs/${SUBGRAPH}/ ./subgraphs/${SUBGRAPH}/

ARG SUBGRAPH
ENV SUBGRAPH=${SUBGRAPH}

CMD bun run subgraphs/${SUBGRAPH}/index.ts
