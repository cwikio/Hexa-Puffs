# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Get 1Password CLI
FROM 1password/op:2 AS op

# Production stage
FROM node:22-alpine

# Copy 1Password CLI from official image
COPY --from=op /usr/local/bin/op /usr/local/bin/op

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Environment variables
ENV NODE_ENV=production
ENV TRANSPORT=stdio
ENV PORT=3000

# Expose port for HTTP mode
EXPOSE 3000

# Run the MCP server
CMD ["node", "dist/index.js"]
