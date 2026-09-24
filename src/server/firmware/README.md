# `server/firmware` — the AVR compile service (Node only)

The "toolchain present" upgrade path for the firmware slice. The browser-safe
*contract* lives in `src/lib/sim/firmware/compile-contract.ts`; this package is
the server-side implementation behind `POST /api/firmware-compile`.

```
compile-service.ts   discoverLocalCli()  version-gated discovery of
                     SPARKLAB_ARDUINO_CLI
                     compileSketch()     spawn arduino-cli with a deadline,
                                         write a private sketch file (never
                                         shell-interpolated), read Intel HEX
http.ts              handleFirmwareCompile()  zod-validated, streamed-body-capped,
                                         origin-checked; honest 503 when the
                                         toolchain is absent
```

## Behaviour

- No toolchain (`SPARKLAB_ARDUINO_CLI` unset) → `503 {error:{code:"no-arduino-cli"}}`.
- Unsupported arduino-cli major → 503 with the gate's reason.
- Oversized sketch / too many libraries → 413 before any filesystem I/O.
- Wrong origin / cross-site → 403 (same policy as classrooms).
- A cancelled or failed spawn → 503, never a fabricated HEX.

The offline lab never depends on this endpoint: when it 503s, the firmware
worker falls back to `compiler.ts`, which runs the known baseline sketches from
pre-built real AVR machine code. This is currently **one local child process**, not
a container sandbox or SSE build-log stream. The heartbeat interval in the
executor is reserved but does not publish events. Do not expose the endpoint to
untrusted public sketch compilation without an isolated build worker.

## Tests

`npm test -- src/server/firmware` exercises the real `spawn` path against a
fake arduino-cli script written per test, and proves the produced HEX runs on
the AVR core (`http.test.ts`), plus the HTTP status mapping and refusal paths.
`real-cli.integration.test.ts` is opt-in: CI installs the official arduino-cli
and Arduino AVR core, compiles a minimal Uno sketch and executes its HEX on
avr8js. A fake executable alone does not validate actual toolchain support.
