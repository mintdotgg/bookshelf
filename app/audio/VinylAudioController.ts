export type VinylAudioOperation =
  | "load"
  | "unlock"
  | "play"
  | "seek"
  | "fade"
  | "stop"
  | "dispose";

export type VinylAudioSnapshot = {
  requestId: number;
  src: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  paused: boolean;
  readyState: number;
  contextState: AudioContextState | "uninitialized";
  disposed: boolean;
};

export type VinylAudioError = {
  operation: VinylAudioOperation;
  requestId: number;
  message: string;
  cause: unknown;
  mediaErrorCode?: number;
};

export type VinylAudioCallbacks = {
  onLoadStart?: (snapshot: VinylAudioSnapshot) => void;
  onMetadata?: (snapshot: VinylAudioSnapshot) => void;
  onReady?: (snapshot: VinylAudioSnapshot) => void;
  onPlay?: (snapshot: VinylAudioSnapshot) => void;
  onPause?: (snapshot: VinylAudioSnapshot) => void;
  onTimeUpdate?: (snapshot: VinylAudioSnapshot) => void;
  onWaiting?: (snapshot: VinylAudioSnapshot) => void;
  onSeeking?: (snapshot: VinylAudioSnapshot) => void;
  onSeeked?: (snapshot: VinylAudioSnapshot) => void;
  onEnded?: (snapshot: VinylAudioSnapshot) => void;
  onStopped?: (snapshot: VinylAudioSnapshot) => void;
  onFadeStart?: (
    targetVolume: number,
    durationMs: number,
    snapshot: VinylAudioSnapshot,
  ) => void;
  onFadeComplete?: (
    targetVolume: number,
    snapshot: VinylAudioSnapshot,
  ) => void;
  onVolumeChange?: (snapshot: VinylAudioSnapshot) => void;
  onContextState?: (snapshot: VinylAudioSnapshot) => void;
  onError?: (
    error: VinylAudioError,
    snapshot: VinylAudioSnapshot,
  ) => void;
  onDispose?: (snapshot: VinylAudioSnapshot) => void;
};

export type VinylAudioControllerOptions = {
  audioElement?: HTMLAudioElement;
  contextFactory?: () => AudioContext;
  fftSize?: number;
  smoothingTimeConstant?: number;
  initialVolume?: number;
  crossOrigin?: "" | "anonymous" | "use-credentials" | null;
  callbacks?: VinylAudioCallbacks;
};

export type VinylAudioLoadOptions = {
  requestId?: number;
  startTime?: number;
};

type PendingLoad = {
  requestId: number;
  startTime: number;
  resolve: (snapshot: VinylAudioSnapshot) => void;
  reject: (reason: unknown) => void;
};

type PendingSeek = {
  resolve: (time: number) => void;
  reject: (reason: unknown) => void;
};

const defaultFftSize = 1024;

