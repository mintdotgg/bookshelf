# Motion, audio, and animation

Needle Archive coordinates a shelf, sleeve inspection, turntable, audio
playback, and accessible HTML without giving multiple systems ownership of the
same frame. React owns durable interface state, `RecordShelfEngine` owns visual
transition progress, `VinylAudioController` owns browser audio, and pure
functions define legal state changes and spatial poses.

There is no general-purpose tweening library and no secondary waveform or
turntable animation loop.

## Source map

- `app/RecordShelfEngine.ts` owns Three.js, input, scripted cameras, the one
  repeating `requestAnimationFrame`, visual playback state, analyser sampling,
  diagnostics, and disposal.
- `app/record-motion.ts` contains pure shelf poses, separating-axis collision
  math, vinyl transport poses, and tonearm poses.
- `app/VinylLibrary.tsx` coordinates engine callbacks, audio callbacks, React
  state, accessible controls, status announcements, and pending user intent.
- `app/audio/playback-state.ts` defines the pure playback reducer and rejects
  stale media events by request ID.
- `app/audio/VinylAudioController.ts` owns one reusable `HTMLAudioElement` and
  its lazy `MediaElementAudioSourceNode → GainNode → AnalyserNode → destination`
  graph.
- `app/audio/audio-visualizer.ts` supplies pure log-band sampling and
  frame-rate-independent smoothing helpers.
- `app/record-art.ts` supplies deterministic front, back, spine, and label
  canvases.
- `app/record-catalog.ts` supplies dimensions, pressing materials, track
  metadata, and local media URLs.
- `app/globals.css` projects durable scene and playback classes into responsive
  HTML transitions.

## Ownership boundaries

`RecordShelfEngine` is the only owner of:

- `WebGLRenderer`, scene, camera, OrbitControls, and ResizeObserver;
- raycasting and pick proxies;
- record, platter, tonearm, and camera transforms;
- browse, focus, cue, and return progress;
- the repeating animation frame and render call;
- canvas diagnostics and Three.js resource disposal.

React receives meaningful changes such as selected index, scene mode, playback
mode, error, and status. It does not receive object positions, rotations,
platter angles, analyser arrays, or other per-frame values.

`VinylAudioController` owns media loading, audio-context unlock, playback,
seeking, gain, analyser sampling, cancellation, and audio disposal. It exposes
snapshots and callbacks; it never moves scene objects.

## Object hierarchy

Each album uses presentation wrappers that keep shelf motion independent from
the visual source:

```text
scene
├── shelfGroup                         horizontal browse translation
│   ├── shelfFurniture                 walnut shelf and rails
│   └── slot                           permanent catalog x-position
│       └── content                    browse/focus x, z, yaw, scale
│           └── inspectionIdle         reduced-motion-aware idle transform
│               ├── sleeve             jacket and front/back/spine surfaces
│               └── pickProxy          one invisible raycast box
├── vinyl                              independently transported pressing
│   ├── disc, label, spindle hole
│   ├── groove and optional marbling details
│   └── reactive glow
└── turntable
    └── turntableBase
        ├── plinth and controls
        ├── platter                    independent spin
        ├── tonearmPivot
        │   └── tonearmLift            independent yaw and cue height
        └── reactive rings
```

The slot never animates locally. `content` receives the album presentation
pose. The vinyl is attached directly to the scene because it must leave the
sleeve and travel to a turntable outside the shelf hierarchy.

Procedural textures exist first. Optional cover, back, and label images replace
only their corresponding texture after a successful load, so media swaps do
not change the animation coordinate system.

## One frame owner

`RecordShelfEngine.animate()` is the only repeating animation loop. Each frame
it:

1. clamps `delta` to at most 50 ms;
2. advances browse, focus, and return state;
3. applies record and inspection-idle poses;
4. advances or reverses cue choreography;
5. samples preallocated analyser data and updates visual response;
6. updates OrbitControls only while enabled;
7. renders once;
8. refreshes diagnostics at most twice per second.

The audio controller returns the same analyser array on every sample. The
engine reduces it into reusable low, mid, and high buckets and damps the visual
response without pushing data through React.

## Separate state machines

Scene choreography and audio playback intentionally use separate state
machines.

```mermaid
stateDiagram-v2
    [*] --> browse
    browse --> focusing: centered record is opened
    focusing --> inspect: focusProgress reaches 1
    inspect --> returning: return requested and vinyl is home
    returning --> browse: focusProgress reaches 0
```

