export type PlaybackMode =
  | "idle"
  | "loading"
  | "cueing"
  | "playing"
  | "paused"
  | "seeking"
  | "stopping"
  | "error";

export type PlaybackResumeMode = "playing" | "paused";

export type PlaybackState = {
  mode: PlaybackMode;
  requestId: number;
  trackId: string | null;
  src: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
  playWhenReady: boolean;
  resumeAfterSeek: PlaybackResumeMode;
};

export type PlaybackAction =
  | {
      type: "LOAD";
      trackId: string;
      src: string;
      autoplay?: boolean;
    }
  | {
      type: "SELECT_CATALOG_TRACK";
      trackId: string;
      duration?: number;
    }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; time: number }
  | { type: "STOP" }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "CLEAR_ERROR" }
  | {
      type: "MEDIA_READY";
      requestId: number;
      duration?: number;
    }
  | { type: "MEDIA_PLAYING"; requestId: number }
  | { type: "MEDIA_PAUSED"; requestId: number }
  | {
      type: "MEDIA_TIME";
      requestId: number;
      currentTime: number;
      duration?: number;
    }
  | {
      type: "MEDIA_SEEKED";
      requestId: number;
      currentTime: number;
    }
  | { type: "MEDIA_ENDED"; requestId: number }
  | { type: "MEDIA_STOPPED"; requestId: number }
  | {
      type: "MEDIA_ERROR";
      requestId: number;
      message: string;
    }
  | { type: "CUE_COMPLETE"; requestId: number };

export function initialPlaybackState(volume = 0.82): PlaybackState {
  return {
    mode: "idle",
    requestId: 0,
    trackId: null,
    src: null,
    currentTime: 0,
    duration: 0,
    volume: clampUnit(volume),
    error: null,
    playWhenReady: false,
    resumeAfterSeek: "paused",
  };
}

