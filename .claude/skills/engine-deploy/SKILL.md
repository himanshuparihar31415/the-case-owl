---
name: engine-deploy
description: Deploy the interview engine to production (Hostinger VPS, srv2011824.hstgr.cloud) with engine/deploy/deploy.sh, then verify health and logs, with the rollback steps ready. Only when the user explicitly asks to deploy the engine.
disable-model-invocation: true
---

# Deploy the interview engine

Production: `https://srv2011824.hstgr.cloud`. Full background in `engine/README.md` ("Deploy").

!`git status --short --branch`

!`git log --oneline -3`

## 1. Preconditions (all must hold; stop and say which one does not)

- The user asked for this deploy in this conversation.
- The working tree is clean for `engine/` and `HEAD` is pushed: the image is tagged with the commit, so
  an uncommitted change would ship code nobody can find later.
- `cd engine && uv run pytest -q` passes.
- If the contract changed since the last deploy, `contract-keeper` reports no mismatch, and the Node
  side is ready for it (additive changes can go first).
- If prompts, tools, the fact gate or case data changed, evals passed on this commit (or the user
  accepts deploying without them, and you say so).
- Check live interviews: `curl -s https://srv2011824.hstgr.cloud/readyz` shows `live`. Live interviews
  survive a deploy by design (hand-off), but tell the user how many there are and let them choose.

## 2. Deploy

From the repo root, in the background (it builds an amd64 image and copies it over SSH; minutes):

```bash
engine/deploy/deploy.sh
```

The script waits for the container to be healthy and checks `https://…/healthz`. Never run
`push-secrets.sh`; secrets are the user's job.

## 3. Verify

- `curl -s https://srv2011824.hstgr.cloud/healthz` shows `"ok": true` and the new `version` (the commit).
- `curl -s -o /dev/null -w '%{http_code}' -X POST https://srv2011824.hstgr.cloud/v1/calls` is 401
  (the service token is still enforced).
- Logs, with the user's OK for SSH (on the server, in `/opt/case-owl-engine`):
  `docker compose --env-file settings.env logs --since 5m engine`. Look for startup errors, case
  publishing, and any interview that was handed over.

## 4. If it is broken: roll back

On the server, from `/opt/case-owl-engine` (with the user's OK):

```bash
docker images case-owl-engine
docker tag case-owl-engine:<previous commit> case-owl-engine:current && docker compose --env-file settings.env up -d
```

## 5. Record it

Tell the user what was deployed (commit, time) and what was verified. If the deploy verified something
on the "Not verified yet" list in `engine/README.md`, move it, with the date and the evidence.