OrbitControls are disabled in `browse`, `focusing`, and `returning`. They are
enabled only after the selected record reaches `inspect`, and disabled again
during scripted cue motion.

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> loading: track source selected
    loading --> paused: media ready
    loading --> cueing: media ready with play intent
    paused --> cueing: Play
    cueing --> playing: needle contact
    playing --> paused: Pause
    playing --> seeking: seek input
    paused --> seeking: seek input
    seeking --> playing: seeked and resume intent
    seeking --> paused: seeked without resume intent
    playing --> stopping: Stop, end, return, or track change
    paused --> stopping: Stop or return
    stopping --> idle: audio stopped and vinyl returned
    loading --> error: missing or failed source
    error --> idle: error cleared
```

The playback reducer increments a request ID for each new source. Media events
from superseded loads are ignored, preventing a late callback from reviving an
old track.

Coordination rules live at the boundary:

- cueing begins only when scene mode is `inspect`;
- one record and one media source are active;
- returning while playback or cue motion is active first starts controlled
  stop and reinsertion;
- selecting another track during cue/play stores the request, reverses the
  current vinyl path, then loads the pending track;
- selecting another album while focused stores the target, returns the current
  album, then focuses the new one;
- missing or failed audio enters `error`, stops cue motion, and restores a
  stable inspect pose;
- repeated play, stop, return, and stale media events are idempotent.

## Browse choreography

All browse inputs converge on `targetScrollIndex`; `scrollIndex` damps toward
that target and drives `shelfGroup.position.x`. After 150 ms without pointer
input, the target damps toward the nearest integer for a magnetic landing.

The visible handoff is discrete:

```mermaid
flowchart LR
    A["Retreat current<br/>110 ms"] -->
    B["Turn current<br/>140 ms"] -->
    C["Shelve current<br/>130 ms"] -->
    D["Extract next<br/>130 ms"] -->
    E["Turn next<br/>140 ms"] -->
    F["Settle next<br/>110 ms"]
```

`browseRecordMotionPose()` samples every phase from normalized progress. The
rotation lane is derived from the largest sleeve’s rotated radius and the
catalog collision margin. A sleeve reaches that clear lane before its yaw
changes.

Raycasting uses one invisible box per record. A pointer gesture must remain
under seven pixels to count as a click, which prevents an archive swipe from
opening a sleeve. Off-center focus intent is stored until the record has
completed its browse handoff.

## Focus and return

Focus takes 500 ms and return takes 380 ms under ordinary motion. Focus first
clears neighboring sleeves, then moves into the inspection composition and
scales. The camera uses exponential, frame-rate-independent smoothing and a
view offset on desktop so the record remains centered in the unobscured canvas
beside the album panel.

Mobile uses a centered, smaller sleeve pose and wider camera. The compact
details/player layout takes priority and the full turntable stage is hidden
below the engine’s 760 px mobile breakpoint.

Return follows the current live `focusProgress` toward zero. It does not reset
the record or camera to a guessed start pose.

## Cue choreography

Cue poses are pure samples from `cueMotionPose(phase, progress, layout,
grooveProgress)`.

```mermaid
flowchart LR
    A["Extract vinyl<br/>580 ms"] -->
    B["Move above platter and settle<br/>880 ms"] -->
    C["Spin up, position arm, lower stylus<br/>820 ms"] -->
    D["Playing<br/>track time drives groove"] -->
    E["Raise arm and spin down<br/>560 ms"] -->
    F["Return to sleeve opening<br/>780 ms"] -->
    G["Reinsert vinyl<br/>500 ms"]
```

The transport phase approaches from above before settling on the platter. The
tonearm first rotates over the selected groove and then lowers; the
`onNeedleContact` callback starts audible playback only when the stylus reaches
contact.

During playback, `currentTime / duration` maps to `grooveProgress`, which moves
the tonearm from lead-in to runout. Seeking raises the arm visually and updates
the groove target. Pausing lifts the stylus slightly and slows the platter
without returning the pressing.

Stop reverses from live progress:

- while lowering or playing, it changes to `raise-tonearm`;
- while moving to the turntable, it reverses into `return-to-sleeve`;
- while extracting, it reverses into `reinsert-vinyl`.

After reinsertion, the engine fires `onVinylReturned` once. A queued track may
then load, or a pending return may begin. This prevents teleports and keeps
repeated commands safe.

## Audio and reactive visuals

The audio graph is created lazily in a user gesture:

```text
HTMLAudioElement
└── MediaElementAudioSourceNode
    └── GainNode
        └── AnalyserNode
            └── AudioContext.destination
