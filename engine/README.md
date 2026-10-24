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

## Deploy (Hostinger VPS, with Openship)

The engine runs on a Hostinger KVM 2 in Mumbai (2 vCPU, 8 GB, Ubuntu 26.04), added to the Openship
desktop app as "Dev-Server". Openship builds the image on the server from the GitHub repo, runs it
behind its OpenResty proxy and issues the TLS certificate. `openship.json` (here, beside the
Dockerfile) tells it the rest: a Dockerfile build, port 8080, and a readiness check on `/readyz`.

Mumbai is fine for latency. The engine adds one engine ⇄ OpenAI round trip to each turn, the same
as everything measured so far from India; a US server would save about 0.2 s per reply.

### Once

1. **Openship 0.9.3 or later** on the laptop. 0.8.1 made a deploy stop the old container
   gracefully and run readiness checks on SSH servers. On 0.8.0 the old container may be killed
   outright: interviews still recover, after the 30 s lease rather than at once.
2. **Docker on the server**: Openship → Dev-Server → Components (its build needs Docker and Buildx).
3. **Git access**: Dev-Server → Git auth, read access to the repository.
4. **MongoDB Atlas**: the platform's cluster, the engine's own `engine` database. In Network Access,
   allow `187.126.115.114` unless the cluster already accepts any address. Better than reusing the
   platform's user: a user with `readWrite` on `engine` only.
5. **A project** from the GitHub repo: the branch to deploy, root directory `engine`, server
   Dev-Server. Check that it shows Docker, port 8080, readiness on `/readyz` (from `openship.json`;
   Openship copies readiness into the project when it is created, so change it there afterwards).
6. **Environment**, in the project's settings (mark secrets as secret; Openship sets `PORT`):

   | Variable | Value |
   |---|---|
   | `ENVIRONMENT` | `prod` (refuses to start with development secrets) |
   | `OPENAI_API_KEY` | secret |
   | `ENGINE_SERVICE_TOKEN` | secret, generated (Node and the stub send it) |
   | `ENGINE_UI_SECRET` | secret, generated, 32+ bytes (signs the page's tokens) |
   | `MONGO_URI` | secret: the Atlas connection string |
   | `MONGO_DB` | `engine` |
   | `NODE_URL` | leave out until stage 2: interviews are kept in `engine_sessions`, not settled |
   | `NODE_INTERNAL_TOKEN` | stage 2, with `NODE_URL` |
   | `PUBLIC_WS_URL` | `wss://` + the domain below |
   | `ALLOWED_ORIGINS` | `http://localhost:5051` for the test page; the app's domains in stage 2 |

   Generate each secret with:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
7. **Domain**: `srv2011824.hstgr.cloud`, Hostinger's name for the server, already points at it.
   A subdomain of the app's domain works too (an A record to `187.126.115.114`). Openship issues
   the certificate; ports 80 and 443 must be open.
8. Optional: project → Routing → proxy read timeout `1h`. Not needed: uvicorn pings the page's
   socket every 20 s, inside nginx's 60 s default.

### Which case runs

For the first pilot, every engine interview runs one prepared case, `cases/coffee.json`, whatever
the user picks (decided 24 Oct). Generating cases in the engine's format comes later (phase 2). In
stage 2, Node starts pilot sessions on a platform `Case` that mirrors this one, so the report grades
the case that was actually run.

### Each deploy

Push, then Deploy in Openship. `autoDeployPaths` limits automatic deploys to engine code (`app/`,
`cases/`, the lockfile, the Dockerfile). Openship builds from the repo root with
`-f engine/Dockerfile` (hence the repo-root paths in the Dockerfile and
`Dockerfile.dockerignore`), stops the old container, starts the new one, waits for `/readyz`, then
routes to it.

Live interviews survive a deploy. On SIGTERM the engine releases them without hanging up (0.4 s,
measured on this image), and the new container claims them at startup and reattaches to the same
OpenAI calls. The candidate hears a pause the length of the restart, a few seconds; the page
reconnects by itself. Openship's default routing stops the old container before starting the new
one; its "Container IP" routing would overlap them and shorten that pause.

Checked-in cases (`cases/*.json`) are published into `engine_cases` at startup: a changed file
becomes a new version, and a version made any other way (phase 2) is never overwritten.

Check a deploy, then try it from the laptop through the stub:

```bash
curl https://srv2011824.hstgr.cloud/healthz
```
```bash
ENGINE_URL=https://srv2011824.hstgr.cloud ENGINE_SERVICE_TOKEN=<the token> uv run python tools/node_stub.py
```

Then open http://localhost:5051. Settled interviews are in `engine_sessions` (no `NODE_URL` yet).

### Stage 2, on the platform side

The Node service on Railway redeploys on every commit, including engine commits, and a Node
deploy drops the current pipeline's live voice sockets. Its `railway.toml` needs watch patterns
that skip `/engine/**`.

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
| `Dockerfile`, `Dockerfile.dockerignore`, `openship.json` | The image (built from the repo root) and its Openship project |

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
- The production image (Python 3.12, built from the repo root as Openship builds it) in production
  mode: startup checks, case publishing, `/healthz`, `/readyz`, no API docs, the service token, and
  a `docker stop` in 0.4 s.

Not verified yet:
- The Openship deploy itself (the steps above).
- A full voice interview on the service, and re-offer after a real WebRTC drop.
- A candidate who finishes speaking during a restart's pause. OpenAI's turn detection should still
  add that turn to the call, so the model has it, but the engine does not see it: she answers only
  when they speak again or at the 25 s check-in, and the turn is missing from the settled transcript.

Run one replica until page sockets can reach any instance.

Next: the Openship deploy, and a voice interview on it. Then phase 2, case generation.
