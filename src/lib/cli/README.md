# `lib/cli` — sparklab-cli

**Responsibility.** Run projects and scenarios headless from a terminal or CI, with wokwi-cli's
flags and exit codes where they overlap.

**Public API.**

```ts
runCli(argv, io) -> Promise<exitCode>   // pure: io = { out, err, cwd }
parseFlags(argv)
EXIT = { ok: 0, fail: 1, usage: 2, timeout: 42 }
junitReport(results)
loadProject(target, diagramFile?)       // .sparklab.json or a Wokwi folder
findScenarios(dir)                      // *.test.yaml and *.scenario.yaml
exampleFiles()                          // what examples/ should contain
```

`scripts/sparklab-cli.ts` is the only code that touches `process`; everything else is testable
in-process.

**Commands.**

```bash
npm run cli -- <project-dir> [--expect-text T] [--fail-text T] [--timeout MS] [--timeout-exit-code N]
npm run cli -- <project-dir> --scenario file.test.yaml [--junit-report junit.xml] [--json-summary s.json]
npm run cli -- lint <project-dir>
npm run cli -- test [dir] --recursive [--junit-report junit.xml]
npm run cli -- diagram export <project-dir> --wokwi | --kicad | --bom-csv [--out file]
npm run cli -- init [dir]
npm run examples      # regenerate examples/ from the seed data
npm run scenarios     # run every scenario in examples/
```

**CI.** `.github/actions/simulate` is a composite action wrapping `test --recursive`;
`.github/workflows/ci.yml` runs typecheck, tests, build and the example scenarios.

**Tests.** `npm test -- src/lib/cli` runs every command against temp directories, runs the real
`examples/` suite, and fails if `examples/` has drifted from the seed data.
