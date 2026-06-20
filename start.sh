#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo ""
  echo "  ERROR Node.js is not installed."
  echo ""
  echo "  Please install it from: https://nodejs.org  (choose the LTS version)"
  echo "  After installing, run this script again."
  echo ""
  read -rp "Press Enter to exit..."
  exit 1
fi

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
  echo "  >>  Installing dependencies (first run only)..."
  npm install --silent
fi

echo ""
echo "  >>  Starting BLACKLINE AI..."
echo "  URL Opening http://localhost:3737"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

node server.js
