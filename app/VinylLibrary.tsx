"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  RecordShelfEngine,
  type SceneMode,
  type VinylLibraryDiagnostics,
} from "./RecordShelfEngine";
import { recordCatalog, type RecordTrack } from "./record-catalog";
import { siteConfig } from "./site-config";
import {
  VinylAudioController,
} from "./audio/VinylAudioController";
import {
  initialPlaybackState,
  reducePlaybackState,
  type PlaybackAction,
  type PlaybackState,
} from "./audio/playback-state";

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <span aria-hidden="true" className={`arrow-icon arrow-icon--${direction}`}>
      <span />
    </span>
  );
}

function PlayIcon({ paused }: { paused: boolean }) {
  return (
    <span aria-hidden="true">
      {paused ? "▶" : "Ⅱ"}
    </span>
  );
}

function formatTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function trackDuration(track: RecordTrack) {
  return track.duration ? formatTime(track.duration) : "—";
}

type PendingTrack = {
  track: RecordTrack;
  autoplay: boolean;
} | null;

type LibraryCommands = {
  browse: (index: number) => void;
  focus: (index: number) => void;
  play: (trackId?: string) => void;
  pause: () => void;
  stop: () => void;
  resetView: () => void;
  returnToShelf: () => void;
};

export function VinylLibrary() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RecordShelfEngine | null>(null);
  const audioRef = useRef<VinylAudioController | null>(null);
  const playbackRef = useRef<PlaybackState>(initialPlaybackState());
  const pendingTrackRef = useRef<PendingTrack>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const commandsRef = useRef<LibraryCommands>({
    browse() {},
    focus() {},
    play() {},
    pause() {},
    stop() {},
    resetView() {},
    returnToShelf() {},
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("browse");
  const [playback, setPlayback] = useState<PlaybackState>(() =>
    initialPlaybackState(),
  );
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing the archive");

  const activeRecord = recordCatalog[activeIndex];
  const selectedRecord = useMemo(
    () => (selectedIndex === null ? null : recordCatalog[selectedIndex]),
    [selectedIndex],
  );
  const selectedTrack = useMemo(
    () =>
      selectedRecord?.tracks.find((track) => track.id === selectedTrackId) ??
      selectedRecord?.tracks[0] ??
      null,
    [selectedRecord, selectedTrackId],
  );
  const isFocused = sceneMode !== "browse";
  const isBusy =
    playback.mode === "loading" ||
    playback.mode === "cueing" ||
    playback.mode === "stopping";
  const isPlaying = playback.mode === "playing";

  const dispatchPlayback = useCallback((action: PlaybackAction) => {
    const next = reducePlaybackState(playbackRef.current, action);
    playbackRef.current = next;
    setPlayback(next);
    engineRef.current?.setPlaybackMode(next.mode);
    return next;
  }, []);

  const loadTrack = useCallback(
    async (track: RecordTrack, autoplay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      setSelectedTrackId(track.id);
      if (!track.previewUrl) {
        const loading = dispatchPlayback({
          type: "LOAD",
          trackId: track.id,
          src: "",
          autoplay,
        });
        dispatchPlayback({
          type: "MEDIA_ERROR",
          requestId: loading.requestId,
          message: "No preview is available for this track.",
        });
        setStatus("This track does not include a preview");
        return;
      }

      const loading = dispatchPlayback({
        type: "LOAD",
        trackId: track.id,
        src: track.previewUrl,
        autoplay,
      });
      setStatus(`Loading ${track.title}`);
      try {
        await audio.load(track.previewUrl, {
          requestId: loading.requestId,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    },
    [dispatchPlayback],
  );

  const stopPlayback = useCallback(
    (returnToShelf = false) => {
      const state = playbackRef.current;
      if (
        state.mode !== "idle" ||
        engineRef.current?.getDiagnostics().cuePhase !== null
      ) {
        dispatchPlayback({ type: "STOP" });
        setStatus("Lifting the needle");
        void audioRef.current?.stop().catch(() => undefined);
        engineRef.current?.stopAndReturnVinyl(returnToShelf);
        return;
      }
      if (returnToShelf) engineRef.current?.requestReturnToShelf();
    },
    [dispatchPlayback],
  );

  const queueTrack = useCallback(
    (track: RecordTrack, autoplay: boolean) => {
      const cuePhase = engineRef.current?.getDiagnostics().cuePhase;
      if (cuePhase !== null && cuePhase !== undefined) {
        pendingTrackRef.current = { track, autoplay };
        stopPlayback(false);
        return;
      }
      void loadTrack(track, autoplay);
    },
    [loadTrack, stopPlayback],
  );

  const playTrack = useCallback(
    (track: RecordTrack | null = selectedTrack) => {
      const audio = audioRef.current;
      const engine = engineRef.current;
      if (!track || !audio || !engine || sceneMode !== "inspect") return;
      void audio.unlock().catch(() => undefined);

      const state = playbackRef.current;
      if (state.trackId !== track.id || state.src !== track.previewUrl) {
        queueTrack(track, true);
        void audio.primeForDelayedPlayback().catch(() => undefined);
        return;
      }
      if (state.mode === "loading") {
        dispatchPlayback({ type: "PLAY" });
        return;
      }
      if (state.mode === "playing" || state.mode === "cueing") return;
      if (state.mode === "error") {
        dispatchPlayback({ type: "CLEAR_ERROR" });
        queueTrack(track, true);
        return;
      }

      const cuePhase = engine.getDiagnostics().cuePhase;
      dispatchPlayback({ type: "PLAY" });
      if (cuePhase === "playing") {
        const cueComplete = dispatchPlayback({
          type: "CUE_COMPLETE",
          requestId: playbackRef.current.requestId,
        });
        engine.setPlaybackMode(cueComplete.mode);
        void audio.play().catch(() => undefined);
        return;
      }
      engine.startCue(
        state.duration > 0 ? state.currentTime / state.duration : 0,
      );
    },
    [
      dispatchPlayback,
      queueTrack,
      sceneMode,
      selectedTrack,
    ],
  );

  const pausePlayback = useCallback(() => {
    const state = playbackRef.current;
    if (state.mode !== "playing" && state.mode !== "cueing") return;
    dispatchPlayback({ type: "PAUSE" });
    audioRef.current?.pause();
    setStatus("Playback paused");
  }, [dispatchPlayback]);

  const seekPlayback = useCallback(
    (time: number) => {
      const state = playbackRef.current;
      if (state.duration <= 0 || state.mode === "loading") return;
      const next = dispatchPlayback({ type: "SEEK", time });
      if (next.mode !== "seeking" || next.duration <= 0) return;
      engineRef.current?.setPlaybackProgress(time / next.duration);
      void audioRef.current
        ?.seek(time)
        .then(() => {
          if (next.resumeAfterSeek === "playing") {
            void audioRef.current?.play().catch(() => undefined);
          }
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setStatus("Unable to seek this preview");
          }
        });
    },
    [dispatchPlayback],
  );

  const returnToShelf = useCallback(() => {
    pendingTrackRef.current = null;
    stopPlayback(true);
  }, [stopPlayback]);

  useEffect(() => {
    let cancelled = false;
    let engine: RecordShelfEngine | null = null;
    let audio: VinylAudioController | null = null;

    async function start() {
      if (!canvasRef.current) return;
      await document.fonts.ready;
      if (cancelled || !canvasRef.current) return;

      audio = new VinylAudioController({
        initialVolume: playbackRef.current.volume,
        callbacks: {
          onReady: (snapshot) => {
            const next = dispatchPlayback({
              type: "MEDIA_READY",
              requestId: snapshot.requestId,
              duration: snapshot.duration,
            });
            if (next.mode === "cueing") {
              const started = engineRef.current?.startCue(
                snapshot.duration > 0
                  ? snapshot.currentTime / snapshot.duration
                  : 0,
              );
              if (!started) setStatus("Finish opening the sleeve before playing");
            } else {
              setStatus("Preview ready");
            }
          },
          onPlay: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_PLAYING",
              requestId: snapshot.requestId,
            });
            setStatus("Needle down");
          },
          onTimeUpdate: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_TIME",
              requestId: snapshot.requestId,
              currentTime: snapshot.currentTime,
              duration: snapshot.duration,
            });
            if (snapshot.duration > 0) {
              engineRef.current?.setPlaybackProgress(
                snapshot.currentTime / snapshot.duration,
              );
            }
          },
          onSeeked: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_SEEKED",
              requestId: snapshot.requestId,
              currentTime: snapshot.currentTime,
            });
          },
          onEnded: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_ENDED",
              requestId: snapshot.requestId,
            });
            setStatus("End of preview");
            void audioRef.current?.stop(80).catch(() => undefined);
            engineRef.current?.stopAndReturnVinyl();
          },
          onStopped: (snapshot) => {
            if (snapshot.requestId !== playbackRef.current.requestId) return;
          },
          onError: (error) => {
            dispatchPlayback({
              type: "MEDIA_ERROR",
              requestId: error.requestId,
              message: error.message,
            });
            setStatus(error.message);
            engineRef.current?.stopAndReturnVinyl();
          },
        },
      });
      audioRef.current = audio;

      engine = new RecordShelfEngine(canvasRef.current, recordCatalog, {
        onActiveIndex: setActiveIndex,
        onMode: (nextMode, index) => {
          setSceneMode(nextMode);
          setSelectedIndex(index);
          if (index !== null) {
            setSelectedTrackId((current) =>
              recordCatalog[index].tracks.some((track) => track.id === current)
                ? current
                : recordCatalog[index].tracks[0]?.id ?? null,
            );
          }
          if (nextMode === "browse" && pendingFocusRef.current !== null) {
            const target = pendingFocusRef.current;
            pendingFocusRef.current = null;
            queueMicrotask(() => engineRef.current?.focusRecord(target));
          }
        },
        onStatus: setStatus,
        onReady: () => {
          setReady(true);
          setStatus(`${recordCatalog.length} pressings ready`);
        },
        onNeedleContact: () => {
          const current = playbackRef.current;
          if (current.mode !== "cueing" || !current.playWhenReady) {
            engineRef.current?.setPlaybackMode("paused");
            return;
          }
          dispatchPlayback({
            type: "CUE_COMPLETE",
            requestId: current.requestId,
          });
          void audioRef.current?.play().catch(() => undefined);
        },
        onVinylReturned: () => {
          dispatchPlayback({
            type: "MEDIA_STOPPED",
            requestId: playbackRef.current.requestId,
          });
          const pending = pendingTrackRef.current;
          pendingTrackRef.current = null;
          if (pending) {
            void loadTrack(pending.track, pending.autoplay);
          } else if (engineRef.current?.getDiagnostics().sceneMode === "inspect") {
            setStatus("Pressing returned to its sleeve");
          }
        },
      });
      engineRef.current = engine;
      engine.setAnalyserReader((target) => {
        const data = audioRef.current?.sampleFrequencyData();
        if (!data) {
          target.fill(0);
          return false;
        }
        target.set(data.subarray(0, target.length));
        return playbackRef.current.mode === "playing";
      }, audio.analyserSampleRate, audio.frequencyBinCount);

      (
        window as unknown as {
          __VINYL_LIBRARY__?: {
            diagnostics: () => VinylLibraryDiagnostics | null;
            browse: (index: number) => void;
            focus: (index: number) => void;
            play: (trackId?: string) => void;
            pause: () => void;
            stop: () => void;
            resetView: () => void;
            returnToShelf: () => void;
          };
        }
      ).__VINYL_LIBRARY__ = {
        diagnostics: () => engineRef.current?.getDiagnostics() ?? null,
        browse: (index) => commandsRef.current.browse(index),
        focus: (index) => commandsRef.current.focus(index),
        play: (trackId) => commandsRef.current.play(trackId),
        pause: () => commandsRef.current.pause(),
        stop: () => commandsRef.current.stop(),
        resetView: () => commandsRef.current.resetView(),
        returnToShelf: () => commandsRef.current.returnToShelf(),
      };
    }

    void start();
    return () => {
      cancelled = true;
      engine?.dispose();
      void audio?.dispose();
      engineRef.current = null;
      audioRef.current = null;
      delete (
        window as unknown as {
          __VINYL_LIBRARY__?: unknown;
        }
      ).__VINYL_LIBRARY__;
    };
  }, [dispatchPlayback, loadTrack]);

  useEffect(() => {
    commandsRef.current = {
      browse: (index) => engineRef.current?.browseTo(index),
      focus: (index) => {
        const currentMode =
          engineRef.current?.getDiagnostics().sceneMode ?? "browse";
        if (currentMode !== "browse") {
          pendingFocusRef.current = index;
          returnToShelf();
          return;
        }
        engineRef.current?.focusRecord(index);
      },
      play: (trackId) => {
        const record =
          selectedIndex === null ? null : recordCatalog[selectedIndex];
        const track =
          record?.tracks.find((candidate) => candidate.id === trackId) ??
          selectedTrack;
        playTrack(track);
      },
      pause: pausePlayback,
      stop: () => stopPlayback(false),
      resetView: () => engineRef.current?.resetFocusView(),
      returnToShelf,
    };
  }, [
    pausePlayback,
    playTrack,
    returnToShelf,
    selectedIndex,
    selectedTrack,
    stopPlayback,
  ]);

  const themeStyle = {
    "--paper": siteConfig.theme.paper,
    "--paper-deep": siteConfig.theme.paperDeep,
    "--ink": siteConfig.theme.ink,
    "--ink-soft": siteConfig.theme.inkSoft,
    "--accent": siteConfig.theme.accent,
    "--night": siteConfig.theme.night,
    "--brass": siteConfig.theme.brass,
  } as CSSProperties;

  return (
    <main
      className={`vinyl-experience ${ready ? "is-ready" : ""} ${
        isFocused ? "is-focused" : "is-browsing"
      } ${isPlaying ? "is-playing" : ""}`}
      style={themeStyle}
    >
      <canvas
        ref={canvasRef}
        className="archive-canvas"
        data-testid="archive-canvas"
        role="application"
        tabIndex={0}
        aria-label={`Interactive three-dimensional archive of ${recordCatalog.length} records. Drag, scroll, or use the arrow keys to browse. Press Enter to inspect the selected sleeve.`}
      />

      <header className="archive-header">
        <div
          className="wordmark"
          aria-label={`${siteConfig.wordmark}, ${siteConfig.collectionName}`}
        >
          <span>{siteConfig.wordmark}</span>
          <span className="wordmark__divider" />
          <span>{siteConfig.collectionName}</span>
        </div>
        <div className="archive-count" aria-hidden="true">
          <span>{String(recordCatalog.length).padStart(2, "0")} PRESSINGS</span>
          <span>01 CONTINUOUS ARCHIVE</span>
        </div>
      </header>

      <section
        className="browse-caption"
        aria-hidden={isFocused}
        data-testid="browse-caption"
      >
        <p className="eyebrow">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <span className="eyebrow__line" />
          <span>{String(recordCatalog.length).padStart(2, "0")}</span>
        </p>
        <h1>{activeRecord.shortTitle}</h1>
        <p className="browse-caption__artist">{activeRecord.artist}</p>
        <button
          type="button"
          className="inspect-button"
          data-testid="inspect-active"
          disabled={isFocused}
          onClick={() => engineRef.current?.focusRecord(activeIndex)}
          aria-label={`Inspect ${activeRecord.title} by ${activeRecord.artist}`}
        >
          <span>Pull from archive</span>
          <span aria-hidden="true">↗</span>
        </button>
      </section>

      <button
        type="button"
        className="archive-arrow archive-arrow--left"
        data-testid="browse-previous"
        aria-label="Previous record"
        disabled={isFocused || activeIndex === 0}
        onClick={() => engineRef.current?.browseBy(-1)}
      >
        <ArrowIcon direction="left" />
      </button>
      <button
        type="button"
        className="archive-arrow archive-arrow--right"
        data-testid="browse-next"
        aria-label="Next record"
        disabled={isFocused || activeIndex === recordCatalog.length - 1}
        onClick={() => engineRef.current?.browseBy(1)}
      >
        <ArrowIcon direction="right" />
      </button>

      <nav className="archive-index" aria-label="Archive position">
        <div className="archive-index__ticks">
          {recordCatalog.map((record, index) => (
            <button
              key={record.id}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              aria-label={`Browse to ${record.title} by ${record.artist}`}
              aria-current={index === activeIndex ? "true" : undefined}
              disabled={isFocused}
              onClick={() => engineRef.current?.browseTo(index)}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="input-hint" aria-hidden="true">
          <span>DRAG</span>
          <i />
          <span>SCROLL</span>
          <i />
          <span>ARROW KEYS</span>
        </div>
      </nav>

      <aside
        className="album-panel"
        aria-hidden={!isFocused}
        aria-label={
          selectedRecord ? `Details for ${selectedRecord.title}` : "Album details"
        }
        data-testid="album-panel"
      >
        {selectedRecord ? (
          <div className="album-panel__inner">
            <button
              type="button"
              className="back-button"
              data-testid="return-to-archive"
              onClick={returnToShelf}
            >
              <ArrowIcon direction="left" />
              <span>{siteConfig.returnLabel}</span>
            </button>

            <div className="album-panel__position" aria-hidden="true">
              <span>{String(selectedIndex! + 1).padStart(2, "0")}</span>
              <span>{String(recordCatalog.length).padStart(2, "0")}</span>
            </div>

            <div className="album-panel__copy">
              <p className="eyebrow">{siteConfig.editionEyebrow}</p>
              <h2>{selectedRecord.title}</h2>
              <p className="album-panel__artist">{selectedRecord.artist}</p>
              <p className="album-panel__description">
                {selectedRecord.description}
              </p>
              <ul className="release-meta">
                <li>{selectedRecord.year}</li>
                <li>{selectedRecord.rpm} RPM</li>
                {selectedRecord.catalogNumber ? (
                  <li>{selectedRecord.catalogNumber}</li>
                ) : null}
                {selectedRecord.edition ? <li>{selectedRecord.edition}</li> : null}
              </ul>

              <section className="track-section" aria-label="Track previews">
                <p className="track-section__label">Select a track</p>
                <ol className="track-list">
                  {selectedRecord.tracks.map((track) => (
                    <li key={track.id}>
                      <button
                        type="button"
                        className={`track-button ${
                          selectedTrack?.id === track.id ? "is-selected" : ""
                        }`}
                        data-testid={`track-${track.id}`}
                        aria-pressed={selectedTrack?.id === track.id}
                        disabled={isBusy}
                        onClick={() => queueTrack(track, false)}
                      >
                        <span className="track-button__side">
                          {track.side ?? "—"}
                          {track.trackNumber}
                        </span>
                        <span className="track-button__title">{track.title}</span>
                        <span className="track-button__duration">
                          {trackDuration(track)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>

              {selectedRecord.links?.length ? (
                <div className="record-links">
                  {selectedRecord.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="focus-controls" aria-label="Inspection controls">
              <span>Drag to orbit · scroll to zoom</span>
              <button
                type="button"
                data-testid="reset-view"
                onClick={() => engineRef.current?.resetFocusView()}
              >
                Reset view
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <section
        className="player"
        aria-label="Music preview player"
        data-testid="preview-player"
      >
        <div className="player__transport">
          <button
            type="button"
            className="transport-button"
            data-testid="play-pause"
            aria-label={isPlaying ? siteConfig.pauseLabel : siteConfig.playLabel}
            disabled={!selectedTrack || isBusy}
            onClick={() => (isPlaying ? pausePlayback() : playTrack())}
          >
            <PlayIcon paused={!isPlaying} />
          </button>
          <button
            type="button"
            className="transport-button transport-button--secondary"
            data-testid="stop-playback"
            aria-label={siteConfig.stopLabel}
            disabled={
              playback.mode === "idle" || playback.mode === "stopping"
            }
            onClick={() => stopPlayback(false)}
          >
            <span aria-hidden="true">■</span>
          </button>
        </div>

        <div className="player__main">
          <div className="player__track">
            <strong>{selectedTrack?.title ?? "Select a track"}</strong>
            <span>{selectedRecord?.artist}</span>
          </div>
          <div className="player__timeline">
            <span>{formatTime(playback.currentTime)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(playback.duration, selectedTrack?.duration ?? 0, 1)}
              step={0.1}
              value={Math.min(
                playback.currentTime,
                Math.max(playback.duration, selectedTrack?.duration ?? 0, 1),
              )}
              disabled={playback.duration <= 0 || isBusy}
              aria-label="Seek preview"
              onChange={(event) => seekPlayback(Number(event.currentTarget.value))}
            />
            <span>
              {formatTime(playback.duration || selectedTrack?.duration || 0)}
            </span>
          </div>
        </div>

        <label className="player__volume">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={playback.volume}
            aria-label="Preview volume"
            onChange={(event) => {
              const volume = Number(event.currentTarget.value);
              dispatchPlayback({ type: "SET_VOLUME", volume });
              audioRef.current?.setVolume(volume);
            }}
          />
        </label>
      </section>

      <div
        className={`experience-status ${
          playback.mode === "error" ? "is-error" : ""
        }`}
        role="status"
        aria-live="polite"
        data-testid="experience-status"
      >
        <span className="experience-status__dot" />
        <span>{playback.error ?? status}</span>
      </div>

      <div className="loading-screen" aria-hidden={ready}>
        <div className="loading-screen__mark" />
        <p>Cataloging {recordCatalog.length} pressings</p>
      </div>

      <p className="independent-note">{siteConfig.independentNote}</p>

      <div className="sr-only" aria-live="polite">
        {isFocused && selectedRecord
          ? `Inspecting ${selectedRecord.title} by ${selectedRecord.artist}. Playback is ${playback.mode}.`
          : `Selected ${activeRecord.title} by ${activeRecord.artist}.`}
      </div>
    </main>
  );
}
