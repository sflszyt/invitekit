# Configuration

`public/content.js` exports `wedding`. All example details are fictional.

| Field | Purpose |
| --- | --- |
| `names` | Two display names, in display order |
| `groomChinese`, `brideChinese` | Chinese names in the traditional insert |
| `date` | Calendar date in `YYYY-MM-DD` format |
| `ceremonyTime` | Local ceremony time in `HH:mm`, or `null` |
| `timeZone` | IANA zone displayed beside the local ceremony time; the date remains the venue's civil date |
| `city`, `cityEnglish` | Chinese and English city labels |
| `venue`, `venueEnglish`, `venueTraditional` | Venue labels used by the two invitation pages |
| `streetAddress`, `streetAddressEnglish`, `hall`, `hallEnglish` | Optional location detail |
| `introduction`, `closing` | Invitation and closing copy |
| `photos.hero`, `photos.detail`, `photos.memory` | `src`, optional `srcset`/`sizes`, `alt`, `position`, optional attribution |
| `music` | Optional recording source/title/credit, `autoplay: false` by default |

Keep the static fallback in `public/index.html` aligned when changing details. The example is intentionally fully readable without JavaScript; submitting replies requires JavaScript. Replace the neutral SVGs with authorized media only, remove metadata, and inspect the entire payload before committing. Do not copy a previous personal deployment's asset folder wholesale.

`public/animal-charms.config.js` contains `{ enabled: false, pets: [] }`. Optional pet entries use `id`, `label`, `species`, `src`, `verified`, `temporary`, `credit` and optional `sound` metadata. The existing renderer supports accessible controls and gesture-triggered sounds. No household portraits or recordings are bundled.

Guest category values are `新郎朋友`, `新娘朋友`, `新郎家人`, `新娘家人`, `新郎父母朋友`, `新娘父母朋友`, or empty for uncategorized. The server, UI and SQL CHECK constraints enforce the same values. For an existing deployment, add a forward migration when changing values; do not edit previously applied migrations. Admin timestamps and CSV exports currently use UTC+8 independently of the invitation's configurable time zone.
