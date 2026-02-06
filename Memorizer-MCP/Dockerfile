# Memorizer MCP Server Dockerfile
# Build from monorepo root: docker build -f Memorizer-MCP/Dockerfile .

FROM node:20-slim
WORKDIR /monorepo/Memorizer-MCP

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy base tsconfig and Shared (file: dependency)
COPY tsconfig.base.json /monorepo/tsconfig.base.json
COPY Shared /monorepo/Shared

# Copy package files and install
COPY Memorizer-MCP/package*.json ./
RUN npm ci

# Copy source and build
COPY Memorizer-MCP/tsconfig.json ./
COPY Memorizer-MCP/src ./src
RUN npm run build

# Create data directories
RUN mkdir -p /data/memory /data/export

# Set environment variables
ENV MEMORY_DB_PATH=/data/memory/memory.db
ENV MEMORY_EXPORT_PATH=/data/export/

EXPOSE 8005

CMD ["node", "dist/index.js"]
