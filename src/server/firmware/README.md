# AVR build service — local development and isolated farm

The browser-safe contract lives in `src/lib/sim/firmware/compile-contract.ts`.
The **zero-config local lab** never requires this service: only two known
pre-built AVR baseline images run without a toolchain. Other firmware sketches
are refused, never run as interpreter code or fabricated HEX.

## Modes and trust boundary

- `compile-service.ts`: development-only direct `arduino-cli` spawn when
  `SPARKLAB_ARDUINO_CLI` points to official CLI 1.x with the AVR core installed.
  Its main sketch is `Sketch/Sketch.ino` in a private ephemeral directory.
  **Production returns 503 instead of spawning this unsandboxed process.**
- `farm-worker.ts`: one disposable Docker container per job, compiling only
  Uno/Nano (ATmega328P) with preinstalled core libraries (`Wire`, `SPI`,
  `EEPROM`, `SoftwareSerial`). Builds are limited by time, CPU, memory, PIDs,
  HEX/log sizes, no network, no root, read-only rootfs, no capabilities. Each
  job mounts only its private sketch/output directory; a timeout or disconnect
  forcibly removes the named container. There is no runtime package download.
- `farm-http.ts`: bearer-authenticated **internal** service (`/v1/compile`),
  at most two concurrent jobs (429 otherwise). It never accepts browser
  credentials; the bearer is an operator-set *service-to-service* token, not
  a user login. Defaults to a loopback listener.
- `farm-client.ts` / `http.ts`: Next's same-origin, Origin-checked
  `POST /api/firmware-compile`, with a 64 KiB streamed-body cap, max 8 KiB
  sketch, precise 413/422/503 errors and no-store response. When
  `SPARKLAB_BUILD_FARM_URL` and `SPARKLAB_BUILD_FARM_TOKEN` are set, it proxies
  to the farm; the browser never receives either value. The route requires a
  canonical `AUTH_URL` when the farm is enabled.

`Accept: application/json` returns `{ok:true,hex,cacheKey,fqbn,toolchain}`.
`Accept: text/event-stream` returns incremental `status`, `log`, `result`
(HEX) or `error` events. Heartbeats keep the stream alive. The browser worker
checks framing, byte limits and requested board, and sends progress to the
builder's **Build logs** tab. Its state is ephemeral — no project file,
localStorage or service-worker caching of logs or source. Compiler errors are
not success; an unavailable build falls back only to the two known offline
baseline images.

## Operator setup (Docker host separate from the public Next server)

```bash
docker build -f build-farm/Dockerfile -t sparklab-avr-builder:1.5.1 build-farm
# On the protected farm host, set a random 32+-character token and the image:
# SPARKLAB_BUILD_FARM_IMAGE=sparklab-avr-builder:1.5.1
# SPARKLAB_BUILD_FARM_TOKEN=<operator-generated secret>
# SPARKLAB_BUILD_FARM_HOST defaults to 127.0.0.1; set an internal-only interface
# or proxy through authenticated TLS for a separate application host.
npm run firmware:farm
```

On the app host, set `AUTH_URL` to the canonical HTTPS browser origin plus
`SPARKLAB_BUILD_FARM_URL` (internal farm origin) and the matching
`SPARKLAB_BUILD_FARM_TOKEN`. Never publish the Docker socket, farm port or
service token to the browser. A production container must run on a dedicated
operator-controlled host, behind a firewall and trusted TLS where the hop
crosses hosts. Use deployment-level rate/abuse controls and monitor the Docker
host; same-origin checks alone are not user authentication. Install and pin the
image digest under your supply-chain policy. Nothing here claims a finished
school deployment.

## Verification

```bash
npm test -- src/server/firmware
# Official CLI 1.5.1 + Arduino AVR core, in GitHub Actions:
SPARKLAB_REAL_ARDUINO_CLI=arduino-cli SPARKLAB_ARDUINO_CLI=arduino-cli npm test -- src/server/firmware/real-cli.integration.test.ts
# With Docker and the pinned image, in the separate CI job:
SPARKLAB_TEST_FARM_IMAGE=sparklab-avr-builder:ci npm test -- src/server/firmware/farm.integration.test.ts
```

`compile-service.test.ts`/`http.test.ts` exercise the local CLI path against a
fake executable and prove its HEX runs on avr8js. That fake test is **not** a
real-toolchain validation. The official CLI integration passed in GitHub
Actions (run 36045051575) and caught the actual sketch-directory naming rule.
`farm-worker.test.ts` verifies Docker arguments, cancellation, cleanup and
refusal without Docker. `farm-http.test.ts` proves auth/body/concurrency, SSE
logs-before-HEX, cancellation, Next proxy and token non-disclosure. The real
Docker image/SSE/avr8js CI job is the remaining container validation gate; it
cannot run locally in this sandbox (no Docker).
