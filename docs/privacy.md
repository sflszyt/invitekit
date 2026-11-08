# Privacy and source-control boundary

The distribution contains application source, schema migrations, synthetic tests, neutral demo illustrations, fonts and the animation runtime. It excludes deployment accounts, real domains, administrator identities, photos, supplied recordings, guest records, export files, private links and historical evidence.

The guest desk can store a name/household label, category, attendance status and headcount, accommodation/travel counts, mailing recipient, contact telephone, postal address and internal notes. These fields live in D1, not Git. Legacy public RSVP collects name, attendance and adult/child totals. Collect only fields needed for your event and remove data according to your own retention policy.

Private RSVP links are bearer credentials. Share each link only with the intended guest. Guests see only their own permitted response data; internal logistics/notes are administrative. Admin and API responses use private/no-store policies. CSV export neutralizes spreadsheet formula prefixes. No third-party analytics are configured.

Ignored paths include private configuration, environment files, local databases, build caches, screenshots, test evidence and dependency folders. `.gitignore` is a precaution, not a substitute for reviewing staged files. Run `npm run audit:release` for the generic release and inspect `git diff --cached` before pushing. A private GitHub repository still should not contain production secrets or guest data.
