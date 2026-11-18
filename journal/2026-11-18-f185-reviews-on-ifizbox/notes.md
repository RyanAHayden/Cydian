# F185: user reviews on ifizbox.com

## What I did
- `worker/wrangler.ifizbox.toml`: `/reviews/*` added to `run_worker_first`; `[[d1_databases]]` REVIEWS
  (`database_name = "cydian-reviews"`, no `database_id`) and `[[ratelimits]]` REVIEW_RATE_LIMIT (namespace 9803,
  6/60s, = `REVIEW_WRITES` in src/reviews.js), copied from `worker/wrangler.toml`.
- Left `database_id` out on purpose: Wrangler provisions the D1 database on the next deploy (Workers Builds) and
  binds it, as `worker/wrangler.toml` already relies on for HOSTED. I did not run `npx wrangler d1 create`: that
  creates a resource in the Cloudflare account from an unattended run, and the deploy does the same thing anyway.
- Checked: the file parses (tomllib), and `npx wrangler@4.164.0 deploy --dry-run -c wrangler.ifizbox.toml` lists
  env.REVIEWS (D1), env.REVIEW_RATE_LIMIT (6 requests/60s) next to the existing bindings.

## For a person
- After the next deploy: `cd worker && npx wrangler secret put REVIEWS_ADMIN -c wrangler.ifizbox.toml` (owner
  delete), optionally `REVIEWS_SALT` the same way. Optionally paste the provisioned database_id into the toml
  (`npx wrangler d1 list`) so it is pinned.

## Not verified
- A real deploy: auto-provisioning of the D1 database on Workers Builds and `/reviews/<id>` answering on
  ifizbox.com. The runner publishes after merge; I can't deploy from this task.
- The secrets: they need a person (`wrangler secret put`), so owner delete is off until then.
