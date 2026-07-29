import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordCatalog } from "../app/record-catalog.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sampleRate = 22_050;
const seconds = 18;
const frames = sampleRate * seconds;

function hash(value) {
  let state = 2166136261;
  for (const char of value) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function frequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function envelope(time, beatTime, attack, decay) {
  const age = time - beatTime;
  if (age < 0 || age > decay) return 0;
  return Math.min(1, age / attack) * Math.exp((-4.2 * age) / decay);
}

function writeWav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      44 + index * 2,
    );
  });
  return buffer;
}

function synthesize(seedText, trackNumber) {
  const seed = hash(seedText);
  const random = randomSource(seed);
  const bpm = 74 + (seed % 35);
  const beat = 60 / bpm;
  const root = 42 + (seed % 10);
  const scale = [0, 2, 3, 5, 7, 9, 10];
  const progression = [0, 5, 3, 6].map(
    (degree, index) => root + scale[(degree + trackNumber + index) % scale.length],
  );
  const noise = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    noise[index] = random() * 2 - 1;
  }

  const output = new Float32Array(frames);
  let filteredNoise = 0;
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate;
    const beatIndex = Math.floor(time / beat);
    const beatPhase = time - beatIndex * beat;
    const bar = Math.floor(beatIndex / 4);
    const chordRoot = progression[bar % progression.length];
    const chord = [chordRoot, chordRoot + 3, chordRoot + 7, chordRoot + 10];

    let pad = 0;
    chord.forEach((note, voice) => {
      const hz = frequency(note + 12);
      const drift = 1 + Math.sin(time * (0.07 + voice * 0.013) + voice) * 0.0025;
      pad +=
        Math.sin(Math.PI * 2 * hz * drift * time + voice * 0.7) * 0.11 +
        Math.sin(Math.PI * 2 * hz * 2.01 * time + voice) * 0.025;
    });
    pad *= 0.72 + Math.sin(time * 0.29) * 0.12;

    const bassHz = frequency(chordRoot - 12);
    const bassEnvelope = Math.exp(-beatPhase * 2.2);
    const bass =
      (Math.sin(Math.PI * 2 * bassHz * time) +
        Math.sin(Math.PI * 2 * bassHz * 0.5 * time) * 0.26) *
      bassEnvelope *
      0.2;

    const eighth = beat / 2;
    const pluckIndex = Math.floor(time / eighth);
    const pluckTime = pluckIndex * eighth;
    const note =
      chord[(pluckIndex + trackNumber) % chord.length] +
      12 +
      (pluckIndex % 3 === 0 ? 7 : 0);
    const pluckEnvelope = envelope(time, pluckTime, 0.008, eighth * 0.88);
    const pluck =
      (Math.sin(Math.PI * 2 * frequency(note) * time) +
        Math.sin(Math.PI * 2 * frequency(note) * 2 * time) * 0.22) *
      pluckEnvelope *
      0.14;

    const kickEnvelope = envelope(time, beatIndex * beat, 0.004, beat * 0.34);
    const kick =
      Math.sin(
        Math.PI *
          2 *
          (48 + 72 * Math.exp(-beatPhase * 18)) *
          beatPhase,
      ) *
      kickEnvelope *
      0.24;

    filteredNoise += (noise[index] - filteredNoise) * 0.055;
    const snareBeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
    const snareEnvelope = snareBeat
      ? envelope(time, beatIndex * beat, 0.003, beat * 0.26)
      : 0;
    const percussion = filteredNoise * snareEnvelope * 0.095;

    const shimmer =
      Math.sin(Math.PI * 2 * (frequency(root + 31) + Math.sin(time) * 1.4) * time) *
      (0.018 + Math.sin(time * 0.51 + trackNumber) * 0.006);
    const fadeIn = Math.min(1, time / 1.2);
    const fadeOut = Math.min(1, (seconds - time) / 1.8);
    const mixed = (pad + bass + pluck + kick + percussion + shimmer) * fadeIn * fadeOut;
    output[index] = Math.tanh(mixed * 1.55) * 0.78;
  }
  return output;
}

for (const record of recordCatalog) {
  for (const track of record.tracks) {
    if (!track.previewUrl) continue;
    const outputPath = resolve(projectRoot, "public", track.previewUrl.slice(1));
    await mkdir(dirname(outputPath), { recursive: true });
    const samples = synthesize(`${record.id}:${track.id}`, track.trackNumber);
    await writeFile(outputPath, writeWav(samples));
    process.stdout.write(`${track.previewUrl}\n`);
  }
}