export class VinylAudioController {
  private readonly audio: HTMLAudioElement;
  private readonly contextFactory: (() => AudioContext) | null;
  private callbacks: VinylAudioCallbacks;
  private context: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly fftSize: number;
  private readonly analyserSmoothing: number;
  private readonly frequencyData: Uint8Array<ArrayBuffer>;
  private requestCounter = 0;
  private requestId = 0;
  private requestedSrc: string | null = null;
  private volume: number;
  private pendingLoad: PendingLoad | null = null;
  private pendingSeek: PendingSeek | null = null;
  private readyNotifiedRequest = -1;
  private stoppedRequestId = -1;
  private priming = false;
  private suppressPauseUntil = 0;
  private primePromise: Promise<void> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeResolve: (() => void) | null = null;
  private fadeVersion = 0;
  private stopPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: VinylAudioControllerOptions = {}) {
    this.audio = options.audioElement ?? createAudioElement();
    this.contextFactory = options.contextFactory ?? null;
    this.callbacks = options.callbacks ?? {};
    this.fftSize = validateFftSize(options.fftSize ?? defaultFftSize);
    this.analyserSmoothing = clampUnit(
      options.smoothingTimeConstant ?? 0.72,
    );
    this.volume = clampUnit(options.initialVolume ?? 0.82);
    this.frequencyData = new Uint8Array(this.fftSize / 2);

    const crossOrigin =
      options.crossOrigin === undefined ? "anonymous" : options.crossOrigin;
    if (crossOrigin === null) {
      this.audio.removeAttribute("crossorigin");
    } else {
      this.audio.crossOrigin = crossOrigin;
    }
    this.audio.preload = "metadata";
    this.audio.setAttribute("playsinline", "");
    this.audio.volume = 1;

    this.bindEvents();
  }

  get frequencyBinCount(): number {
    return this.frequencyData.length;
  }

  get analyserSampleRate(): number {
    return this.context?.sampleRate ?? 48_000;
  }

  get analyserFftSize(): number {
    return this.fftSize;
  }

  setCallbacks(callbacks: VinylAudioCallbacks): void {
    this.callbacks = callbacks;
  }

  getSnapshot(): VinylAudioSnapshot {
    return {
      requestId: this.requestId,
      src: this.requestedSrc,
      currentTime: finiteOrZero(this.audio.currentTime),
      duration: finiteOrZero(this.audio.duration),
      volume: this.volume,
      paused: this.audio.paused,
      readyState: this.audio.readyState,
      contextState: this.context?.state ?? "uninitialized",
      disposed: this.disposed,
    };
  }

  load(
    src: string,
    options: VinylAudioLoadOptions = {},
  ): Promise<VinylAudioSnapshot> {
    this.assertUsable();
    if (!src) {
      const error = new TypeError("An audio source URL is required.");
      this.reportError("load", error);
      return Promise.reject(error);
    }

    const requestId =
      options.requestId ?? Math.max(this.requestCounter + 1, 1);
    this.requestCounter = Math.max(this.requestCounter, requestId);
    this.requestId = requestId;
    const startTime = Math.max(finiteOrZero(options.startTime ?? 0), 0);
    const isSameSource = this.requestedSrc === src;

    this.cancelPendingLoad(createAbortError("Audio load was superseded."));
    this.cancelPendingSeek(createAbortError("Audio seek was superseded."));
    this.cancelFade();
    this.readyNotifiedRequest = -1;
    this.stoppedRequestId = -1;
    this.requestedSrc = src;
    this.callbacks.onLoadStart?.(this.getSnapshot());

    if (
      isSameSource &&
      this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      if (startTime !== this.audio.currentTime) {
        this.audio.currentTime = clampTime(startTime, this.audio.duration);
      }
      this.readyNotifiedRequest = requestId;
      const snapshot = this.getSnapshot();
      this.callbacks.onReady?.(snapshot);
      return Promise.resolve(snapshot);
    }

    this.audio.pause();
    this.audio.src = src;
    this.audio.load();

    return new Promise<VinylAudioSnapshot>((resolve, reject) => {
      this.pendingLoad = { requestId, startTime, resolve, reject };
    });
  }

  /**
   * Call directly from a pointer/keyboard activation. The graph is created
   * lazily and the AudioContext is resumed in the same gesture task.
   */
  async unlock(): Promise<void> {
    this.assertUsable();
    try {
      const context = this.ensureGraph();
      if (context.state === "suspended") {
        await context.resume();
      }
      this.callbacks.onContextState?.(this.getSnapshot());
    } catch (error) {
      this.reportError("unlock", error);
      throw error;
    }
  }

  /**
   * Starts media playback while a user activation is still live, then
   * immediately pauses it at zero gain. This preserves delayed turntable
   * choreography on browsers that otherwise reject a later `play()` call.
   */
  primeForDelayedPlayback(): Promise<void> {
    this.assertUsable();
    if (this.primePromise) return this.primePromise;

    const work = (async () => {
      this.priming = true;
      try {
        const context = this.ensureGraph();
        if (context.state === "suspended") {
          await context.resume();
        }
        this.callbacks.onContextState?.(this.getSnapshot());
        this.setGainImmediately(0);
        await this.audio.play();
        this.suppressPauseUntil = Date.now() + 1_000;
        this.audio.pause();
        if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
          this.audio.currentTime = 0;
        }
      } catch (error) {
        throw error;
      } finally {
        this.setGainImmediately(this.volume);
        this.priming = false;
      }
    })();

    this.primePromise = work;
    void work.then(
      () => {
        if (this.primePromise === work) this.primePromise = null;
      },
      () => {
        if (this.primePromise === work) this.primePromise = null;
      },
    );
    return work;
  }

  async play(): Promise<void> {
    this.assertUsable();
    if (this.primePromise) {
      try {
        await this.primePromise;
      } catch {
        // Priming is an autoplay-policy optimization. A normal user-requested
        // play should still be attempted when a browser declines the prime.
      }
    }
    if (this.stopPromise) await this.stopPromise;
    this.stoppedRequestId = -1;

    try {
      await this.unlock();
      await this.audio.play();
    } catch (error) {
      this.reportError("play", error);
      throw error;
    }
  }

  pause(): void {
    this.assertUsable();
    if (!this.audio.paused) this.audio.pause();
  }

  seek(time: number): Promise<number> {
    this.assertUsable();
    const target = clampTime(time, this.audio.duration);
    this.cancelPendingSeek(createAbortError("Audio seek was superseded."));

    if (Math.abs(this.audio.currentTime - target) < 0.001) {
      this.callbacks.onSeeked?.(this.getSnapshot());
      return Promise.resolve(target);
    }

    try {
      this.audio.currentTime = target;
    } catch (error) {
      this.reportError("seek", error);
      return Promise.reject(error);
    }

    return new Promise<number>((resolve, reject) => {
      this.pendingSeek = { resolve, reject };
    });
  }

  setVolume(volume: number): void {
    this.assertUsable();
    this.volume = clampUnit(volume);
    this.cancelFade();
    this.setGainImmediately(this.volume);
    this.callbacks.onVolumeChange?.(this.getSnapshot());
  }

  async fadeTo(targetVolume: number, durationMs = 180): Promise<void> {
    this.assertUsable();
    const target = clampUnit(targetVolume);
    const duration = Math.max(finiteOrZero(durationMs), 0);
    try {
      const context = this.ensureGraph();
      const gain = this.gainNode;
      if (!gain) return;

      this.cancelFade();
      const fadeVersion = this.fadeVersion;
      this.callbacks.onFadeStart?.(target, duration, this.getSnapshot());

      const now = context.currentTime;
      holdGainAtTime(gain.gain, now);
      if (duration === 0 || context.state !== "running") {
        gain.gain.setValueAtTime(target, now);
        this.callbacks.onFadeComplete?.(target, this.getSnapshot());
        return;
      }

      gain.gain.linearRampToValueAtTime(target, now + duration / 1000);
      await new Promise<void>((resolve) => {
        this.fadeResolve = resolve;
        this.fadeTimer = setTimeout(() => {
          this.fadeTimer = null;
          this.fadeResolve = null;
          resolve();
        }, duration);
      });
      if (fadeVersion === this.fadeVersion) {
        this.callbacks.onFadeComplete?.(target, this.getSnapshot());
      }
    } catch (error) {
      this.reportError("fade", error);
      throw error;
    }
  }

  stop(fadeMs = 140): Promise<void> {
    this.assertUsable();
    if (this.stopPromise) return this.stopPromise;

    const stopWork = async () => {
      try {
        this.stoppedRequestId = this.requestId;
        this.cancelPendingLoad(createAbortError("Audio stopped."));
        if (!this.audio.paused && fadeMs > 0) {
          await this.fadeTo(0, fadeMs);
        }
        this.audio.pause();
        this.cancelPendingSeek(createAbortError("Audio stopped."));
        if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
          this.audio.currentTime = 0;
        }
        this.setGainImmediately(this.volume);
        this.callbacks.onStopped?.(this.getSnapshot());
      } catch (error) {
        this.reportError("stop", error);
        throw error;
      }
    };

    const work = stopWork();
    this.stopPromise = work;
    void work.then(
      () => {
        if (this.stopPromise === work) this.stopPromise = null;
      },
      () => {
        if (this.stopPromise === work) this.stopPromise = null;
      },
    );
    return work;
  }

  /**
   * Returns the same typed array on every call. Sample this from the owning
   * Three.js animation loop and copy/reduce it into other preallocated buffers.
   */
  sampleFrequencyData(): Uint8Array<ArrayBuffer> {
    if (this.disposed || !this.analyser) {
      this.frequencyData.fill(0);
      return this.frequencyData;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const aborted = createAbortError("Audio controller was disposed.");
    this.cancelPendingLoad(aborted);
    this.cancelPendingSeek(aborted);
    this.cancelFade();
    this.unbindEvents();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.sourceNode?.disconnect();
    this.gainNode?.disconnect();
    this.analyser?.disconnect();
    this.frequencyData.fill(0);

    const context = this.context;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch (error) {
        this.reportError("dispose", error);
      }
    }

    this.callbacks.onDispose?.(this.getSnapshot());
  }

  private ensureGraph(): AudioContext {
    if (this.context) return this.context;

    const context = this.contextFactory?.() ?? createAudioContext();
    const sourceNode = context.createMediaElementSource(this.audio);
    const gainNode = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = this.fftSize;
    analyser.smoothingTimeConstant = this.analyserSmoothing;
    gainNode.gain.value = this.volume;

    sourceNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(context.destination);
    context.addEventListener("statechange", this.handleContextState);

    this.context = context;
    this.sourceNode = sourceNode;
    this.gainNode = gainNode;
    this.analyser = analyser;
    return context;
  }

  private setGainImmediately(value: number): void {
    if (!this.context || !this.gainNode) return;
    const now = this.context.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(value, now);
  }

  private cancelPendingLoad(reason: unknown): void {
    if (!this.pendingLoad) return;
    const pending = this.pendingLoad;
    this.pendingLoad = null;
    pending.reject(reason);
  }

  private cancelPendingSeek(reason: unknown): void {
    if (!this.pendingSeek) return;
    const pending = this.pendingSeek;
    this.pendingSeek = null;
    pending.reject(reason);
  }

  private cancelFade(): void {
    this.fadeVersion += 1;
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.context && this.gainNode) {
      holdGainAtTime(this.gainNode.gain, this.context.currentTime);
    }
    const resolve = this.fadeResolve;
    this.fadeResolve = null;
    resolve?.();
  }

  private reportError(
    operation: VinylAudioOperation,
    cause: unknown,
  ): void {
    const mediaError = this.audio.error;
    const error: VinylAudioError = {
      operation,
      requestId: this.requestId,
      message:
        cause instanceof Error
          ? cause.message
          : mediaError
            ? mediaErrorMessage(mediaError)
            : "Unknown audio error.",
      cause,
      ...(mediaError ? { mediaErrorCode: mediaError.code } : {}),
    };
    this.callbacks.onError?.(error, this.getSnapshot());
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("VinylAudioController has been disposed.");
    }
  }

  private readonly handleLoadedMetadata = () => {
    const pending = this.pendingLoad;
    if (pending?.requestId === this.requestId && pending.startTime > 0) {
      this.audio.currentTime = clampTime(
        pending.startTime,
        this.audio.duration,
      );
    }
    this.callbacks.onMetadata?.(this.getSnapshot());
  };

  private readonly handleCanPlay = () => {
    if (this.stoppedRequestId === this.requestId) return;
    if (this.readyNotifiedRequest !== this.requestId) {
      this.readyNotifiedRequest = this.requestId;
      this.callbacks.onReady?.(this.getSnapshot());
    }

    const pending = this.pendingLoad;
    if (pending?.requestId === this.requestId) {
      this.pendingLoad = null;
      pending.resolve(this.getSnapshot());
    }
  };

  private readonly handlePlaying = () => {
    if (this.priming || this.stoppedRequestId === this.requestId) return;
    this.callbacks.onPlay?.(this.getSnapshot());
  };

  private readonly handlePause = () => {
    if (this.priming || Date.now() < this.suppressPauseUntil) return;
    this.callbacks.onPause?.(this.getSnapshot());
  };

  private readonly handleTimeUpdate = () => {
    this.callbacks.onTimeUpdate?.(this.getSnapshot());
  };

  private readonly handleWaiting = () => {
    this.callbacks.onWaiting?.(this.getSnapshot());
  };

  private readonly handleSeeking = () => {
    this.callbacks.onSeeking?.(this.getSnapshot());
  };

  private readonly handleSeeked = () => {
    this.callbacks.onSeeked?.(this.getSnapshot());
    const pending = this.pendingSeek;
    if (pending) {
      this.pendingSeek = null;
      pending.resolve(finiteOrZero(this.audio.currentTime));
    }
  };

  private readonly handleEnded = () => {
    this.callbacks.onEnded?.(this.getSnapshot());
  };

  private readonly handleMediaError = () => {
    if (this.stoppedRequestId === this.requestId) return;
    const error = this.audio.error;
    const reason = new Error(
      error ? mediaErrorMessage(error) : "Audio media failed to load.",
    );
    const pending = this.pendingLoad;
    if (pending) {
      this.pendingLoad = null;
      pending.reject(reason);
    }
    this.reportError("load", reason);
  };

  private readonly handleContextState = () => {
    this.callbacks.onContextState?.(this.getSnapshot());
  };

  private bindEvents(): void {
    this.audio.addEventListener(
      "loadedmetadata",
      this.handleLoadedMetadata,
    );
    this.audio.addEventListener("canplay", this.handleCanPlay);
    this.audio.addEventListener("playing", this.handlePlaying);
    this.audio.addEventListener("pause", this.handlePause);
    this.audio.addEventListener("timeupdate", this.handleTimeUpdate);
    this.audio.addEventListener("waiting", this.handleWaiting);
    this.audio.addEventListener("seeking", this.handleSeeking);
    this.audio.addEventListener("seeked", this.handleSeeked);
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleMediaError);
  }

  private unbindEvents(): void {
    this.audio.removeEventListener(
      "loadedmetadata",
      this.handleLoadedMetadata,
    );
    this.audio.removeEventListener("canplay", this.handleCanPlay);
    this.audio.removeEventListener("playing", this.handlePlaying);
    this.audio.removeEventListener("pause", this.handlePause);
    this.audio.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.audio.removeEventListener("waiting", this.handleWaiting);
    this.audio.removeEventListener("seeking", this.handleSeeking);
    this.audio.removeEventListener("seeked", this.handleSeeked);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleMediaError);
    this.context?.removeEventListener(
      "statechange",
      this.handleContextState,
    );
  }
}

