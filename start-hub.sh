#!/bin/bash
# ABOUTME: Startup script for Railway hub deployment.
# ABOUTME: Copies hub config into place and starts the server.

cp amadeus.config.hub.yaml amadeus.config.yaml
exec bun run src/server.ts
