# Orchestrator Dockerfile
# Build from monorepo root: docker build -f Orchestrator/Dockerfile .

FROM node:20-slim
WORKDIR /monorepo/Orchestrator

# Copy base tsconfig and Shared (file: dependency)
COPY tsconfig.base.json /monorepo/tsconfig.base.json
COPY Shared /monorepo/Shared

# Copy package files and install
COPY Orchestrator/package*.json ./
RUN npm install

# Copy source and build
COPY Orchestrator/tsconfig.json ./
COPY Orchestrator/src ./src
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV TRANSPORT=sse
ENV PORT=8010

# Expose port
EXPOSE 8010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8010/health || exit 1

# Run the server
CMD ["node", "dist/index.js"]
