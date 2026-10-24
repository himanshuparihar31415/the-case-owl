#!/usr/bin/env bash
# Deploy the engine to the Hostinger VPS: build the image here (the one the tests ran against), copy it
# over SSH, and run it with Docker Compose behind Caddy. Live interviews survive: the old container
# hands them to the new one (app/registry.py), and Caddy holds requests during the few-second restart.
#
#   engine/deploy/deploy.sh                      deploy the current commit
#   ENGINE_HOST=root@<ip> engine/deploy/deploy.sh
#
# Needs: Docker on this machine; SSH to the server with a key loaded in your agent (ssh-add);
# /opt/case-owl-engine/.env on the server with the secrets (env.example lists them).
# Roll back on the server:  docker tag case-owl-engine:<older> case-owl-engine:current && docker compose up -d
set -euo pipefail

HOST="${ENGINE_HOST:-root@187.126.115.114}"
DIR=/opt/case-owl-engine
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# A dedicated deploy key; added to the server under hPanel → VPS → SSH keys.
KEY="${ENGINE_SSH_KEY:-$HOME/.ssh/case_owl_engine_deploy}"
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
# shellcheck disable=SC1091
DOMAIN="$(. "$HERE/settings.env" && echo "$DOMAIN")"

TAG="$(git -C "$REPO" rev-parse --short HEAD)"
git -C "$REPO" diff --quiet HEAD -- engine || TAG="$TAG-dirty"

echo "==> building case-owl-engine:$TAG"
docker build --platform linux/amd64 -f "$REPO/engine/Dockerfile" --build-arg ENGINE_VERSION="$TAG" \
  -t "case-owl-engine:$TAG" "$REPO"

echo "==> copying the image to $HOST"
docker save "case-owl-engine:$TAG" | gzip -1 | "${SSH[@]}" 'gunzip | docker load'

echo "==> copying compose.yaml, Caddyfile, settings.env to $DIR"
"${SSH[@]}" "mkdir -p $DIR"
scp -q "${SSH_OPTS[@]}" "$HERE/compose.yaml" "$HERE/Caddyfile" "$HERE/settings.env" "$HOST:$DIR/"

if ! "${SSH[@]}" "test -s $DIR/.env"; then
  echo "!! $DIR/.env is missing on the server. Create it from engine/deploy/env.example, then run this again."
  exit 1
fi

echo "==> starting case-owl-engine:$TAG"
"${SSH[@]}" "cd $DIR && chmod 600 .env && docker tag case-owl-engine:$TAG case-owl-engine:current \
  && docker compose --env-file settings.env up -d --remove-orphans"

echo "==> waiting for the engine to report ready"
for _ in $(seq 1 30); do
  state="$("${SSH[@]}" "docker inspect -f '{{.State.Health.Status}}' case-owl-engine-engine-1 2>/dev/null" || true)"
  [ "$state" = "healthy" ] && break
  sleep 2
done
echo "    container: ${state:-unknown}"
"${SSH[@]}" "cd $DIR && docker compose --env-file settings.env logs --tail 15 engine" | sed 's/token=[^ &"]*/token=[redacted]/g'

if out="$(curl -fsS -m 15 "https://$DOMAIN/healthz")"; then
  echo "==> https://$DOMAIN/healthz: $out"
else
  echo "!! https://$DOMAIN/healthz did not answer: check ports 80/443 and 'docker compose logs caddy'"
fi

# Keep the five newest images; older ones go.
"${SSH[@]}" "docker images case-owl-engine --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r \
  | awk -F'\t' '\$2!=\"current\"' | tail -n +6 | cut -f2 | xargs -r -I{} docker rmi -f case-owl-engine:{} >/dev/null" || true
