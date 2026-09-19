#!/bin/bash
# Dev server launcher: pins the Homebrew Node (>=20) that Next 16 requires.
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
exec npm run dev
