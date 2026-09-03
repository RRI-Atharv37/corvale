---
title: Desktop API
---

## GET /api/v1/desktop/release-manifest

Public - no authentication. Powers the [`/download`](../../desktop/download.md) page with the newest desktop release's installer list.

The backend fetches the latest published GitHub Release once, caches it for a few minutes, and serves the last good response if GitHub is briefly unreachable - so the download page always reflects the current build without a frontend redeploy, and the browser never has to call GitHub directly.

### Response shape

```json
{
  "success": true,
  "data": {
    "version": "1.0.0",
    "tag": "v1.0.0",
    "publishedAt": "2026-09-01T12:00:00Z",
    "releaseNotesUrl": "https://github.com/OWNER/REPO/releases/tag/v1.0.0",
    "assets": [
      {
        "name": "Corvale_1.0.0_x64_en-US.msi",
        "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/Corvale_1.0.0_x64_en-US.msi",
        "sha256": "676ecbfa...",
        "sizeBytes": 7827456
      }
    ]
  }
}
```

Only installer files are listed (`.msi`, `.exe`, `.dmg`, `.deb`, `.rpm`, `.AppImage`); `latest.json`, signatures, and checksum files are filtered out. `sha256` is `null` for any asset GitHub has no digest for. The `/download` page maps these assets to each platform's primary and alternate downloads.

### Errors

| Status | When |
|--------|------|
| `502` | The release data can't be retrieved from GitHub and nothing is cached yet |

The web page falls back to a version baked in at build time whenever this endpoint is unavailable.

### Response headers

`Cache-Control: public, max-age=300` - safe for a browser or CDN to hold briefly, since the data only changes when a release is published.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Getting the Desktop App](../../desktop/download.md)
- [Automatic Updates](../../desktop/auto-updates.md)
- [Building the Desktop App](../guides/desktop-app.md)
