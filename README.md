# 🐶🧰 m5rcel's tool doggy

A cute but genuinely powerful toolbox that lives inside Discord.

Run Luau in a locked-down sandbox, do maths and unit conversions, convert colours
and check WCAG contrast, make and read QR codes, search Wikipedia, and handle the
everyday developer chores — JSON, hashes, Base64, UUIDs, timestamps and text —
without ever leaving the chat window.

```
🧰 m5rcel's tool doggy

Your friendly Discord utility toolkit.

💻 Developer    Run Luau, inspect JSON, hashes, encoding and more.
🧮 Calculator   Calculate expressions and conversions.
🎨 Colors       Convert colors, check contrast and generate palettes.
▣  QR           Generate and decode QR codes.
📚 Wikipedia    Search Wikipedia and retrieve article summaries.
🔧 Utilities    Timestamps, UUIDs, text tools and other helpers.
```

Everything works in **servers, DMs and group DMs**, and the bot asks for
**zero Discord permissions**.

---

## Contents

- [Quick start](#quick-start)
- [Commands](#commands)
- [How the Luau sandbox is isolated](#how-the-luau-sandbox-is-isolated)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Privacy](#privacy)
- [Development](#development)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## Quick start

You need a Linux VPS (or any machine) with **Docker** and the **Docker Compose
plugin**. Nothing else — Node.js, npm and the Luau toolchain all live inside the
images.

### 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**. Name it whatever you like.
2. Copy the **Application ID** from *General Information* — this is your
   `DISCORD_CLIENT_ID`.

### 2. Create the bot and get a token

1. Go to the **Bot** tab and click **Reset Token**, then **Copy**.
   This is your `DISCORD_TOKEN`. Treat it like a password — anyone holding it
   controls the bot.
2. No privileged gateway intents are needed. Leave *Message Content*,
   *Server Members* and *Presence* switched **off**.

### 3. Configure the environment

```bash
git clone <your fork or copy of this repository> m5rcels-tool-doggy
cd m5rcels-tool-doggy
cp .env.example .env
```

Edit `.env` and fill in three values:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
LUAU_WORKER_TOKEN=a-long-random-string
```

Generate the worker token with:

```bash
openssl rand -hex 32
```

That token is a shared secret between the bot and the sandbox. It is **not** a
Discord credential and the sandbox container never sees anything else.

### 4. Invite the bot

Replace `YOUR_CLIENT_ID` and open the URL in a browser:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=0
```

The scopes are `bot` and `applications.commands`; the permission integer is
`0`. **Administrator is never required** — the bot only replies to
interactions and never reads messages, manages the server or touches members.

> `npm run deploy` prints this exact URL for your application, if you would
> rather copy it from the terminal.

### 5. Start it

```bash
docker compose up -d
```

That builds both images, starts the sandbox, waits for it to report healthy,
then starts the bot. Slash commands are registered automatically on the first
successful login.

Watch it come up:

```bash
docker compose logs -f
```

### 6. Test it

In any server or in a DM with the bot, run:

```
/toolkit
```

Then try the flagship feature:

```
/luau run code:print("Hello from m5rcel's tool doggy")
```

Leave `code` empty and you get a proper multi-line editor instead.

> **Global commands can take up to an hour to appear the first time.** While
> you are setting things up, put your server's id in `DISCORD_GUILD_ID` — guild
> commands register instantly. Clear it again for the public rollout.

---

## Commands

### 💻 Developer

| Command | What it does |
| --- | --- |
| `/luau run` | Executes a Luau program in an isolated container and shows its output, timing and status. |
| `/luau compile` | Syntax- and type-checks Luau without running it, including analyser warnings. |
| `/luau limits` | Shows the live sandbox limits and whether the worker is online. |
| `/json format` | Pretty-prints JSON, optionally sorting keys. Accepts a `.json` upload. |
| `/json minify` | Strips whitespace and reports the saving. |
| `/json validate` | Reports the first error with its line and column. |
| `/json diff` | Structural diff of two documents — added, removed and changed paths. |
| `/hash` | SHA-256, SHA-512, SHA-384, SHA-224, SHA3-256, SHA3-512, SHA-1, MD5. |
| `/base64 encode` · `/base64 decode` | Base64 and Base64URL, with strict validation on decode. |

### 🧮 Calculator

`/calc expression:<…>` handles three shapes of input:

```
/calc expression:5 * (20 + 3)          →  115
/calc expression:2^32                  →  4 294 967 296
/calc expression:sqrt(144)             →  12
/calc expression:50% of 200            →  100
/calc expression:255 to binary         →  11111111
/calc expression:0xFF to decimal       →  255
/calc expression:1 GiB to bytes        →  1 073 741 824
/calc expression:100 C to F            →  212
/calc expression:10 km in miles        →  6.21371192237
```

Supported: arithmetic, parentheses, powers (`^`, `**`), roots, factorials,
percentages, modulo, trigonometry (radians and the `…d` degree variants),
logarithms, `min`/`max`/`sum`/`avg`/`gcd`/`lcm`/`hypot`, the constants
`pi`, `tau`, `e`, `phi`, `c`, `g`, scientific notation, hex/binary/octal
literals, digit separators, bases 2–36, and unit conversion across length,
mass, time, temperature, data, speed, area, volume and angle.

Typing in the `expression` box shows a live preview and completes function,
constant and unit names.

**There is no `eval` anywhere.** The expression is tokenised, parsed into an
AST and walked by an interpreter — a test asserts that no file under
`src/services/calculator/` contains `eval(`, `new Function(` or `vm`.

### 🎨 Colors

| Command | What it does |
| --- | --- |
| `/color convert` | HEX, RGB, HSL, HSV, CMYK, integer and ready-to-paste CSS, with a swatch image. |
| `/color contrast` | WCAG 2.1 contrast ratio, AA/AAA verdicts for normal text, large text and UI components, plus a rendered preview. |
| `/color palette` | Complementary, analogous, triadic, tetradic, monochromatic, shades and split-complementary, with a palette image. |

Input can be `#FF6600`, `#F60`, `#FF6600CC`, `rgb(255, 102, 0)`,
`hsl(24, 100%, 50%)`, `hsv(…)`, `cmyk(…)`, `255,102,0`, or any of the 148 CSS
colour names.

### ▣ QR

| Command | What it does |
| --- | --- |
| `/qr create` | URL, plain text, email, telephone, SMS, Wi-Fi, Discord invite or vCard, with a selectable error-correction level. |
| `/qr decode` | Reads a QR code out of an uploaded image and shows the payload as text. |

The type is guessed when you do not pick one. **Decoded URLs are never
opened, resolved or previewed** — they are shown as text with a warning.

### 📚 Wikipedia

| Command | What it does |
| --- | --- |
| `/wiki search` | Full-text search with descriptions, excerpts, thumbnails and links. |
| `/wiki article` | One article's summary, with live title autocomplete. |
| `/wiki random` | A random article. |

All three take a `language` option (15 editions in the picker, and the default
comes from `WIKIPEDIA_DEFAULT_LANGUAGE`). Disambiguation pages are labelled as
such, and a missing article comes back with suggestions instead of a dead end.

Built on the official Wikimedia REST APIs — `/w/rest.php/v1/search/page`,
`/api/rest_v1/page/summary`, `/api/rest_v1/page/random/summary` and the
OpenSearch endpoint. **Nothing is scraped.** Responses are cached in-process
for `WIKIPEDIA_CACHE_TTL_S` seconds, and every request carries a descriptive
User-Agent as the Wikimedia API etiquette asks for.

### 🔧 Utilities

| Command | What it does |
| --- | --- |
| `/timestamp now` | Every Discord timestamp style for right now. |
| `/timestamp at` | Build one from a date or a unix value (milliseconds are detected). |
| `/timestamp in` | A timestamp a set number of minutes/hours/days/weeks from now. |
| `/uuid` | UUIDv4, time-ordered UUIDv7, a short Base64URL id, or the nil UUID. |
| `/text transform` | camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, sentence case, slugs, reversed. |
| `/text count` | Characters, words, lines, sentences, unique words and UTF-8 byte length. |

Most commands accept a `private` option so the reply is only visible to you.

---

## How the Luau sandbox is isolated

> **The bot process never executes a single line of submitted code.**

```
Discord
   │
   ▼
Bot container ──── holds the Discord token, runs no user code
   │
   ▼
Bot-side queue ─── concurrency limit + queue timeout (fail fast, never hang)
   │
   │  HTTP over an internal-only Docker network, bearer-token authenticated
   ▼
luau-worker ────── holds NO Discord credentials, has NO internet access
   │
   ▼
Worker queue ───── concurrency limit + bounded queue depth
   │
   ▼
Disposable job ─── fresh temp dir, per-process rlimits, killed on any limit,
                   directory removed afterwards
```

A test asserts that no file under `src/` imports `child_process` or calls
`eval`/`new Function`, so the bot cannot execute anything even by accident.

### Container-level isolation (the real boundary)

The `luau-worker` service in `docker-compose.yml` gets:

| Restriction | Setting |
| --- | --- |
| Non-root user | `user: "10001:10001"` — a dedicated `sandbox` account that owns nothing |
| No writable filesystem | `read_only: true`, plus one `noexec,nosuid,nodev` tmpfs at `/tmp` |
| No network egress | attached only to a `internal: true` network — DNS and outbound TCP both fail |
| No capabilities | `cap_drop: ALL` |
| No privilege escalation | `security_opt: no-new-privileges:true` |
| Memory ceiling | `mem_limit: 512m`, `memswap_limit: 512m` |
| CPU ceiling | `cpus: 1.0` |
| Process ceiling | `pids_limit: 128` — a fork bomb hits the wall, not the host |
| No Docker socket | never mounted |
| No host filesystem | no bind mounts at all |
| No bot secrets | the environment holds only `LUAU_WORKER_TOKEN` and the limits |

### Per-process limits

Each program is launched through `/bin/sh -c 'ulimit …; exec luau …'` in its own
process group with:

- `ulimit -v` — address space, from `LUAU_MEMORY_MB`
- `ulimit -t` — CPU seconds, a kernel-enforced backstop for a program that
  ignores our signals
- `ulimit -f` — maximum file size
- `ulimit -n` — open file descriptors
- `ulimit -c 0` — no core dumps

On top of that the worker enforces a **wall-clock timeout** (SIGKILL to the
whole process group) and an **output-size cap** that kills the program the
moment it is exceeded. The environment handed to the child contains only
`PATH`, `HOME`, `TMPDIR` and `LANG` — the worker token is not inherited.

`luau-analyze` (used by `/luau compile`) gets a larger address-space allowance
because it is multi-threaded, which is safe: it parses and type-checks, it
never runs the program.

### Lua-level hardening

A one-line prelude is prepended to each program. It replaces `io`, `require`,
`loadstring`, `load`, `dofile`, `loadfile`, `getfenv`, `setfenv` and `newproxy`
with functions that raise a clear error, and narrows `os` and `debug` to their
harmless members. Being exactly one line keeps reported error line numbers
accurate to within a fixed offset of 1.

Two honest caveats:

- Luau's CLI sandboxes each script onto a globals table that inherits from a
  **readonly** parent, so assigning `nil` would *re-expose* the original. Every
  shadow is therefore a non-nil value. A determined program can still reach the
  originals through `_G`, and `loadstring` only compiles source it already
  controls.
- **This layer is convenience, not the security boundary.** The container above
  is. It is designed so that a full Lua-level escape still lands somewhere with
  no network, no writable disk, no capabilities and no secrets.

### Limits shown to users

`/luau limits` reports the live values. They are bounded twice — once in
`src/config.js` and again in `worker/src/limits.js` — so an operator cannot
configure them away and a user can never influence them.

```
⏱️ Execution timed out.

The program exceeded the 3.00 s execution limit.
```

---

## Configuration

Everything is environment-driven; you never have to edit source to configure the
bot. See [`.env.example`](.env.example) for the annotated full list.

### Required

| Variable | Meaning |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the Developer Portal. |
| `DISCORD_CLIENT_ID` | Application ID. |
| `LUAU_WORKER_TOKEN` | Shared secret between the bot and the sandbox. `openssl rand -hex 32`. |

### Discord

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_GUILD_ID` | *(empty)* | Register commands to one guild for instant updates while developing. |
| `DISCORD_IDENTIFY_BROWSER` | `Discord Android` | Gateway identify property. `Discord Android` or `Discord iOS`. |
| `DISCORD_AUTO_DEPLOY` | `true` | Register slash commands on startup. |
| `DISCORD_USER_INSTALL` | `false` | Also register for user installs. Only enable if *User Install* is turned on for the application. |

### Luau sandbox

| Variable | Default | Bounds |
| --- | --- | --- |
| `LUAU_TIMEOUT_MS` | `3000` | 250 – 15000 |
| `LUAU_MEMORY_MB` | `64` | 16 – 512 |
| `LUAU_MAX_OUTPUT` | `16000` | 256 – 200000 |
| `LUAU_MAX_SOURCE` | `20000` | 128 – 200000 |
| `LUAU_MAX_CONCURRENT` | `4` | 1 – 32 |
| `LUAU_QUEUE_TIMEOUT_MS` | `10000` | 1000 – 60000 |
| `LUAU_MAX_QUEUE_DEPTH` | `32` | 1 – 512 *(worker only)* |
| `LUAU_VERSION` | `0.737` | Luau release tag used when building the worker image. |

### Everything else

| Variable | Default | Meaning |
| --- | --- | --- |
| `WIKIPEDIA_DEFAULT_LANGUAGE` | `en` | Default language edition. |
| `WIKIPEDIA_CONTACT` | repo URL | Advertised in the User-Agent, per Wikimedia etiquette. |
| `WIKIPEDIA_CACHE_TTL_S` | `300` | In-process response cache lifetime. |
| `RATE_LIMIT_LUAU` | `3/20` | Per user: 3 executions per 20 seconds. |
| `RATE_LIMIT_QR_DECODE` | `5/30` | Per user: 5 decodes per 30 seconds. |
| `RATE_LIMIT_WIKI` | `10/20` | Per user: 10 Wikipedia commands per 20 seconds. |
| `RATE_LIMIT_DEFAULT` | `20/10` | Per user, everything else. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `silent`. |
| `LOG_FORMAT` | `json` | `json` for shippers, `pretty` for humans. |

Rate limits are per user and per bucket. Hitting one produces a friendly reply
and never affects anybody else:

```
🐶 Slow down!

You can use the Luau sandbox again in 2 seconds.
```

---

## Deployment

### Everyday commands

```bash
docker compose up -d          # build (first time) and start
docker compose logs -f bot    # follow the bot's logs
docker compose logs -f luau-worker
docker compose ps             # health status of both services
docker compose restart bot    # pick up an .env change
docker compose down           # stop everything
docker compose up -d --build  # rebuild after a code change
```

Both services use `restart: unless-stopped` and have health checks. The bot
writes a heartbeat while its gateway connection is healthy; if the shard dies
the container is marked unhealthy. The worker answers `GET /health`.

Compose starts the bot only once the sandbox reports healthy
(`depends_on: condition: service_healthy`).

### Registering commands by hand

Auto-registration on startup covers the normal case. To do it manually:

```bash
docker compose exec bot node src/deploy-commands.js          # global
docker compose exec bot node src/deploy-commands.js --guild 123456789012345678
docker compose exec bot node src/deploy-commands.js --clear  # remove them all
```

Outside Docker: `npm run deploy`, `npm run deploy:clear`.

### Running without Docker

Docker is strongly recommended — the sandbox isolation *is* the container
configuration, and running the worker on bare metal throws most of it away.
If you must:

```bash
npm ci
# terminal 1 — needs the luau and luau-analyze binaries on PATH
LUAU_WORKER_TOKEN=… node worker/src/server.js
# terminal 2
LUAU_WORKER_URL=http://127.0.0.1:8080 LUAU_WORKER_TOKEN=… npm start
```

### Architecture support

The worker image uses the upstream prebuilt Luau binaries on `x86_64` and
compiles the same pinned tag from source on every other architecture (arm64
included). Both paths are in `worker/build-luau.sh`; the arm64 build takes a few
minutes the first time and is then cached.

---

## Privacy

The bot has no database and writes nothing to disk.

- **Luau source** is held in memory, written to a per-job temporary file inside
  the sandbox, and the whole directory is deleted when the job ends. It is never
  logged.
- **Uploaded QR images** are downloaded into memory, scanned and dropped. They
  are never written to disk.
- **Calculator, colour, JSON, hash and text input** is processed in memory and
  discarded with the response.
- **DM contents** are not read at all — the bot has no message intent and
  receives only the interactions people explicitly send it.
- **Logs** record the *shape* of a job (command, subcommand, byte count,
  duration, status, guild id) and never its contents. Any field whose name looks
  like a secret is redacted, and the Discord and worker tokens are masked
  anywhere they might appear.

The bot requests **zero Discord permissions** and no privileged gateway intents.
Its only intent is `Guilds`, which is not privileged and carries no message data.

---

## Development

```bash
npm ci
npm test              # 105 tests
npm run lint:syntax   # parse every file without running it
npm run deploy        # register slash commands
npm start             # run the bot (needs a reachable worker)
```

The Wikipedia tests hit the live Wikimedia API and skip themselves when there is
no network. The colour and QR tests render and decode real images. The sandbox
tests cover the queues, the diagnostic parsers and the prelude invariants.

To exercise the sandbox itself, start just the worker:

```bash
docker compose up -d luau-worker
curl -s -X POST http://localhost:8080/run \
  -H "Authorization: Bearer $LUAU_WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"source":"print(\"hi\")"}'
```

(The worker publishes no port by default — it is only reachable from the bot.
Add a `ports:` entry temporarily if you want to poke it from the host.)

### Adding a command

Drop a file in `src/commands/`. It must export `data` (a `SlashCommandBuilder`)
and `execute(interaction, context)`. Optional exports: `autocomplete`,
`handleComponent`, `handleModal`, `category`, `rateLimit`,
`rateLimitFor(interaction)` and `skipRateLimit(interaction)`. The loader picks it
up automatically and `tests/commands.test.js` will check it against Discord's
constraints.

Build embeds through `src/utils/embeds.js` — `createSuccessEmbed`,
`createErrorEmbed`, `createInfoEmbed`, `createWarningEmbed`,
`createLoadingEmbed` and `createResultEmbed` — so the bot keeps one visual
identity. Reply through `src/utils/respond.js`, which knows how to handle every
interaction state and turns thrown errors into friendly embeds.

---

## Project layout

```
m5rcels-tool-doggy/
├── src/
│   ├── index.js                  entry point; gateway identification, client, shutdown
│   ├── config.js                 environment parsing, clamping and validation
│   ├── deploy-commands.js        slash-command registration (script + startup)
│   ├── health.js                 heartbeat for the container health check
│   ├── commands/                 one file per slash command
│   ├── handlers/
│   │   ├── commandLoader.js      discovery and registration payload
│   │   └── interactionHandler.js the single interaction entry point
│   ├── services/
│   │   ├── calculator/           tokenizer, parser, evaluator, units — no eval
│   │   ├── colors/               conversion, WCAG contrast, palettes, images
│   │   ├── json/                 format, minify, validate, structural diff
│   │   ├── luau/                 validation, backpressure, result shaping
│   │   ├── qr/                   generation and decoding
│   │   ├── text/                 case conversion and counting
│   │   └── wikipedia/            Wikimedia REST client with caching
│   ├── sandbox/
│   │   ├── limits.js             the limits the bot advertises
│   │   ├── queue.js              bot-side backpressure
│   │   └── workerClient.js       authenticated HTTP client for the worker
│   └── utils/                    embeds, logger, validation, rate limits, cache
├── worker/                       the isolated sandbox — no Discord code at all
│   ├── Dockerfile
│   ├── build-luau.sh             prebuilt on x86_64, from source elsewhere
│   └── src/
│       ├── server.js             tiny authenticated HTTP surface
│       ├── executor.js           rlimits, timeouts, disposable job directories
│       ├── queue.js              concurrency and queue-depth limits
│       ├── limits.js             hard bounds nobody can widen
│       └── prelude.js            the one-line Lua hardening prelude
├── scripts/                      health check and syntax check
├── tests/
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Troubleshooting

**Commands do not appear.**
Global registration can take up to an hour the first time. Set
`DISCORD_GUILD_ID` for instant registration while testing, and check
`docker compose logs bot` for a registration error. Make sure the bot was
invited with the `applications.commands` scope.

**`/luau` says the sandbox is offline.**
`docker compose ps` — is `luau-worker` healthy? `docker compose logs luau-worker`
will say if it refused to start. The most common cause is `LUAU_WORKER_TOKEN`
differing between the two services; both read it from the same `.env`, so make
sure you did not override one of them.

**"The Luau sandbox rejected this bot."**
The tokens do not match. Fix `.env` and `docker compose up -d --force-recreate`.

**The bot exits immediately with a configuration error.**
It prints exactly which variable is missing. Copy `.env.example` to `.env` and
fill in the three required values.

**Login fails.**
Reset the token in the Developer Portal and update `.env`. Check that
`DISCORD_CLIENT_ID` belongs to the *same* application as the token.

**The worker image takes minutes to build.**
You are on arm64, so Luau is compiled from source. It is cached after the first
build. Set `LUAU_VERSION` to pin a different release.

**Programs that print a lot time out with no output.**
Luau block-buffers stdout when it is not a terminal, so a program killed
mid-loop may not have flushed anything yet. Print less, or finish sooner.

---

## Licence

MIT.

Wikipedia content is available under CC BY-SA and is shown with attribution.
Luau is a project of Roblox, distributed under the MIT licence.
