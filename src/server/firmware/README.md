# `server/firmware` — the AVR compile service (Node only)

The "toolchain present" upgrade path for the firmware slice. The browser-safe
*contract* lives in `src/lib/sim/firmware/compile-contract.ts`; this package is
the server-side implementation behind `POST /api/firmware-compile`.

```
compile-service.ts   discoverLocalCli()  version-gated discovery of
                     SPARKLAB_ARDUINO_CLI
                     compileSketch()     spawn gated arduino-cli, bounded by
                                         heartbeat + deadline, write a private
                                         temp sketch.ino (never a shell string),
                                         read back the Intel HEX
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
pre-built real AVR machine code.

## Tests

`npm test -- src/server/firmware` exercises the real `spawn` path against a
fake arduino-cli script written per test, and proves the produced HEX runs on
the AVR core (`http.test.ts`), plus the HTTP status mapping and refusal paths.
