# Local filesystem library

Side One can import Spotify metadata into a private, filesystem-backed
library and attach audio files that you own or are authorized to keep. It does
not use a database, cloud storage, or a hosted processing service.

The Spotify request and cover download require a network connection during the
import. Once the metadata, cover, and audio files are present locally, browsing
and playback use only local files.

## Start the local experience

Create a Spotify developer application and add this redirect URI:

```text
http://127.0.0.1:4317/v1/spotify/callback
```

Add the credentials to the gitignored `.env.local` file:

```dotenv
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

To enable automatic audio during import and the manual download tools, install
`yt-dlp` and FFmpeg.
On macOS with Homebrew:

```bash
brew install yt-dlp ffmpeg
```

If the standalone macOS `yt-dlp` binary starts slowly during catalog matching,
use the repository's Python launcher instead:

```bash
python3.12 -m pip install --upgrade --target .local-tools/python \
  "yt-dlp[default]"
YT_DLP_PATH="$PWD/scripts/yt-dlp-local.sh"
```

The launcher accepts any Python 3.10-or-newer interpreter and also honors an
explicit `YT_DLP_PYTHON_PATH`. The `default` dependency group installs the
matching `yt-dlp-ejs` challenge scripts.

The helper uses `yt-dlp` and `ffmpeg` from `PATH` by default. Set
`YT_DLP_PATH` to an explicit `yt-dlp` executable and `FFMPEG_PATH` to an
FFmpeg executable or directory when they live elsewhere.

The helper gives yt-dlp its own Node executable as the JavaScript challenge
runtime. Override that only when needed:

```dotenv
YT_DLP_JS_RUNTIME=node:/absolute/path/to/node
YT_DLP_EJS_PATH=/absolute/path/to/yt_dlp_ejs
```

An immediate YouTube HTTP 403 is retried once over IPv4. A repeated 403 is
reported as a PO-token, authorized-cookie, or network problem instead of being
retried indefinitely. The app never reads browser cookies automatically.

The default development command starts the loopback helper, waits for it to
become ready, and then starts the application:

```bash
npm run dev
```

`npm run dev:local` is an equivalent alias. `npm run start` applies the same
music-service guarantee to the built production server. Use `npm run dev:app`
or `npm run start:app` only for an intentional metadata-only session without
the local music helper.

The helper binds to `127.0.0.1:4317`; it is not exposed to the network. Set
`LOCAL_VINYL_LIBRARY_DIR` to move the media root or
`NEXT_PUBLIC_LOCAL_LIBRARY_URL` to change the browser-facing helper URL.

When the frontend is hosted, allow only its exact HTTPS origin to call the
loopback helper:

```dotenv
LOCAL_LIBRARY_HOSTED_ORIGINS=https://side-one-vinyl.vercel.app
```

Multiple exact origins may be comma-separated. Localhost origins remain
allowed automatically. Wildcards and origins containing paths, credentials,
queries, or fragments are ignored. `LOCAL_LIBRARY_HOSTED_ORIGINS` is merged
with the optional runtime `LOCAL_LIBRARY_ALLOWED_ORIGINS` value so a temporary
development override cannot remove the hosted site.

If the hosted app reports that it could not reach the helper, stop any existing
Side One process and restart it. Startup validates the configured origins
before reusing a helper that is already listening on port 4317.

## Import a pressing

1. Choose **Import music**.
2. Paste a Spotify track, album, or playlist URL.
3. Optionally select local audio files in track order. Filenames are sorted
   numerically before they are matched.
4. Leave **Find and save missing audio automatically** on if you want the
   helper to fill any tracks without uploaded files, then confirm that you own
   the media or have permission to keep it.
5. Choose **Import music**.

A track becomes a 45 RPM single. Albums and playlists preserve their original
order, fill virtual sides to approximately 22 minutes, use at most sides A–D
per pressing, and split longer collections into numbered volumes.

Playlist metadata requires a local Spotify connection. Use the dialog's
**Connect Spotify** link and finish the authorization in the new browser tab.
The refresh token is stored in the local library directory with owner-only file
permissions.

With automatic audio enabled, the import searches only the newly imported
release, queues verified high-confidence matches, and saves them sequentially.
Low-confidence matches remain in the review queue. The ownership confirmation
is never remembered or checked automatically. Turn automatic audio off to
create the sleeve and track listing without downloads; select files and import
the same Spotify URL again to attach them to the existing manifests.

## Match the catalog and save authorized audio

Choose **Manage audio for music already on the shelf** from the **Import music**
dialog to prepare every release already displayed on the shelf. The browser
first syncs the seven seed records and all 94 tracks into the loopback helper,
then includes any Spotify imports already stored there.
**Match catalog** searches YouTube through the local `yt-dlp` executable with
title, artist, and official-audio query variants. It scores each candidate
using:

- track-title and artist coverage;
- channel or Topic attribution;
- expected duration tolerance;
- official-audio signals; and
- penalties for covers, karaoke, reactions, remixes, live versions, speed
  changes, and other misleading qualifiers.

Five searches can run concurrently within one record. A strong result is
marked **Matched**, an uncertain result is marked **Review**, and unrelated
fallbacks are rejected. Only verified matches enter the batch download queue.
The manager displays the chosen YouTube link and confidence so it can be
checked before downloading.

After confirming that you own the media or have permission to keep it,
**Download matched** processes the verified queue one track at a time. Each
successful MP3 is attached by its stable record and track IDs, not by its
position in the queue. The helper returns the saved filename, source URL, byte
count, and acquisition type with that exact track. The album list marks only
that song as **Local**, and the same track becomes playable through the existing
turntable interface. Local playback URLs include the file update timestamp, so
replacing a recording cannot reuse a stale browser-cached version. Failed
downloads stop the batch with the completed files intact, refresh those
completed rows in the main UI, and can be retried without redownloading ready
tracks.

## Download one authorized track with yt-dlp

Open a local pressing, select the target track, and choose **Download with
yt-dlp**. Paste one direct YouTube video URL and confirm that you own the media
or have permission to download and keep it.

The loopback helper validates the video URL, rejects playlists and search URLs,
and starts `yt-dlp` without a command shell. `yt-dlp` downloads one video,
FFmpeg converts the audio to MP3, and the result passes through the same
signature and 500 MB checks as a manually selected file. Downloading again for
the same track replaces its previous local audio.

Media transfers use a 45-second socket timeout, ten download and fragment
retries, and capped exponential backoff. If a media host still exhausts those
retries with a read timeout, the helper makes one bounded IPv4 fallback with a
60-second socket timeout before returning an actionable network error. The
existing 15-minute process timeout still applies to each attempt.

Automatic search does not bypass the ownership confirmation and does not
download low-confidence candidates. Use both the catalog queue and manual
flow only for authorized media and in accordance with the source platform's
terms.

## Filesystem layout

The default root is `.local-vinyl-library/`, which is gitignored:

```text
.local-vinyl-library/
├── catalog.json
├── spotify-session.json
├── staging/
└── records/
    └── local-album-<stable-id>/
        ├── manifest.json
        ├── cover.jpg
        └── tracks/
            ├── 001-first-track.mp3
            └── 002-second-track.mp3
