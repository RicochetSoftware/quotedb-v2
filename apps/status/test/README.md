# Isolated status validation

`pnpm --filter @quotedb/status test` runs reducer, real SQLite transaction,
authentication, replay, probe, outage and retry checks. It applies every migration.
`python3 -m http.server 8765 --directory apps/status/public` plus
`node apps/status/test/browser.mjs` exercises seven UI states and mobile overflow.

For remote validation, use a disposable D1 database and the preview/fixture configs
at the package root. Copy `wrangler.preview.jsonc` to the ignored
`wrangler.preview.generated.json`, replace its zero database UUID with the new
preview database, and apply migrations with that config. Configure a separate
`OPERATOR_SECRET` through `wrangler secret put`. Deploy the fixture and preview
configs, then run `scripts/verify-preview.mjs` with `PREVIEW_URL` and
`PREVIEW_SECRET` in the environment. The fixture hostname in `preview-worker.ts`
must match the deployed disposable fixture Worker. Neither config has a cron.
Never bind these fixtures to the production database or custom domain.

The preview deliberately accepts synthetic future timestamps and fabricates bot
health. Its endpoints are not included in any production entrypoint. The protected
`/run` accepts modes `healthy`, `mixed`, `all-down`, `timeout`; two timeouts should
return after about five seconds each and confirm all components down. Three healthy
evaluations recover. The normal verification script checks those same hysteresis
rules with HTTP errors and mixed red/yellow incidents.

Remove the two disposable Workers and their D1 database after verification.
