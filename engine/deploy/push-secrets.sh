#!/usr/bin/env bash
# Write the engine's secrets to /opt/case-owl-engine/.env on the server, without printing them.
#   engine/deploy/push-secrets.sh
#
# - OPENAI_API_KEY and the Mongo URI come from the repo's .env (MONGODB_URI, as the platform names it).
# - ENGINE_SERVICE_TOKEN and ENGINE_UI_SECRET are generated once and kept on later runs, so Node and
#   open pages are not cut off. The service token is also written to engine/.env here (gitignored),
#   so the local Node stub can call the deployed engine.
set -euo pipefail

HOST="${ENGINE_HOST:-root@187.126.115.114}"
DIR=/opt/case-owl-engine
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# A dedicated deploy key; added to the server under hPanel → VPS → SSH keys.
KEY="${ENGINE_SSH_KEY:-$HOME/.ssh/case_owl_engine_deploy}"
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")

read_env() {  # read_env FILE NAME: the value of NAME in a dotenv file, quotes removed
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
token() { python3 -c "import secrets; print(secrets.token_urlsafe(32))"; }

openai="$(read_env "$REPO/.env" OPENAI_API_KEY)"
mongo="$(read_env "$REPO/.env" MONGO_URI)"; mongo="${mongo:-$(read_env "$REPO/.env" MONGODB_URI)}"
[ -n "$openai" ] || { echo "OPENAI_API_KEY is not in $REPO/.env"; exit 1; }
[ -n "$mongo" ] || { echo "MONGODB_URI is not in $REPO/.env"; exit 1; }

"${SSH[@]}" "mkdir -p $DIR && touch $DIR/.env && chmod 600 $DIR/.env"
current="$("${SSH[@]}" "cat $DIR/.env")"
keep() { printf '%s\n' "$current" | sed -n "s/^$1=//p" | tail -1; }
service="$(keep ENGINE_SERVICE_TOKEN)"; service="${service:-$(token)}"
ui="$(keep ENGINE_UI_SECRET)"; ui="${ui:-$(token)}"

printf 'OPENAI_API_KEY=%s\nENGINE_SERVICE_TOKEN=%s\nENGINE_UI_SECRET=%s\nMONGO_URI=%s\n' \
  "$openai" "$service" "$ui" "$mongo" | "${SSH[@]}" "umask 077 && cat > $DIR/.env"

local_env="$REPO/engine/.env"
touch "$local_env" && chmod 600 "$local_env"
grep -v '^ENGINE_SERVICE_TOKEN=' "$local_env" > "$local_env.tmp" || true
printf 'ENGINE_SERVICE_TOKEN=%s\n' "$service" >> "$local_env.tmp" && mv "$local_env.tmp" "$local_env"

echo "Secrets written to $HOST:$DIR/.env (4 values) and the service token to engine/.env. Nothing printed."
