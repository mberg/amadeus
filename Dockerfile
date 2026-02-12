# ABOUTME: Docker build for amadeus-cloud on Railway.
# ABOUTME: Installs both root (amadeus) and cloud deps, builds CSS, runs cloud server.

FROM oven/bun:1 AS base
WORKDIR /app

# Install root package deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install cloud package deps (file:.. resolves to /app)
COPY cloud/package.json cloud/bun.lock* cloud/
RUN cd cloud && bun install

# Copy source
COPY . .

# Build CSS for both packages
RUN bunx tailwindcss -i src/dashboard/styles.css -o src/dashboard/index.css --minify
RUN cd cloud && bunx tailwindcss -i src/dashboard/styles.css -o src/dashboard/index.css --minify

WORKDIR /app/cloud
CMD ["bun", "run", "src/server.ts"]
