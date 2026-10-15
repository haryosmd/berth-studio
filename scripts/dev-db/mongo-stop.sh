#!/bin/sh
# Stops the throwaway MongoDB from mongo-start.sh and deletes its folder.
set -eu
DIR="${BERTH_DEV_MONGO_DIR:-${TMPDIR:-/tmp}/berth-dev-mongo}"
case "$(basename "$DIR")" in berth-dev-mongo*) ;; *) echo "refusing to delete $DIR"; exit 1 ;; esac
if [ -s "$DIR/mongod.pid" ]; then
  PID="$(cat "$DIR/mongod.pid")"
  kill "$PID" 2>/dev/null || true
  while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
fi
rm -rf "$DIR"
echo "dev MongoDB stopped and removed"
