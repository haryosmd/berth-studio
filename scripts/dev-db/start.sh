#!/bin/sh
# Starts a throwaway PostgreSQL for development and tests. It lives in a temp folder, listens only
# on 127.0.0.1:54329 and never touches a Postgres you already run.
#   scripts/dev-db/start.sh      then   scripts/dev-db/stop.sh
set -eu
# Postgres on macOS refuses to start without a valid locale in the environment.
export LC_ALL=C
DIR="${BERTH_DEV_DB_DIR:-${TMPDIR:-/tmp}/berth-dev-db}"
PORT="${BERTH_DEV_DB_PORT:-54329}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl)")}"

if [ -f "$DIR/postmaster.pid" ]; then echo "already running in $DIR"; exit 0; fi
rm -rf "$DIR"
"$PG_BIN/initdb" -D "$DIR" -U postgres --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR" -l "$DIR/server.log" -w \
  -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" start >/dev/null
"$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$HERE/seed.sql" >/dev/null
echo "dev database ready on 127.0.0.1:$PORT (data in $DIR)"
