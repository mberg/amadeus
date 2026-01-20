#!/bin/bash
# ABOUTME: Entry script for running Amadeus inside a Sprite VM.
# ABOUTME: Starts the Amadeus server on port 8080 (Sprite's default routed port).

set -e

cd /home/sprite/amadeus

# Load environment variables if .env exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Sprites route public URLs to port 8080 by default
export PORT=8080

# Start Amadeus server
echo "[Sprite] Starting Amadeus server on port $PORT..."
bun run src/server.ts