```

Each record manifest is the durable source of truth. `catalog.json` is rebuilt
by scanning those manifests whenever the helper starts or a record changes.
Incomplete imports stay in `staging/` and never enter the visible catalog.

Audio uploads are limited to 500 MB each and checked for a matching MP3, WAV,
M4A, AAC, Ogg, FLAC, WebM, or MP4 signature. Playback responses support byte
ranges so the existing player can seek without loading an entire file.

## Album artwork

The original square album image is saved once per virtual pressing. Its
filename, content type, byte count, and modification time are persisted in the
record manifest. Browser URLs include that stable modification time as a
revision, so a saved cover remains cacheable across restarts without reusing an
older non-WebGL response. Legacy manifests receive this metadata from the
existing local file the next time the helper starts.

Album and playlist artwork is assigned to `coverImage`; their generated back
surface remains available for the track list. A single uses the image on both
sides. The spine and vinyl label remain deterministic procedural artwork.

The helper validates the saved file before advertising its URL. If the file is
missing, corrupt, or cannot be decoded after one cache-bypassing retry, the
record and its songs stay in the catalog while the procedural surface remains
visible.

## Remove local media

Open an imported record and choose **Remove local pressing**. After confirmation
the record directory, attached audio, and cached artwork are deleted, and the
catalog is rebuilt. Starter records under `public/records/` are never affected.

## Verify

Run:

```bash
npm run test:local-library
npm run check
npm run security:audit
```

The focused local-library tests use an isolated temporary directory, a mocked
Spotify response, controlled YouTube search results, and a fake yt-dlp runner.
They prove metadata and artwork import, candidate scoring, authorization
enforcement, yt-dlp output ingestion, raw audio upload, HTTP range playback,
restart persistence, and deletion without starting or connecting to a
database or downloading internet media. A full-catalog regression syncs,
matches, downloads, and verifies all 94 existing track slots with authorized
fixture audio.
