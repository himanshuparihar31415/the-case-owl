# Interview engine

The Case Owl's live case interviews on the OpenAI Realtime API, as a service beside the Node
platform. Audio goes browser ⇄ OpenAI over WebRTC; the engine steers each call over OpenAI's
sideband, owns every turn, gates the case facts, and hands Node the transcript at the end.

- Contract with the platform: [docs/engine-contract.md](../docs/engine-contract.md)
- Design and decisions: [docs/interview-engine-architecture.md](../docs/interview-engine-architecture.md)
- The phase 0 spike it grew from (kept as the reference): [spike/](spike/README.md)

Stage 1 of the build: the engine works and is tested on its own, with a stub of Node and a test
page. Nothing in `server/` or `src/` changes until stage 2.

## Run it locally

From `engine/`, in two terminals (the OpenAI key comes from `OPENAI_API_KEY` or the repo's `.env`):

```bash
uv run uvicorn app.main:app --port 8780
```
```bash
uv run python tools/node_stub.py
```

Open http://localhost:5051 in Chrome, with headphones. The page speaks only the contract's messages,
through the stub, the way `Session.tsx` will in stage 2. Settled interviews land in
`results/settled/` (gitignored: transcripts). Add `?silent=1` for a smoke test without a mic.

Without `MONGO_URI` the engine keeps everything in memory, preloaded with `cases/*.json` (the case
id is the file name, so the stub's default `coffee` works).

## Tests

```bash
uv run pytest
```

105 tests (plus 6 Mongo tests, skipped without a database), about 7 s, no network: a real server on a
free port with fake OpenAI and fake Node behind it (`tests/fakes.py`), the interview clock run 1,000
times fast. A test can start a second instance on the same store (`run_engine` in `conftest.py`) to
check a hand-off.

| File | What it covers |
|---|---|
| `test_turns.py` | The turn rules (from the spike): pauses, one reply at a time, coughs by voiced time, listening mode, nudges, scratchpad |
| `test_guard.py` | The live guard and the fact gate's release policy, from case data |
| `test_flow.py` | Whole interviews end to end: greeting, start_case, a fact through the gate, the settle call; unheard replies retracted; the time cap; a dropped call re-offered with its history; settle retries |
| `test_api.py` | Every error code in the contract, and the UI socket's token gate |
| `test_recovery.py` | Deploys and crashes: a shutdown hands a live interview to the next instance, which reattaches to the same call and carries on; a page or Node arriving mid-hand-off retries rather than hears "ended"; interviews that were ending, or still owed a settle, are finished by the next instance; a crashed owner's interviews are taken over, never one still owned; checked-in cases are published once |
| `test_config.py` | Production refuses development secrets; `NODE_URL` left out means no settling |
| `test_contract.py` | The camelCase wire format, the ledger, the checked-in JSON Schemas, tokens kept out of logs |
| `test_mongo.py` | `MongoStore` on a real Mongo: latest published case, case publishing, sessions with dates, what is claimable, one winner per claim. Skipped unless `ENGINE_TEST_MONGO_URI` is set, on a throwaway database |

Mongo, locally (never the platform's database):

```bash
docker run -d -p 27017:27017 --name engine-mongo mongo:7
```
```bash
ENGINE_TEST_MONGO_URI=mongodb://localhost:27017 uv run pytest tests/test_mongo.py
```

## Behaviour evals and model choice

The tests above check the engine's logic. These check the interviewer's behaviour against the real
models, on the service's own prompts and fact gate (they cost money; run them after any prompt, tool
or case change):

```bash
uv run python tools/evals.py --runs 5
```
```bash
uv run python tools/bench.py --models gpt-5.6-luna,gpt-5.4-nano
```

`evals.py` runs 16 scenarios several times each and passes a scenario only if every run does: the
greeting, small talk, moving to the case, repeat requests, asking for time, facts at the right level
of detail, fishing, facts not in the case, asking for help, off-topic talk, resuming after an
interruption. `bench.py` scores the small text models on the fact matcher's and analyzer's tasks.

Results on 23 Oct (transcripts in `results/`, gitignored):

| What | Result |
|---|---|
| `gpt-realtime-2.1`, low reasoning, matcher `gpt-5.6-luna` | 16 of 16 scenarios pass every run (5 runs each; the wait acknowledgement's limit set to 20 words, see below). First audio about 0.8–1.3 s from India |
| Same, matcher `gpt-5.4-nano` | 11 of 16: all five fact failures were the matcher picking the parent or an already-told fact |
| `gpt-realtime-2.1-mini` (a third of the audio price) | 8 of 16: preambles back ("Let me check what I can share…"), hints ("costs, operations…?"), restarting the case after an interruption. Not good enough yet |
| Fact matcher, 15 questions × 3 | `gpt-5.6-luna` 45/45, `gpt-6-luna` 43/45, `gpt-5.4-nano` 41/45, `gpt-4o-mini` 39/45 |
| Listening analyzer, 10 utterances × 3 | `gpt-5.4-nano`, `gpt-6-luna`, `gpt-5.6-luna` 30/30; `gpt-4o-mini` 29/30 |

So the defaults are now `FACT_MODEL=gpt-5.6-luna` and `ANALYZER_MODEL=gpt-5.4-nano`. The matcher is
also told which facts were already given, so "why?" after a fact goes one level deeper. The wait
acknowledgement adds a second short sentence about 1 run in 10 ("Sure, take your time. I'll be here
when you're ready."). That is natural, so the eval allows up to 20 words rather than the
instruction being tightened.

## Deploy (Hostinger VPS)

The engine runs on a Hostinger KVM 2 in Mumbai (2 vCPU, 8 GB, Ubuntu 26.04) at
**https://srv2011824.hstgr.cloud**, with Docker Compose: the engine, and Caddy in front of it for
HTTPS (Let's Encrypt, renewed by Caddy). Files on the server live in `/opt/case-owl-engine`.
Deployed and verified on 24 Oct (below).

Mumbai is fine for latency: the engine adds one engine ⇄ OpenAI round trip to each turn, the same
as everything measured so far from India; a US server would save about 0.2 s per reply.

```bash
engine/deploy/deploy.sh
```

builds the image here (the one the tests ran against), copies it over SSH, and restarts the engine.
Live interviews survive a deploy: the old container releases them without hanging up, the new one
reattaches to the same OpenAI calls at startup, and Caddy holds requests during the few-second
restart (`lb_try_duration`) instead of answering 502. The candidate hears at most that pause.

| File (`engine/deploy/`) | What it is |
|---|---|
| `deploy.sh` | Build, copy, `docker compose up`, wait for ready, check `https://…/healthz`, keep the five newest images |
| `push-secrets.sh` | Writes the server's `.env` from the repo's `.env` (OpenAI key, Mongo URI) plus two generated engine tokens; prints nothing. Run once, or to rotate the Mongo URI or OpenAI key (the tokens are kept) |
| `compose.yaml`, `Caddyfile` | The engine (port 8080 inside, health check on `/readyz`, 15 s stop grace) and Caddy (80/443) |
| `settings.env` | Non-secret settings: the domain and `ALLOWED_ORIGINS` |
| `env.example` | The secrets the server's `.env` holds |

Access: SSH as root with `~/.ssh/case_owl_engine_deploy` (a deploy key made for this; remove it under
hPanel → VPS → SSH keys to revoke). Hostinger's Docker Manager does not support Ubuntu 26.04, so
deploys go over SSH; the Hostinger MCP is useful for the VM's state, snapshots and metrics.

On the server, from `/opt/case-owl-engine`:

```bash
docker compose --env-file settings.env logs -f engine
```
```bash
docker tag case-owl-engine:<older tag> case-owl-engine:current && docker compose --env-file settings.env up -d
```

(the second one rolls back; `docker images case-owl-engine` lists the tags, which are git commits).

Secrets stay out of the repo and the image: the server's `.env` is `chmod 600`, and the service token
is also in `engine/.env` on the laptop (gitignored) so the local Node stub can call the server:

```bash
ENGINE_URL=https://srv2011824.hstgr.cloud uv run python tools/node_stub.py
```

then http://localhost:5051. Until stage 2 `NODE_URL` is unset: interviews are kept in
`engine_sessions` (`settle.status: "skipped"`), not settled with the platform.

Caddy keeps no access log, so the page's UI token, which travels in the socket URL, is logged nowhere.

### Which case runs

For the first pilot, every engine interview runs one prepared case, `cases/coffee.json`, whatever
the user picks (decided 24 Oct). Checked-in cases are published into `engine_cases` at startup: a
changed file becomes a new version, and a version made any other way (phase 2) is never overwritten.
In stage 2, Node starts pilot sessions on a platform `Case` that mirrors this one, so the report
grades the case that was actually run.

### Stage 2, on the platform side

The Node service on Railway redeploys on every commit, including engine commits, and a Node
deploy drops the current pipeline's live voice sockets. Its `railway.toml` needs watch patterns
that skip `/engine/**`. Node then gets `ENGINE_URL=https://srv2011824.hstgr.cloud` and the service
token, the engine gets `NODE_URL`, `NODE_INTERNAL_TOKEN` and the app's domains in `ALLOWED_ORIGINS`.

After changing `app/contract.py`, regenerate the schemas Node's tests read:
`uv run python tools/export_schemas.py`.

## Layout

| Path | What it is |
|---|---|
| `app/main.py` | The FastAPI app: lifespan (clients, store, registry), error format, routes |
| `app/api.py`, `app/ui.py` | The service API Node calls, and the page's UI socket |
| `app/contract.py` | The contract as validated models; exports `contract/*.json` |
| `app/registry.py` | Live interviews: capacity, ownership leases, takeover, hand-off on shutdown |
| `app/runtime/interview.py` | One interview: sideband, turn rules, tools, guard, ledger, clock, end and settle |
| `app/runtime/turns.py`, `facts.py`, `guard.py`, `prompts.py` | Carried over from the spike with its evals and tests |
| `app/runtime/ledger.py` | The transcript of what the candidate heard |
| `app/realtime.py`, `app/settle.py`, `app/store.py` | OpenAI, the settle callback, the engine's own database |
| `cases/` | Case data (fact trees). Phase 2 generates these into `engine_cases` |
| `tools/node_stub.py`, `web/test.html` | Node's part of the contract, and a page that speaks it |
| `tools/evals.py`, `tools/bench.py` | Behaviour evals and small-model benchmark against the real models |
| `Dockerfile`, `Dockerfile.dockerignore` | The image, built from the repo root |
| `deploy/` | The Hostinger deployment: compose, Caddy, deploy and secrets scripts |

## Configuration

Environment variables (`app/config.py`). Production (`ENVIRONMENT=prod`) refuses to start without
real secrets, a Mongo URI and allowed origins.

| Variable | Default | |
|---|---|---|
| `OPENAI_API_KEY` | — | Engine only; never reaches a response |
| `ENGINE_SERVICE_TOKEN`, `NODE_INTERNAL_TOKEN`, `ENGINE_UI_SECRET` | development values | Node → engine, engine → Node, UI-token signing (32+ bytes) |
| `MONGO_URI`, `MONGO_DB` | in memory, `engine` | The engine's own database |
| `NODE_URL` | the stub (`http://localhost:5051`) in development, none in production | Where the settle callback goes; none or empty: no settling (stage 1 deploy) |
| `PUBLIC_WS_URL` | `ws://localhost:8780` | Base of the UI-socket URL given to the page |
| `ALLOWED_ORIGINS` | any (development) | The app's domains |
| `REALTIME_MODEL`, `REASONING`, `VOICE` | `gpt-realtime-2.1`, `low`, `marin` | From the spike's measurements |
| `SILENCE_MS`, `CASE_SILENCE_MS` | 1000, 1300 | Turn end before and during the case |
| `FACT_MODEL`, `ANALYZER_MODEL` | `gpt-5.6-luna`, `gpt-5.4-nano` | The fact matcher and listening-mode analyzer (chosen with `tools/bench.py`) |
| `MAX_CALLS` | 50 | Per instance |
| `SHUTDOWN_WAIT_S` | 5 | On shutdown, how long interviews already ending get before the hand-off |
| `ENGINE_VERSION` | `dev` | Shown by `/healthz`; a build argument of the image |

## Verified, and not yet

Verified on 23 Oct:
- The whole suite, and the Mongo tests on a real MongoDB 7.
- A live call through the stub: the real SDP exchange, the greeting with the candidate's name,
  ending (OpenAI hangup 200), and the settle callback with the heard transcript and its cost.
- A deploy mid-interview, live on MongoDB: the engine restarted twice during one call. Each new
  process took the interview over at startup and reattached to the same OpenAI call, and the page
  reconnected with its transcript. The third process spoke on the original call ("Take your time.
  Are you still with me?"), then ended it and settled it with both lines (184 s).
- The production image (Python 3.12, built from the repo root) in production mode: startup checks,
  case publishing, `/healthz`, `/readyz`, no API docs, the service token, and a `docker stop` in 0.4 s.
- The deployment on the Hostinger VPS (24 Oct): HTTPS certificate issued, `/healthz` over HTTPS, 401
  without the service token, and a real call through the local Node stub. OpenAI accepted the call,
  the page's socket connected through Caddy over `wss://`, her greeting and the 25 s check-in arrived,
  ending hung up (200), and the session landed in Atlas (`engine` database) with its transcript and
  cost ($0.017).

Not verified yet:
- A full voice interview on the deployed service, and re-offer after a real WebRTC drop.
- A deploy during a live interview on the server (the hand-off was verified locally on 23 Oct).
- A candidate who finishes speaking during a restart's pause. OpenAI's turn detection should still
  add that turn to the call, so the model has it, but the engine does not see it: she answers only
  when they speak again or at the 25 s check-in, and the turn is missing from the settled transcript.

Run one replica until page sockets can reach any instance.

Next: a voice interview on the deployed engine, then stage 2 (platform integration) or phase 2 (case generation).
