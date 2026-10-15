#!/bin/sh
# Stops the throwaway database from start.sh and deletes its folder.
set -eu
DIR="${BERTH_DEV_DB_DIR:-${TMPDIR:-/tmp}/berth-dev-db}"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl)")}"
case "$(basename "$DIR")" in berth-dev-db*) ;; *) echo "refusing to delete $DIR"; exit 1 ;; esac
[ -f "$DIR/postmaster.pid" ] && "$PG_BIN/pg_ctl" -D "$DIR" -m fast -w stop >/dev/null
rm -rf "$DIR"
echo "dev database stopped and removed"
