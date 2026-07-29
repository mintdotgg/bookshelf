export type AudioBandLayout = {
  readonly frequencyBinCount: number;
  readonly bandCount: number;
  readonly minFrequency: number;
  readonly maxFrequency: number;
  readonly startBins: Uint32Array;
  readonly endBins: Uint32Array;
  readonly centerFrequencies: Float32Array;
};

export type LogBandLayoutOptions = {
  frequencyBinCount: number;
  sampleRate: number;
  bandCount: number;
  minFrequency?: number;
  maxFrequency?: number;
};

export type BandSamplingOptions = {
  noiseFloor?: number;
  gain?: number;
  curve?: number;
};

export type BandSmoothingOptions = {
  attack?: number;
  release?: number;
};

const defaultBandSampling: Required<BandSamplingOptions> = {
  noiseFloor: 0.025,
  gain: 1,
  curve: 0.82,
};

const defaultBandSmoothing: Required<BandSmoothingOptions> = {
  attack: 18,
  release: 6,
};

export function createLogBandLayout({
  frequencyBinCount,
  sampleRate,
  bandCount,
  minFrequency = 45,
  maxFrequency = 16_000,
}: LogBandLayoutOptions): AudioBandLayout {
  if (!Number.isInteger(frequencyBinCount) || frequencyBinCount <= 0) {
    throw new RangeError("frequencyBinCount must be a positive integer.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be greater than zero.");
  }
  if (!Number.isInteger(bandCount) || bandCount <= 0) {
    throw new RangeError("bandCount must be a positive integer.");
  }

  const nyquist = sampleRate / 2;
  const safeMin = Math.min(Math.max(minFrequency, 1), nyquist);
  const safeMax = Math.min(Math.max(maxFrequency, safeMin), nyquist);
  const binWidth = nyquist / frequencyBinCount;
  const startBins = new Uint32Array(bandCount);
  const endBins = new Uint32Array(bandCount);
  const centerFrequencies = new Float32Array(bandCount);
  const ratio = safeMax / safeMin;

  for (let band = 0; band < bandCount; band += 1) {
    const low = safeMin * ratio ** (band / bandCount);
    const high = safeMin * ratio ** ((band + 1) / bandCount);
    const start = Math.min(
      Math.max(Math.floor(low / binWidth), 0),
      frequencyBinCount - 1,
    );
    const end = Math.min(
      Math.max(Math.ceil(high / binWidth), start + 1),
      frequencyBinCount,
    );

    startBins[band] = start;
    endBins[band] = end;
    centerFrequencies[band] = Math.sqrt(low * high);
  }

  return {
    frequencyBinCount,
    bandCount,
    minFrequency: safeMin,
    maxFrequency: safeMax,
    startBins,
    endBins,
    centerFrequencies,
  };
}

/**
 * Writes normalized RMS energy into `output`. The caller owns and reuses the
 * output buffer, so this function performs no per-frame allocations.
 */
export function writeBandLevels(
  frequencyData: Uint8Array,
  layout: AudioBandLayout,
  output: Float32Array,
  options: BandSamplingOptions = defaultBandSampling,
): Float32Array {
  if (frequencyData.length < layout.frequencyBinCount) {
    throw new RangeError("frequencyData is smaller than its band layout.");
  }
  if (output.length < layout.bandCount) {
    throw new RangeError("output is smaller than its band layout.");
  }

  const noiseFloor = clampUnit(
    options.noiseFloor ?? defaultBandSampling.noiseFloor,
  );
  const gain = Math.max(options.gain ?? defaultBandSampling.gain, 0);
  const curve = Math.max(options.curve ?? defaultBandSampling.curve, 0.001);
  const usableRange = Math.max(1 - noiseFloor, Number.EPSILON);

  for (let band = 0; band < layout.bandCount; band += 1) {
    const start = layout.startBins[band];
    const end = layout.endBins[band];
    let sumSquares = 0;

    for (let bin = start; bin < end; bin += 1) {
      const normalized = frequencyData[bin] / 255;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / Math.max(end - start, 1));
    const floored = Math.max((rms - noiseFloor) / usableRange, 0);
    output[band] = clampUnit(floored ** curve * gain);
  }

  return output;
}

/**
 * Smooths `input` into the caller-owned `output` buffer in place. Rates are
 * exponential response rates in hertz-like units, independent of frame rate.
 */
export function smoothBandLevels(
  input: Float32Array,
  output: Float32Array,
  deltaSeconds: number,
  options: BandSmoothingOptions = defaultBandSmoothing,
): Float32Array {
  if (output.length < input.length) {
    throw new RangeError("output must be at least as large as input.");
  }

  const delta = Number.isFinite(deltaSeconds)
    ? Math.max(deltaSeconds, 0)
    : 0;
  const attack = Math.max(
    options.attack ?? defaultBandSmoothing.attack,
    0,
  );
  const release = Math.max(
    options.release ?? defaultBandSmoothing.release,
    0,
  );

  for (let index = 0; index < input.length; index += 1) {
    const target = clampUnit(input[index]);
    const current = output[index];
    const rate = target > current ? attack : release;
    const response = rate === 0 ? 0 : 1 - Math.exp(-rate * delta);
    output[index] = current + (target - current) * response;
  }

  return output;
}

export function rmsBandLevel(levels: Float32Array): number {
  if (levels.length === 0) return 0;

  let sumSquares = 0;
  for (let index = 0; index < levels.length; index += 1) {
    const value = clampUnit(levels[index]);
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / levels.length);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
