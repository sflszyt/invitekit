# InviteKit

A configurable bilingual wedding invitation and private guest RSVP desk, built with Cloudflare Workers and D1. The demo uses fictional names, an example venue and original geometric illustrations.

InviteKit 是一套可以自行部署的婚礼请柬与宾客管理系统。修改配置即可更换新人、日期、场地和图片；仓库提供完整前后端、数据库迁移和自动化验证。当前是每次部署服务一场婚礼的模板产品，不包含多租户、付费或自助注册。

## Features

- Responsive Chinese/English invitation, animated invitation book, keyboard access and reduced-motion support.
- Private, name-bound RSVP links with attendance and headcount.
- Guest categories, draft/sent/likely/accepted/declined states, search and automatic saves.
- Accommodation, travel and paper-invitation mailing fields.
- Soft deletion/restoration, totals and CSV export with spreadsheet-formula protection.
- Conflict detection and idempotent retries to protect saved replies.
- Cloudflare Access JWT verification for production administration.
- Optional music and pet portraits, disabled in the demo; add only media you have permission to use.

## Quick start

Requirements: Node.js 24+ and npm. No Cloudflare account is needed for local development.

```sh
npm ci
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787/` for the invitation and `http://127.0.0.1:8787/admin` for the guest desk. Local preview binds to loopback and stores data in ignored `.local-state/`. Start with fictional guests; no guest records are included in the repository. Production admin never uses the local authentication exemption.

## Customize

Edit `public/content.js` for names, date, ceremony time, location, time zone, copy, photos and optional music. `public/index.html` contains the matching no-JavaScript example; update its fallback text when personalizing. The live JavaScript view uses the configuration. See [configuration](docs/configuration.md).

Brand and layout styles are in `public/styles.css` and `public/invitation-book.css`. Guest categories use neutral role labels consistently across the backend, schema and UI. Changing category values requires updating all three; see the configuration guide.

## Verify

```sh
npm run check
npm test
npm run audit:release
npm run build:check
npx playwright install chromium
npm run test:browser
npm run test:guests
```

On Linux CI, install browser OS libraries with `npx playwright install --with-deps chromium`. Tests start disposable local Workers/D1 instances on dynamic ports. They do not connect to a production service or the preview database. Browser evidence stays under ignored `artifacts/`; isolated databases stay under ignored `.test-state/`. An existing Chromium binary can be selected with `CHROME_PATH`.

`audit:release` validates the pristine generic distribution. A personalized deployment should keep private configuration outside the repository; intentionally adding your own media/content requires reviewing and updating this release policy.

## Deploy

The checked-in production template deliberately disables RSVP and has no real account, database, domain or administrator configuration. Follow [deployment](docs/deployment.md) to create a new D1 database, configure Access and secrets, and deploy your own instance. Publishing the repository does not deploy a website.

## Privacy and licensing

See [privacy](docs/privacy.md) for what is collected, stored and excluded from source control. Application code is private and unlicensed for redistribution (`UNLICENSED`) until the owner chooses a license. Third-party assets keep their existing terms: [third-party notices](THIRD_PARTY_NOTICES.md).
