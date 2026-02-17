# Guardian MCP Server Dockerfile
# Note: Requires Ollama running on host (not in this container)
# Build from monorepo root: docker build -f Guardian/Dockerfile .

FROM node:22-alpine AS builder

WORKDIR /monorepo/Guardian

# Copy base tsconfig
COPY tsconfig.base.json /monorepo/tsconfig.base.json

# Copy package files and install
COPY Guardian/package*.json ./
RUN npm ci

# Copy source and build
COPY Guardian/tsconfig.json ./
COPY Guardian/src ./src
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
COPY --from=builder /monorepo/Guardian/dist ./dist
COPY --from=builder /monorepo/Guardian/node_modules ./node_modules
COPY --from=builder /monorepo/Guardian/package.json ./

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
