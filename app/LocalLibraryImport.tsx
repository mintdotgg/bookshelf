"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CatalogRecord } from "./record-catalog";
import {
  downloadLocalTrackFromYouTube,
  fetchLocalDownloaderStatus,
  fetchLocalSpotifyStatus,
  importSpotifyMetadata,
  localLibraryOrigin,
  LocalLibraryApiError,
  matchLocalRecord,
  uploadLocalTrack,
  type LocalDownloaderStatus,
  type LocalSpotifyStatus,
} from "./local-library";

type LocalLibraryImportProps = {
  open: boolean;
  onClose: () => void;
  onLibraryChanged: () => Promise<void>;
  onImportComplete: (records: CatalogRecord[]) => Promise<void>;
  onOpenAudioManager: () => void;
};

function sortFiles(files: File[]) {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function recordTrackKey(recordId: string, trackId: string) {
  return `${recordId}:${trackId}`;
}

function summarizeImportedAudio(
  records: CatalogRecord[],
  uploadedTrackKeys: Set<string>,
) {
  const tracks = records.flatMap((record) =>
    record.tracks.map((track) => ({
      ...track,
      uploaded: uploadedTrackKeys.has(recordTrackKey(record.id, track.id)),
    })),
  );
  const ready = tracks.filter((track) => track.previewUrl || track.uploaded);
  const review = tracks.filter(
    (track) =>
      !track.previewUrl &&
      !track.uploaded &&
      track.youtubeMatch &&
      !track.youtubeMatch.verified,
  );
  const missing = tracks.filter(
    (track) =>
      !track.previewUrl && !track.uploaded && !track.youtubeMatch,
  );
  return {
    ready: ready.length,
    review: review.length,
    missing: missing.length,
    total: tracks.length,
  };
}

export function LocalLibraryImport({
  open,
  onClose,
  onLibraryChanged,
  onImportComplete,
  onOpenAudioManager,
}: LocalLibraryImportProps) {
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Paste a Spotify URL to create a local virtual pressing.",
  );
  const [error, setError] = useState<string | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [spotifyStatus, setSpotifyStatus] =
    useState<LocalSpotifyStatus | null>(null);
  const [downloaderStatus, setDownloaderStatus] =
    useState<LocalDownloaderStatus | null>(null);

  const sortedFiles = useMemo(() => sortFiles(files), [files]);
  const downloaderReady = downloaderStatus?.ready === true;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDownloaderStatus(null);
    });
    void fetchLocalSpotifyStatus()
      .then((nextStatus) => {
        if (!cancelled) setSpotifyStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) setSpotifyStatus(null);
      });
    void fetchLocalDownloaderStatus()
      .then((nextStatus) => {
        if (!cancelled) setDownloaderStatus(nextStatus);
      })
      .catch((caught) => {
        if (cancelled) return;
        const message =
          caught instanceof Error
            ? caught.message
            : "Downloader preflight failed.";
        setDownloaderStatus({
          ready: false,
          ytDlp: { ready: false, version: null, error: message },
          ffmpeg: { ready: null, version: null, error: null },
          jsRuntime: {
            ready: null,
            version: null,
            error: null,
            name: null,
          },
          ejs: { ready: null, version: null, error: null },
          issues: [message],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!spotifyUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    setRetryAvailable(false);
    setStatus("Reading Spotify metadata and saving the cover locally");
    let libraryNeedsRefresh = false;
    let automaticAudioReady = downloaderReady;

    try {
      if (!downloaderStatus) {
        const latestDownloaderStatus = await fetchLocalDownloaderStatus().catch(
          () => null,
        );
        if (latestDownloaderStatus) {
          setDownloaderStatus(latestDownloaderStatus);
          automaticAudioReady = latestDownloaderStatus.ready;
        }
      }
      const imported = await importSpotifyMetadata(spotifyUrl);
      libraryNeedsRefresh = true;
      const importedTracks = imported.records.flatMap((record) =>
        record.tracks.map((track) => ({ record, track })),
      );
      const uploadedTrackKeys = new Set<string>();
      const latestRecords = new Map(
        imported.records.map((record) => [record.id, record]),
      );
      await onLibraryChanged();
      libraryNeedsRefresh = false;

      if (sortedFiles.length) {
        const uploadCount = Math.min(sortedFiles.length, importedTracks.length);
        for (let index = 0; index < uploadCount; index += 1) {
          const file = sortedFiles[index];
          const target = importedTracks[index];
          setStatus(`Saving ${index + 1} of ${uploadCount}: ${file.name}`);
          await uploadLocalTrack(target.record.id, target.track.id, file);
          uploadedTrackKeys.add(
            recordTrackKey(target.record.id, target.track.id),
          );
          libraryNeedsRefresh = true;
        }
      }

      let downloaded = 0;
      if (automaticAudioReady) {
        for (const record of imported.records) {
          const missingTrackIds = record.tracks
            .filter(
              (track) =>
                !track.previewUrl &&
                !uploadedTrackKeys.has(recordTrackKey(record.id, track.id)),
            )
            .map((track) => track.id);
          if (!missingTrackIds.length) continue;
          setStatus(`Finding verified audio for ${record.title}`);
          const match = await matchLocalRecord(record.id, {
            trackIds: missingTrackIds,
          });
          latestRecords.set(record.id, match.record);
          libraryNeedsRefresh = true;
        }

        const downloadQueue = [...latestRecords.values()].flatMap((record) =>
          record.tracks
            .filter(
              (track) =>
                !track.previewUrl &&
                !uploadedTrackKeys.has(recordTrackKey(record.id, track.id)) &&
                track.youtubeMatch?.verified === true,
            )
            .map((track) => ({ record, track })),
        );

        for (let index = 0; index < downloadQueue.length; index += 1) {
          const { record, track } = downloadQueue[index];
          setStatus(
            `Saving verified audio ${index + 1} of ${downloadQueue.length}: ${
              track.title
            }`,
          );
          const updated = await downloadLocalTrackFromYouTube(
            record.id,
            track.id,
            null,
            true,
          );
          latestRecords.set(updated.id, updated);
          downloaded += 1;
          libraryNeedsRefresh = true;
        }
      }

      if (libraryNeedsRefresh) {
        await onLibraryChanged();
        libraryNeedsRefresh = false;
      }

      const summary = summarizeImportedAudio(
        [...latestRecords.values()],
        uploadedTrackKeys,
      );
      const remaining = summary.review + summary.missing;
      if (automaticAudioReady) {
        setStatus(
          remaining
            ? `Music imported · ${summary.ready}/${summary.total} tracks ready · ${remaining} ${
                remaining === 1 ? "track needs" : "tracks need"
              } review`
            : `Music imported · all ${summary.total} tracks ready${
                downloaded ? ` · ${downloaded} downloaded automatically` : ""
              }`,
        );
      } else {
        setStatus(
          imported.duplicate
            ? "This release is already in your local collection."
            : summary.ready
              ? `Music imported · ${summary.ready}/${summary.total} audio files attached`
              : "Sleeve and track list imported. Add audio now or manage it later.",
        );
      }
      await onImportComplete(imported.records);
    } catch (caught) {
      if (libraryNeedsRefresh) {
        await onLibraryChanged().catch(() => undefined);
      }
      const message =
        caught instanceof Error ? caught.message : "Local import failed.";
      const canRetry =
        caught instanceof LocalLibraryApiError &&
        [
          "SPOTIFY_UNAVAILABLE",
          "SPOTIFY_RATE_LIMITED",
          "SPOTIFY_INVALID_RESPONSE",
        ].includes(caught.code);
      setRetryAvailable(canRetry);
      setError(message);
      setStatus(
        canRetry
          ? "Spotify is temporarily unavailable. Your URL is still here—retry when the connection returns."
          : "Import stopped. Completed files are still saved.",
      );
      if (
        caught instanceof LocalLibraryApiError &&
        caught.code === "SPOTIFY_USER_AUTH_REQUIRED"
      ) {
        setSpotifyStatus((current) =>
          current ? { ...current, connected: false } : current,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="local-import" data-testid="local-import-overlay">
      <button
        type="button"
        className="local-import__backdrop"
        aria-label="Close music import"
        disabled={busy}
        onClick={onClose}
      />
      <section
        className="local-import__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-import-title"
      >
        <div className="local-import__heading">
          <div>
            <p className="eyebrow">Your private music library</p>
            <h2 id="local-import-title">Import your music</h2>
          </div>
          <button
            type="button"
            className="local-import__close"
            aria-label="Close music import"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="local-import__intro">
          Spotify supplies the sleeve and track list. Attach audio from this
          computer, and verified matches are filled automatically when
          available.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            <span>Spotify track, album, or playlist URL</span>
            <input
              type="url"
              required
              value={spotifyUrl}
              placeholder="https://open.spotify.com/album/…"
              disabled={busy}
              data-testid="local-import-url"
              onChange={(event) => {
                setSpotifyUrl(event.currentTarget.value);
                setRetryAvailable(false);
              }}
            />
          </label>

          <label>
            <span>Your audio files, in track order (optional)</span>
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.webm"
              disabled={busy}
              data-testid="local-import-files"
              onChange={(event) =>
                setFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
          </label>

          {sortedFiles.length ? (
            <p className="local-import__selection">
              {sortedFiles.length} file{sortedFiles.length === 1 ? "" : "s"}{" "}
              selected · filenames are sorted numerically before matching
            </p>
          ) : null}

          <p
            className={`local-import__downloader ${
              downloaderReady ? "is-ready" : ""
            }`}
            role="status"
          >
            {!downloaderStatus
              ? "Checking the local audio downloader…"
              : downloaderReady
                ? "Verified audio matching is ready."
                : `${downloaderStatus.issues.join(
                    " ",
                  )} Artwork, tracklists, and selected files will still import normally.`}
          </p>

          {spotifyStatus && !spotifyStatus.configured ? (
            <p className="local-import__notice">
              Add <code>SPOTIFY_CLIENT_ID</code> and{" "}
              <code>SPOTIFY_CLIENT_SECRET</code> to the local helper process.
            </p>
          ) : null}

          {spotifyStatus?.configured && !spotifyStatus.connected ? (
            <p className="local-import__notice">
              Playlists require a local Spotify connection.{" "}
              <a
                href={`${localLibraryOrigin}/v1/spotify/authorize`}
                target="_blank"
                rel="noreferrer"
              >
                Connect Spotify
              </a>
            </p>
          ) : null}

          {error ? (
            <p className="local-import__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="local-import__status" role="status" aria-live="polite">
            <span />
            <p>{status}</p>
          </div>

          <div className="local-import__actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Close
            </button>
            <button
              type="submit"
              className="local-import__submit"
              disabled={busy || !spotifyUrl.trim()}
              data-testid="local-import-submit"
            >
              {busy
                ? "Importing music…"
                : retryAvailable
                  ? "Retry import"
                  : "Import music"}
            </button>
          </div>
        </form>

        <button
          type="button"
          className="local-import__manage"
          disabled={busy}
          onClick={onOpenAudioManager}
        >
          Manage audio for music already on the shelf
          <span aria-hidden="true">→</span>
        </button>

        <p className="local-import__footnote">
          Helper: <code>{localLibraryOrigin}</code> · files stay on this computer
        </p>
      </section>
    </div>
  );
}