```

Only one element and graph are reused across tracks. Loading and seeking
promises are cancellable; stop is promise-coalesced; fades use the gain node.
The controller removes listeners, clears the media source, closes the context,
and rejects pending work during disposal.

While playing, analyser energy affects:

- three rings around the platter;
- platter emissive intensity;
- pressing edge glow and scale;
- stylus emissive intensity.

Audio response falls back smoothly to zero when no analyser is available.

## Collision safety

Before the engine commits a shelf pose, it creates a top-down oriented
rectangle containing:

- the permanent slot plus proposed local offset;
- current yaw and presentation scale;
- sleeve width and thickness;
- the motion layout’s collision margin.

`recordFootprintsOverlap()` applies the separating axis theorem against every
other record. An overlapping pose is rejected and recorded in diagnostics.
Pure tests sample all six browse phases, desktop/mobile focus routes, and cue
poses without requiring WebGL.

Shelved slots share the exported `recordShelfGap`, currently `0.22` scene
units. The presented sleeve offsets slightly left so the full lineup remains
readable, but that lateral move occurs only in the forward rotation lane; the
sleeve returns to its slot center before entering the shelf row.

If catalog sizes move outside the ranges in `docs/adding-records.md`, rerun the
motion tests before changing phase constants or the collision margin.

## Performance and lifecycle

- One renderer, scene, camera, ResizeObserver, raycaster, and repeating frame
  loop have one lifecycle owner.
- Procedural canvases become mipmapped sRGB textures with capped anisotropy.
- Optional images replace and dispose the prior procedural GPU texture.
- Raycasts use simple proxies and an explicit pick list.
- Device pixel ratio is capped at `1.75` on desktop and `1.5` below 760 px.
- One directional light casts shadows; its map is `2048²` on larger screens
  and `1024²` below 700 px.
- Nonselected records and shelf furniture are hidden once focus isolation is
  established.
- Geometries, materials, textures, controls, listeners, observers, audio
  nodes, and renderer resources are disposed at unmount.

## Diagnostics

After client initialization:

```js
window.__VINYL_LIBRARY__.diagnostics()
```

The returned snapshot contains:

- `sceneMode`, `playbackMode`, browse `motionPhase`, and `cuePhase`;
- active and selected indices plus record count;
- cue progress;
- draw calls, triangles, geometries, textures, and pixel ratio;
- collision rejects, last rejected pair, and current collision;
- low, mid, high, and aggregate audio levels;
- drawing-buffer and CSS canvas dimensions.

The same high-level values are mirrored into canvas `data-*` attributes every
500 ms. The command surface also exposes `browse(index)`, `focus(index)`,
`play(trackId?)`, `pause()`, `stop()`, `resetView()`, and `returnToShelf()`.
It does not expose mutable Three.js or Web Audio internals.

Diagnostics aid automated QA but do not replace browser profiling.

## Reduced motion

The engine reads `prefers-reduced-motion` at startup. When enabled:

- each browse phase uses 45% of its normal duration with a 55 ms floor;
- focus and return use 80 ms;
- each cue phase uses 90 ms;
- shelf and camera response becomes stronger;
- inspection idle lift and rotation are disabled.

CSS independently collapses interface transitions. State changes, needle
ordering, error handling, and accessible announcements remain intact even when
the choreography is shortened.

## Safe change checklist

1. Keep `RecordShelfEngine` as the sole owner of frame-level Three.js state.
2. Keep media and Web Audio ownership inside `VinylAudioController`.
3. Put reusable transitions in `playback-state.ts` and reusable spatial math in
   `record-motion.ts`.
4. Preserve the rotation lane before changing sleeve yaw.
5. Keep OrbitControls disabled during scripted camera and cue motion.
6. Preserve request IDs and cancellation when changing audio loading.
7. Test ordinary and unusually thick sleeves, interrupted cue phases, missing
   audio, repeated commands, and track changes.
8. Run:

   ```bash
   npm run check
   npm run security:audit
   ```

9. For rendering changes, verify the production build with real pointer,
   keyboard, wheel, WebGL, and audio input on desktop and around 390 × 844.
10. Inspect `window.__VINYL_LIBRARY__.diagnostics()`, the browser console,
    network requests, canvas pixels, resize behavior, and reduced motion.
