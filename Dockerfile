# Multi-stage Dockerfile for AusLaw MCP
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build the application
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

# Install Tesseract OCR and its dependencies
RUN apk update && \
    apk add --no-cache tesseract-ocr tesseract-ocr-data-eng || \
    apk add --no-cache tesseract-ocr

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose the MCP server (runs via stdio, no port needed but adding for documentation)
# MCP servers communicate via stdin/stdout, not network ports

# Set environment variables with defaults
ENV NODE_ENV=production \
    AUSTLII_SEARCH_BASE=https://www.austlii.edu.au/cgi-bin/sinosrch.cgi \
    AUSTLII_REFERER=https://www.austlii.edu.au/forms/search1.html \
    AUSTLII_TIMEOUT=60000

# Start the MCP server
CMD ["node", "dist/index.js"]
