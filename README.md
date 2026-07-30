# Side One

Side One is a tactile Three.js vinyl catalog and local music player. Browse a
shelf, bring a sleeve forward, inspect the pressing, choose a track, and watch
the record move to a turntable before the needle drops.

The included catalog contains seven factual releases and nine physical
pressings: *The Essential Bob Dylan*, LANY, Louis The Child's *The Sun Comes
Up*, Fleetwood Mac's *Rumours*, Pink Floyd's *The Dark Side of the Moon*, and
Miles Davis's *Kind of Blue*, plus Frank Sinatra's *In the Wee Small Hours*.
Every entry includes its complete vinyl-side track sequence and official
listening or release links. Commercial recordings are not bundled.

## Features

- Browse with drag, wheel, arrow keys, Home, End, or the collection index.
- See the full catalog together in an open walnut record cabinet with a
  deliberate air gap between every shelved sleeve.
- Read the selected cover flat to the camera as a thin, open-sided cardstock
  jacket with physical seams and paper edges.
- Preserve a collision-safe retreat, rotate, shelve, extract, rotate, settle
  handoff between records.
- Open every sleeve into a deterministic face-on inspection composition while
  the pocket mouth flexes and the pressing slides into its staged position.
- Replace generated front, back, and label art independently; failed optional
  images fall back to deterministic procedural artwork.
- Browse complete album track lists and select the correct pressing across
  single-LP A/B and double-LP A–D releases.
- Load one preview source at a time through a reusable media element and Web
  Audio analyser.
- Remove the vinyl, move it to the platter, lower the tonearm, follow the groove
  while playing, and reverse the sequence on stop.
- Watch the pressing clear the sleeve mouth before it lifts toward the player;
  the accessible center control follows the record and becomes Pause while it
  spins.
- Return the pressing through the same sleeve path before the closed jacket
  moves back into the archive.
- Start playback from an accessible control anchored to the exposed record
  label, then hand off to the persistent transport controls.
- Pause, seek, change tracks, adjust volume, or return to the shelf without
  creating competing animation loops.
- Choose a player chassis in Settings without replacing the precision platter,
  spindle, or articulated tonearm mechanism.
- Respect keyboard navigation, visible focus, touch input, safe areas, and
  reduced-motion preferences.

On narrow screens, the browse camera keeps the complete shelf lineup visible;
inspection prioritizes the centered sleeve, track list, compact player, and a
scaled turntable stage.

## Quick start

Node.js 22.13 or newer is required.

```bash
npm ci
npm run dev
```

The default development and production-start commands start the private
loopback music service, wait for it to respond, and then start the app. If the
music service is already running, it is reused. Use `npm run dev:app` or
`npm run start:app` only when you deliberately want the app without local
music.

To enable Spotify imports, add Spotify developer credentials to `.env.local`,
register
`http://127.0.0.1:4317/v1/spotify/callback`, and run:

```bash
npm run dev
```

`npm run dev:local` remains an alias for the same combined startup flow.

The single **Import music** action reads Spotify track, album, or playlist
metadata, caches the cover on this computer, and can attach audio files the
user owns. With automatic audio enabled and an explicit ownership or permission
confirmation, the same import immediately searches for high-confidence matches
and saves them sequentially with local `yt-dlp` and FFmpeg. Uncertain matches
stay in the review queue and are never downloaded automatically.

The import dialog also opens the catalog audio manager for releases already on
the shelf. It syncs all seven catalog releases into the private helper, includes
Spotify imports, ranks likely official audio by title, artist, channel, and
duration, and keeps uncertain results out of the automatic download queue.
Individual tracks still accept a manually selected direct YouTube video URL.
Manifests, artwork, audio, matches, and authorization state stay beneath the
gitignored `.local-vinyl-library/` directory on this computer. Successfully
attached songs receive a **Local** marker in their album track list; the
association uses stable record and track IDs rather than queue position.

See [Local filesystem library](docs/local-library.md) for setup, file layout,
playlist authorization, limits, deletion, and tests.

The seed catalog is metadata-only. For contributor-owned records that configure
local `previewUrl` values, the project can deterministically generate
placeholder WAV files:

```bash
npm run generate:previews
```

That command writes an 18-second mono PCM WAV to every configured
`previewUrl`. It does nothing to the seven bundled commercial releases and
overwrites configured local previews, so do not run it after replacing those
files with custom audio unless that is intentional.

## Controls

In browse mode:

- Drag or scroll to move through the archive.
- Use Left/Right, Home, or End when the canvas has keyboard focus.
- Press Enter or click **View record** to inspect the centered record.
- A short pointer movement is treated as a click; a shelf swipe is not.

In inspect mode:

- Drag to orbit, scroll to zoom, and use **Reset view** to restore framing.
- Select a track, then play from the record label or use the persistent
  Play/Pause, Stop, seek, and volume controls.
- For linked commercial releases without bundled audio, select any track to
  update the disc and label, then use the official listening links.
- Press Escape or choose **Back to collection**. Active playback is stopped and
  the vinyl is reinserted before the sleeve returns to the shelf.

## Add your own records

The short version:

1. Add a `CatalogRecord` to
   [`app/record-catalog.ts`](app/record-catalog.ts).
