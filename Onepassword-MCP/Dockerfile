# 1Password MCP Server Dockerfile
# Build from monorepo root: docker build -f Onepassword-MCP/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /monorepo/Onepassword-MCP

# Copy base tsconfig and Shared (file: dependency)
COPY tsconfig.base.json /monorepo/tsconfig.base.json
COPY Shared /monorepo/Shared

# Copy package files and install
COPY Onepassword-MCP/package.json Onepassword-MCP/package-lock.json* ./
RUN npm install

# Copy source and build
COPY Onepassword-MCP/tsconfig.json ./
COPY Onepassword-MCP/src ./src
RUN npm run build

# Get 1Password CLI
FROM 1password/op:2 AS op

# Production stage
FROM node:22-alpine

# Copy 1Password CLI from official image
COPY --from=op /usr/local/bin/op /usr/local/bin/op

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /monorepo/Onepassword-MCP/dist ./dist
COPY --from=builder /monorepo/Onepassword-MCP/node_modules ./node_modules
COPY Onepassword-MCP/package.json ./

# Environment variables
ENV NODE_ENV=production
ENV TRANSPORT=stdio
ENV PORT=3000

# Expose port for HTTP mode
EXPOSE 3000

# Run the MCP server
CMD ["node", "dist/index.js"]
