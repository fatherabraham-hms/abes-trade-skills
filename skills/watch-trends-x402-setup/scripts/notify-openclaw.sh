#!/usr/bin/env bash
# Ergonomic wrapper. All logic lives in notify-openclaw.mjs.
exec node "$(dirname "$0")/notify-openclaw.mjs" "$@"
