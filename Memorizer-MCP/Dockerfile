FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Create data directories
RUN mkdir -p /data/memory /data/export

# Set environment variables
ENV MEMORY_DB_PATH=/data/memory/memory.db
ENV MEMORY_EXPORT_PATH=/data/export/

EXPOSE 8005

CMD ["node", "dist/index.js"]
