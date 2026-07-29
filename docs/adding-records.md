# Adding records

Each release begins as one `CatalogRecord` in `app/record-catalog.ts`. The same
data drives shelf layout, procedural art, pressing materials, labels,
accessible controls, the details panel, cue speed, and preview playback. No 3D
model or image is required.

## 1. Add a catalog entry

Add an object to `recordCatalog`:

```ts
{
  id: "my-record",
  title: "My Record",
  shortTitle: "My Record",
  artist: "Your Artist Name",
  year: 2026,
  description:
    "A concise description you wrote or are authorized to distribute.",

  label: "Your Label",
  catalogNumber: "YL-001",
  edition: "First pressing · translucent amber",
  genres: ["Ambient", "Electronic"],

  sleeveColor: "#24323a",
  accent: "#e7a85f",
  ink: "#f4edde",
  motif: "signal-bloom",

  sleeveSize: 2.16,
  sleeveThickness: 0.085,

  coverImage: recordAssetUrl("my-record", "cover.webp"),
  backCoverImage: recordAssetUrl("my-record", "back.webp"),
  labelImage: recordAssetUrl("my-record", "label.webp"),

  vinylColor: "#313b41",
  vinylOpacity: 0.82,
  vinylMarbling: true,
  rpm: 33.333,

  tracks: [
    {
      id: "first-light",
      title: "First Light",
      trackNumber: 1,
      side: "A",
      duration: 18,
      previewUrl: recordAssetUrl("my-record", "preview-first-light.wav"),
    },
    {
      id: "evening-return",
      title: "Evening Return",
      trackNumber: 2,
      side: "B",
      duration: 18,
      previewUrl: recordAssetUrl("my-record", "preview-evening-return.wav"),
    },
  ],

  links: [
    {
      label: "Release notes",
      url: "https://example.com/my-record",
    },
  ],
  featured: true,
}
```

Import and use `recordAssetUrl` from the same module, or write equivalent
root-relative browser URLs yourself.

### Record fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | Yes | Unique lowercase URL-safe key used by React, diagnostics, and the asset directory. |
| `title` | Yes | Full release title in the details view and generated artwork. |
| `shortTitle` | Yes | Compact title used on the spine and status text. |
| `artist` | Yes | Displayed in browse, details, and procedural art. |
| `year` | Yes | Release year. |
| `description` | Yes | Original or licensed descriptive copy for the details panel and back cover. |
| `label` | No | Label or imprint shown in release metadata. |
| `catalogNumber` | No | Catalog identifier used by procedural art and metadata. |
| `edition` | No | Human-readable pressing description. |
| `genres` | Yes | Genre labels displayed as metadata. |
| `sleeveColor` | Yes | Sleeve material and generated-art background color. |
| `accent` | Yes | Motif, material sheen, pressing details, and reactive glow color. |
| `ink` | Yes | Primary generated-art text and detail color. |
| `motif` | Yes | Deterministic procedural design family. |
| `sleeveSize` | No | Square sleeve width/height in scene units; defaults to `2.16`. |
| `sleeveThickness` | No | Jacket thickness in scene units; defaults to `0.085`. |
| `coverImage` | No | Browser URL for owned front-cover artwork. |
| `backCoverImage` | No | Browser URL for owned back-cover artwork. |
| `labelImage` | No | Browser URL for owned record-label artwork. |
| `vinylColor` | Yes | Pressing material color. |
| `vinylOpacity` | No | Pressing opacity from `0` to `1`; defaults to opaque. |
| `vinylMarbling` | No | Adds deterministic colored arc details when true. |
| `rpm` | Yes | Either `33.333` or `45`; controls platter rotation. |
| `tracks` | Yes | Ordered preview tracks for this release. |
| `links` | No | HTTPS links shown in the details panel. |
| `featured` | No | Catalog-level flag available for custom presentation rules. |

Existing sleeves use sizes around `2.12`–`2.20` and thicknesses around
`0.078`–`0.096`. The rotation lane adapts to catalog dimensions, but extreme
values change shelf spacing and collision envelopes and must be retested. The
shared `recordShelfGap` in `app/record-motion.ts` controls the visible air
between sleeves; keep the engine and collision tests on that same value.

Available motifs are:

```text
signal-bloom, tidal-lines, night-grid, cut-paper, orbit-cluster,
magnetic-field, glass-prism, topographic
```

Colors accept CSS color strings. The included catalog uses six-digit hex
colors because the procedural gradients also derive transparent variants from
them.

### Track fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | Yes | Stable track key, unique within the record. |
| `title` | Yes | Track title shown in the list and player. |
| `trackNumber` | Yes | Numeric order printed on procedural art. |
| `side` | No | `"A"` or `"B"` for display and label filtering. |
| `duration` | No | Expected preview duration in seconds before media metadata loads. |
| `previewUrl` | No | Browser URL for audio the project may redistribute. |

Omitting `previewUrl` is supported. Selecting or trying to play that track
produces a useful error and leaves the album in a stable inspect pose; it does
not wait indefinitely. An unreadable or failed source is handled the same way
and initiates the controlled vinyl-return path if cueing had begun.

