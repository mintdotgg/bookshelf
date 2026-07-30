"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  downloadLocalTrackFromYouTube,
  fetchLocalDownloaderStatus,
  localLibraryOrigin,
} from "./local-library";
import type { LocalDownloaderStatus } from "./local-library";

export type YouTubeDownloadTarget = {
  recordId: string;
  recordTitle: string;
  trackId: string;
  trackTitle: string;
};

type YouTubeDownloadDialogProps = {
  target: YouTubeDownloadTarget | null;
  onClose: () => void;
  onLibraryChanged: () => Promise<void>;
};

export function YouTubeDownloadDialog({
  target,
  onClose,
  onLibraryChanged,
}: YouTubeDownloadDialogProps) {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [confirmedOwnership, setConfirmedOwnership] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Paste the direct URL for one authorized YouTube video.",
  );
  const [error, setError] = useState<string | null>(null);
  const [downloaderStatus, setDownloaderStatus] =
    useState<LocalDownloaderStatus | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, target]);

  useEffect(() => {
    if (!target) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDownloaderStatus(null);
      setError(null);
      setStatus("Checking yt-dlp, FFmpeg, JavaScript runtime, and EJS");
    });
    void fetchLocalDownloaderStatus()
      .then((nextStatus) => {
        if (!active) return;
        setDownloaderStatus(nextStatus);
        if (nextStatus.ready) {
          setStatus("Downloader ready for one authorized YouTube video.");
          return;
        }
        const message =
          nextStatus.issues.join(" ") || "Downloader preflight failed.";
        setError(message);
        setStatus("Downloader unavailable");
      })
      .catch((caught) => {
        if (!active) return;
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
        setError(message);
        setStatus("Downloader unavailable");
      });
    return () => {
      active = false;
    };
  }, [target]);

  if (!target) return null;
  const downloaderReady = downloaderStatus?.ready === true;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!youtubeUrl.trim() || !confirmedOwnership || busy) return;
    setBusy(true);
    setError(null);
    setStatus(`Downloading ${target.trackTitle} with yt-dlp`);

    try {
      await downloadLocalTrackFromYouTube(
        target.recordId,
        target.trackId,
        youtubeUrl,
        confirmedOwnership,
      );
      await onLibraryChanged();
      setStatus(
        `${target.trackTitle} is saved locally and ready for playback.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The local yt-dlp download failed.",
      );
      setStatus("Download stopped");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="local-import" data-testid="youtube-download-overlay">
      <button
        type="button"
        className="local-import__backdrop"
        aria-label="Close YouTube download"
        disabled={busy}
        onClick={onClose}
      />
      <section
        className="local-import__dialog youtube-download__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-download-title"
      >
        <div className="local-import__heading">
          <div>
            <p className="eyebrow">Local audio acquisition</p>
            <h2 id="youtube-download-title">Download with yt-dlp</h2>
          </div>
          <button
            type="button"
            className="local-import__close"
            aria-label="Close YouTube download"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="local-import__intro">
          Save audio for <strong>{target.trackTitle}</strong> from one direct
          YouTube video URL. The loopback helper runs yt-dlp and FFmpeg locally.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            <span>YouTube video URL</span>
            <input
              type="url"
              required
              value={youtubeUrl}
              placeholder="https://www.youtube.com/watch?v=…"
              disabled={busy || !downloaderReady}
              data-testid="youtube-download-url"
              onChange={(event) => setYoutubeUrl(event.currentTarget.value)}
            />
          </label>

          <label className="youtube-download__authorization">
            <input
              type="checkbox"
              required
              checked={confirmedOwnership}
              disabled={busy || !downloaderReady}
              data-testid="youtube-download-confirm"
              onChange={(event) =>
                setConfirmedOwnership(event.currentTarget.checked)
              }
            />
            <span>
              I own this media or have permission to download and keep it.
            </span>
          </label>

          <p className="local-import__notice">
            Use this only for authorized media and follow the source
            platform&apos;s terms. Playlists and search URLs are rejected.
          </p>

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
              disabled={
                busy ||
                !downloaderReady ||
                !youtubeUrl.trim() ||
                !confirmedOwnership
              }
              data-testid="youtube-download-submit"
            >
              {busy ? "Downloading…" : "Download with yt-dlp"}
            </button>
          </div>
        </form>

        <p className="local-import__footnote">
          {target.recordTitle} · helper: <code>{localLibraryOrigin}</code> · no
          database
        </p>
      </section>
    </div>
  );
}
