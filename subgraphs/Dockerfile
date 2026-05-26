ARG SUBGRAPH
FROM oven/bun:1@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
COPY subgraphs/${SUBGRAPH}/package.json ./subgraphs/${SUBGRAPH}/

RUN bun install

# Copy source
COPY subgraphs/${SUBGRAPH}/ ./subgraphs/${SUBGRAPH}/

ENV SUBGRAPH=${SUBGRAPH}

CMD bun run subgraphs/${SUBGRAPH}/index.ts
