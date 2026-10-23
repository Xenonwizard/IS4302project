#!/bin/bash
# Launches both the local blockchain and the Next.js frontend together.
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
exec npm run dev:all "$@"

