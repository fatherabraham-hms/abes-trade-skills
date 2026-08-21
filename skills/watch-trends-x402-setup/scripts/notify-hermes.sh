#!/usr/bin/env bash
# Ergonomic wrapper. All logic lives in notify-hermes.mjs.
exec node "$(dirname "$0")/notify-hermes.mjs" "$@"
