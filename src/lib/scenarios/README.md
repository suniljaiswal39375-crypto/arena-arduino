# `lib/scenarios` — automation scenarios

**Responsibility.** Parse a scenario YAML file and run it against a project headless, on a virtual
clock, returning a pass/fail result with a message a student can act on.

**Public API.**

```ts
parseScenario(yaml) -> Scenario          // throws ScenarioParseError with a path: "steps[1].set-control: missing \"control\""
scenarioToYaml(scenario) -> string       // round-trips with parseScenario
parseDuration("500ms" | "2s", path)      // units required, as in Wokwi
runScenario(project, scenario, source?) -> ScenarioResult
resolveControl(doc, partId, control, value)  // Wokwi control names -> SparkLab inputs
SEED_SCENARIOS, projectForScenario(seed)     // the 10 examples
```

**Steps.** Wokwi's: `delay`, `set-control`, `wait-serial`, `expect-pin`, `write-serial`.
Extensions from the spec: `assert-serial-regex`, `set-virtual-input`, `assert-no-diagnostic`,
`repeat`. A scenario written for Wokwi CI runs here unchanged.

**Behaviour worth knowing.**

- Time is simulated. A 30-second `wait-serial` timeout finishes in milliseconds of real time.
- Scenario time is the sum of the ticks the runner asked for, not the engine clock, which can run
  one `delay()` ahead. Timeouts mean what the YAML says.
- `wait-serial` consumes output up to and including the match, as Wokwi does, so two identical
  waits need two lines.
- `set-control` writes a per-part input key (`btn2.buttonPressed`), so two buttons are independent.
- The run stops at the first failing step. `failure.message` always names the actual value.

**Tests.** `npm test -- src/lib/scenarios`: every seed passes against its project, every seed
round-trips through YAML, and failures are detected (backwards threshold, wrong pin level, a fault
the ERC reports, a sketch that does not compile).
