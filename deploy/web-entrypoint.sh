#!/bin/sh
export HOST="${WEB_HOST:-0.0.0.0}"
export PORT="${WEB_PORT:-3000}"
exec node build/index.js