Catalog order is source order. Moving an object in `recordCatalog` changes its
shelf position and diagnostics index.

## 2. Organize local assets

Use one directory per stable record ID:

```text
public/
└── records/
    └── my-record/
        ├── cover.webp
        ├── back.webp
        ├── label.webp
        ├── preview-first-light.wav
        └── preview-evening-return.wav
```

Files in `public/` are referenced without the `public` segment:

```ts
recordAssetUrl("my-record", "cover.webp")
// "/records/my-record/cover.webp"
```

Local same-origin files are recommended. Remote images and audio must allow
cross-origin access; the audio controller requests anonymous CORS access so it
can connect the media element to Web Audio.

Do not put secrets, signed temporary URLs, private storage credentials, or
provider asset IDs in the catalog.

## 3. Choose artwork

### Procedural artwork

Omit `coverImage`, `backCoverImage`, and `labelImage`. `app/record-art.ts`
creates deterministic front, back, spine, and label canvases from the record
ID, palette, motif, metadata, and track list.

This is the simplest option for a public fork. The same catalog entry always
produces the same motif and grain.

### Owned artwork

Set any image field independently. A practical source target is:

- front and back: square WebP or AVIF, about 1600 × 1600, preferably below
  500 KB each;
- label: square WebP or PNG, about 1024 × 1024, with essential content inside a
  centered circle;
- color space: sRGB.

The engine first creates procedural textures, then swaps in optional images
after they load. If an image is missing, unreadable, or blocked by CORS, the
generated texture remains visible and the status area reports the fallback.
There is no custom spine image field; the spine is always generated from
metadata.

Keep titles and artist names in catalog data even when they appear in the art.
The surrounding HTML remains the accessible source of essential information.

## 4. Add or generate previews

The committed starter previews are 18-second, mono, 22.05 kHz, 16-bit PCM WAV
files. WAV is intentionally simple and broadly decodable. You may replace them
with authorized WAV, MP3, AAC, or Ogg previews, but browser codec support
varies; test every target browser and use a filename extension matching the
actual encoding.

To rebuild deterministic starter audio:

```bash
npm run generate:previews
```

`scripts/generate-record-previews.mjs` imports `recordCatalog`, synthesizes each
track from its record ID, track ID, and track number, and writes a PCM WAV to
the local file represented by `previewUrl`. It uses oscillators and generated
noise, not external samples.

Important:

- The generator overwrites every configured preview file.
- Generator output is WAV data, so generator-targeted URLs must end in `.wav`.
- If you add a record and want generated previews, add its `.wav` URLs first,
  then run the command and commit the resulting files.
- If you replace previews with mastered or licensed recordings, keep backups
  and do not run the generator over those paths.
- Set `duration` to the actual clip duration; runtime media metadata becomes
  authoritative once loaded.

Browsers require a user gesture before audible Web Audio playback. Play and
keyboard activation unlock the audio context; code should not attempt to
autoplay on page load.

## 5. Verify rights

Before committing any record, confirm that:

- the record, artist, label, and track names are original, factual, or licensed;
- the description is yours or licensed for redistribution;
- each artwork file is yours, licensed for redistribution, or in the public
  domain;
- each preview recording, composition, performance, and embedded sample is
  cleared for the repository and its deployments;
- the license permits redistribution, not merely streaming or personal use;
- attribution and notice requirements are added to
  `THIRD_PARTY_NOTICES.md`;
- external links are intentional and use HTTPS;
- no credentials or temporary private URLs are present.

Public availability, a purchased copy, and a streaming subscription do not
grant redistribution rights. When in doubt, use the procedural artwork and
preview generator.

## 6. Change branding

Edit `app/site-config.ts` to change document metadata, application name,
wordmark, collection name, UI labels, social-image alternative text,
independence note, and theme tokens. Replace `public/social-card.webp` and
other icons with media you own if the identity changes.

Catalog artwork does not depend on the Needle Archive wordmark, so a fork can
rebrand without altering record art.

## 7. Validate

Run:

```bash
npm run check
npm run security:audit
```

Then run the production experience in a browser and check:

1. the new record appears in the expected source order;
2. browse and focus routes remain collision-free;
3. procedural and optional image faces have the correct orientation;
4. both tracks load, cue, play, pause, seek, stop, and return;
5. changing tracks while playing restores the current vinyl first;
6. a missing preview produces a stable, announced error;
7. keyboard, pointer, touch-emulated, and reduced-motion paths work;
8. the desktop and approximately 390 × 844 layouts remain usable;
9. `window.__VINYL_LIBRARY__.diagnostics()` reports no current collision and
   reasonable renderer counts;
10. there are no unexpected console or network errors.

If you add 3D assets later, follow the vendored Mint skill’s asset registry and
GLTF compatibility guidance. Mint-optimized GLBs require the project’s shared
Draco-capable loader; a bare `GLTFLoader` is not sufficient.
