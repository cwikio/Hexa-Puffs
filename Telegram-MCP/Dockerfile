# Telegram MCP Server Dockerfile
# Build from monorepo root: docker build -f Telegram-MCP/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /monorepo/Telegram-MCP

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy base tsconfig
COPY tsconfig.base.json /monorepo/tsconfig.base.json

# Copy package files and install
COPY Telegram-MCP/package*.json ./
RUN npm ci

# Copy source and build
COPY Telegram-MCP/tsconfig.json ./
COPY Telegram-MCP/src ./src
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app

# Copy built files and production dependencies
COPY --from=builder /monorepo/Telegram-MCP/dist ./dist
COPY --from=builder /monorepo/Telegram-MCP/node_modules ./node_modules
COPY Telegram-MCP/package*.json ./

# Set environment
ENV NODE_ENV=production
ENV TRANSPORT=stdio

# Expose port for HTTP mode
EXPOSE 3000

# Run the server
CMD ["node", "dist/src/index.js"]
