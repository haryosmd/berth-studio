#!/bin/sh
# Starts a throwaway MongoDB single-node replica set for development and tests. It lives in a temp
# folder, listens only on 127.0.0.1:54330, requires authentication, and never touches a MongoDB you
# already run. Needs mongod and mongosh (brew install mongodb/brew/mongodb-community@8.0).
#   scripts/dev-db/mongo-start.sh      then   scripts/dev-db/mongo-stop.sh
set -eu
DIR="${BERTH_DEV_MONGO_DIR:-${TMPDIR:-/tmp}/berth-dev-mongo}"
PORT="${BERTH_DEV_MONGO_PORT:-54330}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MONGOD="${MONGOD:-$(command -v mongod || true)}"
MONGOSH="${MONGOSH:-$(command -v mongosh || true)}"
if [ -z "$MONGOD" ] || [ -z "$MONGOSH" ]; then
  echo "mongod and mongosh are needed: brew install mongodb/brew/mongodb-community@8.0" >&2
  exit 1
fi

if [ -s "$DIR/mongod.pid" ] && kill -0 "$(cat "$DIR/mongod.pid")" 2>/dev/null; then echo "already running in $DIR"; exit 0; fi
rm -rf "$DIR"
mkdir -p "$DIR/data"
# A replica set with authentication needs a key file for members to trust each other.
head -c 756 /dev/urandom | base64 | tr -d '\n' > "$DIR/keyfile"
chmod 600 "$DIR/keyfile"
"$MONGOD" --replSet rs0 --keyFile "$DIR/keyfile" --bind_ip 127.0.0.1 --port "$PORT" \
  --dbpath "$DIR/data" --logpath "$DIR/mongod.log" --pidfilepath "$DIR/mongod.pid" --fork >/dev/null
# Until the first user exists, the localhost exception allows initiating the set and creating users.
"$MONGOSH" --quiet "mongodb://127.0.0.1:$PORT/admin?directConnection=true" --file "$HERE/mongo-seed.js" >/dev/null
echo "dev MongoDB ready on 127.0.0.1:$PORT (replica set rs0, data in $DIR)"
