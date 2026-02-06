# Guardian MCP Server Dockerfile
# Note: Requires Ollama running on host (not in this container)

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV TRANSPORT=stdio
ENV PORT=3000
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV MODEL_NAME=guardian

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
