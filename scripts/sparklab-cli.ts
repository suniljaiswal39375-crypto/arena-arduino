/**
 * sparklab-cli entry point. All behaviour lives in src/lib/cli/cli.ts; this
 * file only connects it to the terminal.
 *
 *   npm run cli -- <project-dir> --expect-text "hello"
 *   npm run cli -- test examples --recursive --junit-report junit.xml
 */
import { runCli } from '../src/lib/cli/cli';

runCli(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  cwd: process.env.INIT_CWD ?? process.cwd(),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  });