function createAudioElement(): HTMLAudioElement {
  if (typeof Audio === "undefined") {
    throw new Error(
      "VinylAudioController must be constructed in a browser environment.",
    );
  }
  return new Audio();
}

function createAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("Web Audio is unavailable outside a browser.");
  }
  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("This browser does not support the Web Audio API.");
  }
  return new AudioContextConstructor();
}

function validateFftSize(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 32 ||
    value > 32_768 ||
    (value & (value - 1)) !== 0
  ) {
    throw new RangeError(
      "fftSize must be a power of two between 32 and 32768.",
    );
  }
  return value;
}

function holdGainAtTime(gain: AudioParam, time: number): void {
  const cancelAndHold = (
    gain as AudioParam & {
      cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
    }
  ).cancelAndHoldAtTime;
  if (cancelAndHold) {
    cancelAndHold.call(gain, time);
    return;
  }
  const value = gain.value;
  gain.cancelScheduledValues(time);
  gain.setValueAtTime(value, time);
}

function mediaErrorMessage(error: MediaError): string {
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Audio loading was aborted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "A network error interrupted audio loading.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The browser could not decode this audio preview.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This audio source or format is not supported.";
    default:
      return error.message || "The audio element reported an error.";
  }
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampTime(value: number, duration: number): number {
  const time = Math.max(finiteOrZero(value), 0);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(time, duration)
    : time;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
