# Build and command-line scripts

- `prepare-editor.mjs`: predev/prebuild copy of the npm Monaco AMD distribution to ignored public assets. No CDN required.
- `prepare-offline.mjs`: postbuild generates a build-versioned service worker using `.next/BUILD_ID` and hashed static assets. Template: `service-worker.js`; generated output: ignored `public/sw.js`.
- `sparklab-cli.ts`: terminal adapter for `src/lib/cli`; run `npm run cli -- --help`.
- `generate-examples.ts`: regenerate ten checked-in scenario examples with `npm run examples`.

Run `npm ci`, `npm run build`, `npm test`, and `npm run scenarios`. Offline browser tests require a production build; see `e2e/README.md`. Never run a build while a dev server is writing the same `.next` directory.
