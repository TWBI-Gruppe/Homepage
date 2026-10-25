#!/bin/sh
set -e

# Hosting platforms (Railway, NAS bind mounts, …) often mount the data volume
# owned by root. Hand it to the unprivileged app user, then drop root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  if su-exec node test -w "$DATA_DIR"; then
    exec su-exec node "$@"
  fi
  echo "Hinweis: $DATA_DIR ist für den App-Benutzer nicht beschreibbar, die App läuft als root." >&2
fi
exec "$@"
