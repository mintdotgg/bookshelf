"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  fetchLocalSpotifyStatus,
  importSpotifyMetadata,
  localLibraryOrigin,
  LocalLibraryApiError,
  uploadLocalTrack,
  type LocalSpotifyStatus,
} from "./local-library";

type LocalLibraryImportProps = {
  open: boolean;
  onClose: () => void;
  onLibraryChanged: () => Promise<void>;
};

function sortFiles(files: File[]) {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function LocalLibraryImport({
  open,
  onClose,
  onLibraryChanged,
}: LocalLibraryImportProps) {
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Paste a Spotify URL to create a local virtual pressing.",
  );
  const [error, setError] = useState<string | null>(null);
  const [spotifyStatus, setSpotifyStatus] =
    useState<LocalSpotifyStatus | null>(null);

  const sortedFiles = useMemo(() => sortFiles(files), [files]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchLocalSpotifyStatus()
      .then((nextStatus) => {
        if (!cancelled) setSpotifyStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) setSpotifyStatus(null);
      });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!spotifyUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Reading Spotify metadata and saving the cover locally");

    try {
      const imported = await importSpotifyMetadata(spotifyUrl);
      const tracks = imported.records.flatMap((record) =>
        record.tracks.map((track) => ({ record, track })),
      );
      await onLibraryChanged();

      if (sortedFiles.length) {
        const uploadCount = Math.min(sortedFiles.length, tracks.length);
        for (let index = 0; index < uploadCount; index += 1) {
          const file = sortedFiles[index];
          const target = tracks[index];
          setStatus(
            `Saving ${index + 1} of ${uploadCount}: ${file.name}`,
          );
          await uploadLocalTrack(
            target.record.id,
            target.track.id,
            file,
          );
        }
        await onLibraryChanged();
        const remaining = tracks.length - uploadCount;
        setStatus(
          remaining > 0
            ? `Local pressing ready · ${remaining} ${
                remaining === 1 ? "track" : "tracks"
              } still ${remaining === 1 ? "needs" : "need"} an audio file`
            : `Local pressing ready · ${uploadCount} audio ${
                uploadCount === 1 ? "file" : "files"
              } attached`,
        );
      } else {
        setStatus(
          imported.duplicate
            ? "This Spotify release is already in your local collection."
            : "Metadata and cover saved locally. Select audio files and import the same URL again to attach them.",
        );
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Local import failed.";
      setError(message);
      setStatus("Import stopped");
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
        aria-label="Close local import"
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
            <p className="eyebrow">Local filesystem library</p>
            <h2 id="local-import-title">Create a virtual pressing</h2>
          </div>
          <button
            type="button"
            className="local-import__close"
            aria-label="Close local import"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="local-import__intro">
          Spotify supplies metadata and the cover. Audio files are selected from
          this computer and remain in the gitignored local library.
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
              onChange={(event) => setSpotifyUrl(event.currentTarget.value)}
            />
          </label>

          <label>
            <span>Authorized audio files, in track order</span>
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
              {busy ? "Building pressing…" : "Import locally"}
            </button>
          </div>
        </form>

        <p className="local-import__footnote">
          Helper: <code>{localLibraryOrigin}</code> · no database
        </p>
      </section>
    </div>
  );
}