2. Put optional media under `public/records/<record-id>/`.
3. Reference browser paths such as
   `/records/<record-id>/cover.webp` and
   `/records/<record-id>/preview-track-name.wav`.
4. Update [`app/site-config.ts`](app/site-config.ts) when changing the product
   name, descriptive copy, labels, social metadata, or theme.
5. Run `npm run check` and `npm run security:audit`.

Images are optional. The palette, motif, release metadata, and track list are
enough to generate a complete sleeve, spine, back cover, and record label.

See [Adding records](docs/adding-records.md) for the complete field reference,
asset guidance, audio licensing checklist, preview generator behavior, and a
copy-paste example.

## Architecture

The application keeps durable interface state separate from frame-level visual
state:

- `app/VinylLibrary.tsx` owns React-facing catalog selection, scene mode,
  playback state, accessible controls, and status announcements.
- `app/RecordShelfEngine.ts` is the sole owner of the renderer, scene, camera,
  OrbitControls, ResizeObserver, raycaster, repeating animation frame, visual
  choreography, diagnostics, and Three.js disposal.
- `app/record-motion.ts` contains pure browse, focus, collision, vinyl, and
  tonearm pose functions.
- `app/sleeve-model.ts` builds the layered cardstock jacket, pocket opening,
  paper seams, and artwork surfaces.
- `app/turntable-model.ts` builds the articulated hi-fi deck from named,
  replaceable functional parts and owns the shared pressing/spindle dimensions.
- `app/audio/playback-state.ts` contains the pure playback reducer.
- `app/audio/VinylAudioController.ts` owns one `HTMLAudioElement` and its lazy
  Web Audio source, gain, and analyser graph.
- `app/audio/audio-visualizer.ts` contains allocation-conscious analyser band
  helpers.
- `app/record-art.ts` creates deterministic Canvas textures.
- `app/record-catalog.ts` defines record and track data.
- `app/local-library.ts` connects the client to the loopback filesystem helper.
- `services/local-library/` imports metadata and artwork, scans manifests,
  matches YouTube candidates, accepts authorized local audio, and serves
  seekable media without a database.
- `app/site-config.ts` centralizes product copy and theme tokens.

The scene and playback state machines remain separate. The engine samples the
analyser inside its existing frame loop, so the platter, tonearm, record glow,
and visualizer do not start another render loop.

For the object hierarchy, state transitions, collision model, cue sequence,
reduced-motion behavior, performance decisions, and tuning constants, read
[Motion, audio, and animation](docs/animation-system/README.md).

## Development diagnostics

The client exposes a safe command surface after initialization:

```js
window.__VINYL_LIBRARY__.diagnostics()
window.__VINYL_LIBRARY__.browse(3)
window.__VINYL_LIBRARY__.focus(3)
window.__VINYL_LIBRARY__.play("dumb-stuff")
window.__VINYL_LIBRARY__.pause()
window.__VINYL_LIBRARY__.stop()
window.__VINYL_LIBRARY__.resetView()
window.__VINYL_LIBRARY__.returnToShelf()
```

`diagnostics()` reports scene and playback modes, browse/cue phase, selection,
draw calls, triangles, geometry and texture counts, pixel ratio, collisions,
audio-band levels, and canvas dimensions. It does not expose mutable Three.js
objects or audio internals.

## Verification

Before submitting a change, run:

```bash
npm run check
npm run security:audit
```

`npm run check` lints, type-checks, builds, runs server and pure-state
regressions, samples collision-safe motion paths, validates catalog assets and
audio behavior, and checks the vendored Mint tooling.

For rendering or interaction changes, also exercise the production build in a
real browser. Verify the complete browse → inspect → cue → listen → seek or
pause → stop → return journey at desktop size and around 390 × 844. Check the
console, failed network requests, audio unlock, focus order, reduced motion,
canvas pixels, diagnostics, and resizing.

## Assets and rights

Only commit artwork, recordings, descriptions, marks, and other media you
created or are authorized to redistribute. Public availability is not an
open-source license.

The preview generator uses oscillators and deterministic noise; it does not
read sample libraries or third-party recordings. The bundled cover images are
catalog-display copies sourced through the Cover Art Archive and remain the
property of their respective rights holders. The application does not bundle
commercial audio. See [Third-party notices](THIRD_PARTY_NOTICES.md) and the
licensing section in [Adding records](docs/adding-records.md).

## Deployment

Local development requires no database, media service, or deployment account.
All starter assets are local. If this checkout is connected to OpenAI Sites,
the machine-specific project association lives in the gitignored
`.openai/hosting.json`; see [the local deployment note](.openai/README.md).

The package remains marked `"private": true` to prevent accidental npm
publication.

## Mint agent tooling

Mint is optional and is not used by the browser runtime or the default
procedural collection.

- `.codex/config.toml` registers the repo-scoped
  [Mint MCP server](https://mcp.mint.gg/) for development-time asset work.
- `.agents/skills/mint-threejs-skills` vendors
  [Mint Three.js Skills](https://github.com/mintdotgg/mint-threejs-skills).

If a future change imports a Mint artifact, keep `mint-assets.json` synchronized
with `scripts/sync-mint-assets.mjs` and use the shared Draco-capable loader for
Mint-optimized GLBs. Never add credentials, OAuth state, private account data,
or temporary download URLs.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
security issues through the private process in [SECURITY.md](SECURITY.md).
