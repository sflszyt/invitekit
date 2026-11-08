# InviteKit generic product plan

## Scope and design

Create a reusable wedding invitation and guest-management product from the existing application. Preserve the original working site in its original directory. Export reviewed source files into a separate repository with a new history. Keep the existing Cloudflare Workers + D1 architecture and Chinese/English presentation.

An in-place edit would risk the personal deployment; importing the original working directory would retain private material. A clean, allowlisted export provides a verifiable publication boundary. The repository is private initially.

## Implementation

- [x] Copy application code, schema migrations, selected tests, font and animation assets only.
- [x] Replace all personal text, artwork, photographs, audio, production bindings and machine paths with neutral examples.
- [x] Make invitation content reusable; retain the book interaction, guest desk, private RSVP, logistics, mailing fields and CSV export.
- [x] Provide portable setup, safe deployment templates, documentation and continuous integration.
- [x] Verify backend tests, all migrations, static asset references, mobile/desktop UI and guest workflows.
- [x] Independently inspect the complete candidate payload for privacy leaks before the first commit.

Release procedure: create a private repository, push the verified code, then verify visibility, the remote commit and hosted CI.

## Review focus

No copied runtime state, guest records, production identifiers, private media, historical evidence, personal git identity or absolute machine paths. Configuration changes must update visible invitation facts consistently. Production admin and RSVP must fail closed until deliberately configured. Browser tests must use isolated local data, and the generic application must work after a fresh dependency installation.
