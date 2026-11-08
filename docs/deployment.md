# Deployment

The repository template has no active production connection. Local development needs no account or secrets. Use a separate Cloudflare deployment for each wedding.

1. Install dependencies with `npm ci`. Authenticate Wrangler to your own account.
2. Copy `wrangler.jsonc` to `wrangler.production.jsonc` (ignored by Git). Set a unique Worker name and, if necessary, your account ID.
3. Create D1 with `npx wrangler d1 create invitekit`. Put the returned database name/ID into the private config. Keep binding `DB` and `migrations_dir: "migrations"`.
4. Configure your custom-domain route in that file and set `PUBLIC_ORIGIN` to its exact HTTPS origin. Keep `ENVIRONMENT: "production"`.
5. Create a Cloudflare Access self-hosted application for the admin pages and `/api/admin/*`. Allow only your intended administrators. Set `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and comma-separated `ADMIN_EMAILS` in the private configuration. The Worker verifies issuer, audience, signature, expiry and the email allowlist; an identity header alone does not grant access.
6. Generate at least 32 random characters for `INVITATION_LINK_SECRET`, then store it using `npx wrangler secret put INVITATION_LINK_SECRET --config wrangler.production.jsonc`. Keep this value stable and back it up securely: it encrypts stored tokens so the admin desk can display their links. Changing it without re-encrypting existing records breaks admin decryption; already-issued links remain valid. Revoke an invitation or delete it through the guest desk to disable its bearer link. Rotation requires a planned data migration.
7. Apply all migrations with `npx wrangler d1 migrations apply invitekit --remote --config wrangler.production.jsonc` (use your chosen database name). Use a new database for the generic schema.
8. Set `RSVP_ENABLED: "true"` when ready. Keep `PUBLIC_RSVP_ENABLED: "false"` for invitation-only operation and retain the `RATE_LIMITER` binding. Public self-registration is optional: enabling it additionally requires a separate random `PUBLIC_RSVP_SECRET` stored through Wrangler secrets.
9. Run all verification commands in the README. Preview a production dry run with `npx wrangler deploy --dry-run --config wrangler.production.jsonc`, then deploy with `npx wrangler deploy --config wrangler.production.jsonc`.
10. Verify unauthorized admin/API requests are denied, authorized administration works, and a synthetic guest can reply through its private link. Remove the synthetic guest afterwards.

Never commit private config, secrets, database files, exported guest lists, real RSVP links or test screenshots containing personal data. The normal `npm run build:check` only bundles the inactive generic template and does not deploy it.
