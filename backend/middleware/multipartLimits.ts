/**
 * SEC-62: multer's per-request `fields` and `parts` counts default to `Infinity` and `fieldSize`
 * to 1 MB, so a multipart request can carry unbounded (or large) text fields even when the file
 * size is capped. Every uploader in this app takes at most one file plus a couple of short text
 * fields — an id, an enum, a flag — so these caps are deliberately tight. Spread into each
 * `multer({ limits })` alongside the route's own `fileSize` / `files` limit.
 */
export const MULTIPART_TEXT_LIMITS = {
    fields: 8,
    parts: 9,
    fieldSize: 64 * 1024,
    fieldNameSize: 200,
} as const
