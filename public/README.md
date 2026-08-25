# Static assets

Anything in this folder is served from the site root, with the `public/` prefix
stripped:

| File | URL |
| --- | --- |
| `public/screenshots/sio-export.png` | `/screenshots/sio-export.png` |
| `public/favicon.ico` | `/favicon.ico` |

Reference them by that URL, never by a filesystem path. On deploy these are
copied to `.open-next/assets` and served by the Worker's `ASSETS` binding, so
they never hit the server function.

Keep screenshots reasonably small — they are bundled into the Worker upload.
A PNG over ~1 MB is worth compressing first.
