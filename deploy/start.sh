#!/usr/bin/env bash
# Feature Forge — production start script for Mac Mini
# Installs deps, builds the frontend, and starts the server.
# The server serves both the React app and the orchestration API.
#
# Usage: bash deploy/start.sh
#
# Env vars are loaded from .env by server.js (via dotenv).
# Make sure .env exists with at least:
#   ANTHROPIC_API_KEY, LINEAR_API_KEY, GITNEXUS_LOCAL_PATH

set -e
cd "$(dirname "$0")/.."

echo "[feature-forge] Installing dependencies..."
npm install --production=false

echo "[feature-forge] Building frontend (standalone)..."
npm run build:standalone

echo "[feature-forge] Starting server on port ${PORT:-3000}..."
echo "[feature-forge] Source of Truth: GITNEXUS_LOCAL_PATH=${GITNEXUS_LOCAL_PATH:-'(not set — will use fallback services)'}"
exec node server.js