export function reducePlaybackState(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case "LOAD":
      return loadTrack(state, action);
    case "SELECT_CATALOG_TRACK":
      return {
        ...state,
        mode: "idle",
        requestId: state.requestId + 1,
        trackId: action.trackId,
        src: null,
        currentTime: 0,
        duration: Math.max(
          Number.isFinite(action.duration) ? (action.duration ?? 0) : 0,
          0,
        ),
        error: null,
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "PLAY":
      return requestPlay(state);
    case "PAUSE":
      return requestPause(state);
    case "SEEK":
      return requestSeek(state, action.time);
    case "STOP":
      if (state.mode === "stopping") return state;
      if (state.mode === "idle" && state.currentTime === 0) return state;
      return {
        ...state,
        mode: "stopping",
        error: null,
        playWhenReady: false,
      };
    case "SET_VOLUME": {
      const volume = clampUnit(action.volume);
      return volume === state.volume ? state : { ...state, volume };
    }
    case "CLEAR_ERROR":
      if (state.mode !== "error") return state;
      return {
        ...state,
        mode: "idle",
        currentTime: 0,
        error: null,
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "MEDIA_READY":
      if (!isCurrentRequest(state, action.requestId)) return state;
      return mediaReady(state, action.duration);
    case "MEDIA_PLAYING":
      if (
        !isCurrentRequest(state, action.requestId) ||
        state.mode === "stopping" ||
        state.mode === "error"
      ) {
        return state;
      }
      if (
        state.mode !== "playing" &&
        state.mode !== "cueing" &&
        !state.playWhenReady &&
        !(
          state.mode === "seeking" &&
          state.resumeAfterSeek === "playing"
        )
      ) {
        return state;
      }
      if (
        state.mode === "playing" &&
        !state.playWhenReady &&
        state.error === null
      ) {
        return state;
      }
      return {
        ...state,
        mode: "playing",
        error: null,
        playWhenReady: false,
        resumeAfterSeek: "playing",
      };
    case "MEDIA_PAUSED":
      if (
        !isCurrentRequest(state, action.requestId) ||
        (state.mode !== "playing" && state.mode !== "cueing")
      ) {
        return state;
      }
      return {
        ...state,
        mode: "paused",
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "MEDIA_TIME":
      if (!isCurrentRequest(state, action.requestId)) return state;
      return updateTime(state, action.currentTime, action.duration);
    case "MEDIA_SEEKED":
      if (!isCurrentRequest(state, action.requestId)) return state;
      if (state.mode !== "seeking") {
        return {
          ...state,
          currentTime: clampTime(action.currentTime, state.duration),
        };
      }
      return {
        ...state,
        mode: state.resumeAfterSeek,
        currentTime: clampTime(action.currentTime, state.duration),
        playWhenReady: false,
      };
    case "MEDIA_ENDED":
      if (!isCurrentRequest(state, action.requestId)) return state;
      return {
        ...state,
        mode: "stopping",
        currentTime: state.duration,
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "MEDIA_STOPPED":
      if (!isCurrentRequest(state, action.requestId)) return state;
      if (
        state.mode === "idle" &&
        state.currentTime === 0 &&
        state.error === null
      ) {
        return state;
      }
      return {
        ...state,
        mode: "idle",
        currentTime: 0,
        error: null,
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "MEDIA_ERROR":
      if (!isCurrentRequest(state, action.requestId)) return state;
      return {
        ...state,
        mode: "error",
        error: action.message || "Audio playback failed.",
        playWhenReady: false,
        resumeAfterSeek: "paused",
      };
    case "CUE_COMPLETE":
      if (
        !isCurrentRequest(state, action.requestId) ||
        state.mode !== "cueing"
      ) {
        return state;
      }
      return {
        ...state,
        mode: "playing",
        playWhenReady: false,
        resumeAfterSeek: "playing",
      };
  }
}

export function isCurrentRequest(
  state: PlaybackState,
  requestId: number,
): boolean {
  return requestId === state.requestId;
}

export function canPlay(state: PlaybackState): boolean {
  return (
    state.src !== null &&
    state.mode !== "playing" &&
    state.mode !== "cueing" &&
    state.mode !== "stopping" &&
    state.mode !== "error"
  );
}

export function canPause(state: PlaybackState): boolean {
  return (
    state.mode === "playing" ||
    state.mode === "cueing" ||
    (state.mode === "seeking" && state.resumeAfterSeek === "playing")
  );
}

export function canSeek(state: PlaybackState): boolean {
  return (
    state.src !== null &&
    state.duration > 0 &&
    state.mode !== "loading" &&
    state.mode !== "stopping" &&
    state.mode !== "error"
  );
}

function loadTrack(
  state: PlaybackState,
  action: Extract<PlaybackAction, { type: "LOAD" }>,
): PlaybackState {
  const autoplay = action.autoplay ?? false;
  const isSameTrack =
    state.trackId === action.trackId && state.src === action.src;

  if (isSameTrack && state.mode !== "error") {
    if (!autoplay) return state;
    if (state.mode === "loading") {
      return state.playWhenReady
        ? state
        : { ...state, playWhenReady: true };
    }
    return requestPlay(state);
  }

  return {
    ...state,
    mode: "loading",
    requestId: state.requestId + 1,
    trackId: action.trackId,
    src: action.src,
    currentTime: 0,
    duration: 0,
    error: null,
    playWhenReady: autoplay,
    resumeAfterSeek: autoplay ? "playing" : "paused",
  };
}

function requestPlay(state: PlaybackState): PlaybackState {
  if (
    state.src === null ||
    state.mode === "playing" ||
    state.mode === "cueing" ||
    state.mode === "stopping" ||
    state.mode === "error"
  ) {
    return state;
  }

  if (state.mode === "loading") {
    return state.playWhenReady
      ? state
      : {
          ...state,
          playWhenReady: true,
          resumeAfterSeek: "playing",
        };
  }

  if (state.mode === "seeking") {
    return state.resumeAfterSeek === "playing"
      ? state
      : {
          ...state,
          playWhenReady: true,
          resumeAfterSeek: "playing",
        };
  }

  return {
    ...state,
    mode: "cueing",
    error: null,
    playWhenReady: true,
    resumeAfterSeek: "playing",
  };
}

function requestPause(state: PlaybackState): PlaybackState {
  if (state.mode === "loading") {
    return !state.playWhenReady
      ? state
      : {
          ...state,
          playWhenReady: false,
          resumeAfterSeek: "paused",
        };
  }

  if (state.mode === "seeking") {
    return state.resumeAfterSeek === "paused"
      ? state
      : {
          ...state,
          playWhenReady: false,
          resumeAfterSeek: "paused",
        };
  }

  if (state.mode !== "playing" && state.mode !== "cueing") return state;

  return {
    ...state,
    mode: "paused",
    playWhenReady: false,
    resumeAfterSeek: "paused",
  };
}

function requestSeek(state: PlaybackState, requestedTime: number): PlaybackState {
  if (!canSeek(state)) return state;

  const currentTime = clampTime(requestedTime, state.duration);
  const resumeAfterSeek: PlaybackResumeMode =
    state.mode === "playing" ||
    state.mode === "cueing" ||
    (state.mode === "seeking" && state.resumeAfterSeek === "playing")
      ? "playing"
      : "paused";

  if (
    state.mode === "seeking" &&
    state.currentTime === currentTime &&
    state.resumeAfterSeek === resumeAfterSeek
  ) {
    return state;
  }

  return {
    ...state,
    mode: "seeking",
    currentTime,
    playWhenReady: resumeAfterSeek === "playing",
    resumeAfterSeek,
  };
}

function mediaReady(
  state: PlaybackState,
  duration: number | undefined,
): PlaybackState {
  const nextDuration = normalizeDuration(duration, state.duration);
  if (state.mode !== "loading") {
    return nextDuration === state.duration
      ? state
      : { ...state, duration: nextDuration };
  }

  return {
    ...state,
    mode: state.playWhenReady ? "cueing" : "paused",
    duration: nextDuration,
    error: null,
    resumeAfterSeek: state.playWhenReady ? "playing" : "paused",
  };
}

function updateTime(
  state: PlaybackState,
  currentTime: number,
  duration: number | undefined,
): PlaybackState {
  const nextDuration = normalizeDuration(duration, state.duration);
  const nextTime = clampTime(currentTime, nextDuration);
  if (nextTime === state.currentTime && nextDuration === state.duration) {
    return state;
  }
  return {
    ...state,
    currentTime: nextTime,
    duration: nextDuration,
  };
}

function normalizeDuration(
  duration: number | undefined,
  fallback: number,
): number {
  return duration !== undefined && Number.isFinite(duration) && duration > 0
    ? duration
    : fallback;
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(time, 0), duration > 0 ? duration : time);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
