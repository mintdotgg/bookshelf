import type {
  CatalogRecord,
  RecordMotif,
  RecordSide,
} from "./record-catalog";
import {
  getSleeveSpineTextureSize,
  resolveSleeveDimensions,
} from "./sleeve-spec";
import {
  formatBackCoverTrack,
  getImportedBackCoverTrackLayout,
} from "./back-cover-layout";

const displayFace =
  '"Newsreader Variable", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const sans = '"Inter Variable", Inter, Arial, sans-serif';

const SURFACE_RESOLUTION = 768;
const LABEL_RESOLUTION = 512;

const importedBackPalette = {
  paper: "#e9e1d5",
  paperDeep: "#d7c7b2",
  ink: "#241f1a",
  inkMuted: "#675d53",
  accent: "#8d674b",
} as const;

type Point = readonly [number, number];

function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCanvas(width: number, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function line(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  width = 4,
) {
  const first = points[0];
  if (!first) return;

  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.lineWidth = width;
  ctx.stroke();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    const finalIndex = visible.length - 1;
    let finalLine = visible[finalIndex];
    while (
      finalLine &&
      ctx.measureText(`${finalLine}…`).width > maxWidth
    ) {
      finalLine = finalLine.replace(/\s+\S+$/, "");
    }
    visible[finalIndex] = `${finalLine}…`;
  }

  visible.forEach((entry, index) => {
    ctx.fillText(entry, x, y + index * lineHeight);
  });
  return visible.length;
}

function addSleeveGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: string,
) {
  const random = seeded(`${seed}:grain`);
  ctx.save();

  for (let i = 0; i < 1250; i += 1) {
    const light = random() > 0.48;
    const alpha = 0.016 + random() * 0.034;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha})`;
    const size = 0.4 + random() * 1.8;
    ctx.fillRect(random() * width, random() * height, size, size);
  }

  ctx.restore();
}

function paintSleeveBase(
  ctx: CanvasRenderingContext2D,
  record: CatalogRecord,
  width: number,
  height: number,
  variant: "front" | "back",
) {
  ctx.fillStyle = record.sleeveColor;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    variant === "front" ? width * 0.72 : width * 0.28,
    height * 0.34,
    width * 0.04,
    width * 0.5,
    height * 0.5,
    width * 0.82,
  );
  glow.addColorStop(0, `${record.accent}36`);
  glow.addColorStop(0.52, `${record.accent}0f`);
  glow.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function drawSignalBloom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const centerX = width * 0.61;
  const centerY = height * 0.59;

  for (let ring = 0; ring < 11; ring += 1) {
    const radius = 38 + ring * 28;
    ctx.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const angle = (step / 96) * Math.PI * 2;
      const distortion =
        Math.sin(angle * (3 + (ring % 4)) + ring * 0.8) * (5 + ring * 0.8) +
        (random() - 0.5) * 2;
      const x = centerX + Math.cos(angle) * (radius + distortion);
      const y = centerY + Math.sin(angle) * (radius + distortion);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.16 + ring * 0.035;
    ctx.lineWidth = ring % 4 === 0 ? 7 : 2.5;
    ctx.stroke();
  }
}

function drawTidalLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  for (let row = 0; row < 18; row += 1) {
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 8) {
      const y =
        height * 0.36 +
        row * 24 +
        Math.sin(x * 0.018 + row * 0.54) * (17 + row * 1.2) +
        Math.sin(x * 0.006 + random()) * 8;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.25 + (row % 5) * 0.08;
    ctx.lineWidth = row % 5 === 0 ? 6 : 2;
    ctx.stroke();
  }
}

function drawNightGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const horizon = height * 0.47;
  ctx.globalAlpha = 0.6;

  for (let column = -7; column <= 7; column += 1) {
    line(
      ctx,
      [
        [width / 2, horizon],
        [width / 2 + column * 83, height + 40],
      ],
      column % 4 === 0 ? 5 : 2,
    );
  }

  for (let row = 0; row < 11; row += 1) {
    const t = row / 10;
    const y = horizon + Math.pow(t, 1.65) * (height - horizon);
    line(ctx, [[0, y], [width, y]], row % 3 === 0 ? 4 : 2);
  }

  for (let i = 0; i < 16; i += 1) {
    const x = random() * width;
    const y = 90 + random() * (horizon - 130);
    ctx.globalAlpha = 0.4 + random() * 0.55;
    ctx.fillRect(x, y, 2 + random() * 4, 2 + random() * 4);
  }
}

function drawCutPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  for (let layer = 0; layer < 12; layer += 1) {
    const cx = width * (0.32 + random() * 0.38);
    const cy = height * (0.38 + random() * 0.39);
    const radius = 48 + random() * 145;
    const sides = 5 + Math.floor(random() * 5);
    ctx.beginPath();
    for (let point = 0; point < sides; point += 1) {
      const angle = (point / sides) * Math.PI * 2 + random() * 0.22;
      const scale = 0.72 + random() * 0.36;
      const x = cx + Math.cos(angle) * radius * scale;
      const y = cy + Math.sin(angle) * radius * scale;
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.12 + layer * 0.045;
    if (layer % 3 === 0) ctx.fill();
    else {
      ctx.lineWidth = 4 + (layer % 4);
      ctx.stroke();
    }
  }
}

function drawOrbitCluster(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const nodes: Point[] = [];
  for (let i = 0; i < 15; i += 1) {
    nodes.push([
      width * (0.18 + random() * 0.64),
      height * (0.34 + random() * 0.5),
    ]);
  }

  nodes.forEach(([x, y], index) => {
    ctx.globalAlpha = 0.24 + (index % 4) * 0.12;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      34 + random() * 85,
      12 + random() * 31,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.lineWidth = index % 5 === 0 ? 5 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, index % 4 === 0 ? 8 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawMagneticField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const centerX = width * 0.53;
  const centerY = height * 0.61;

  for (let index = -10; index <= 10; index += 1) {
    const offset = index * 21;
    ctx.beginPath();
    ctx.moveTo(centerX - 300, centerY + offset);
    ctx.bezierCurveTo(
      centerX - 130,
      centerY + offset * 1.8 + (random() - 0.5) * 22,
      centerX - 92,
      centerY - offset * 1.3,
      centerX,
      centerY - offset * 0.35,
    );
    ctx.bezierCurveTo(
      centerX + 92,
      centerY - offset * 1.3,
      centerX + 130,
      centerY + offset * 1.8 + (random() - 0.5) * 22,
      centerX + 300,
      centerY + offset,
    );
    ctx.globalAlpha = 0.27 + (10 - Math.abs(index)) * 0.034;
    ctx.lineWidth = index % 5 === 0 ? 6 : 2.5;
    ctx.stroke();
  }
}

function drawGlassPrism(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const centerX = width * 0.52;
  const centerY = height * 0.61;

  for (let index = 0; index < 10; index += 1) {
    const radius = 58 + index * 25;
    const rotation = index * 0.17 + random() * 0.08;
    ctx.beginPath();
    for (let corner = 0; corner < 3; corner += 1) {
      const angle = rotation + (corner / 3) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (corner === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.19 + index * 0.052;
    ctx.lineWidth = index % 3 === 0 ? 6 : 2.5;
    ctx.stroke();
  }
}

function drawTopographic(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
) {
  const centerX = width * 0.54;
  const centerY = height * 0.63;

  for (let ring = 0; ring < 15; ring += 1) {
    const radius = 28 + ring * 19;
    ctx.beginPath();
    for (let step = 0; step <= 84; step += 1) {
      const angle = (step / 84) * Math.PI * 2;
      const wobble =
        Math.sin(angle * 3 + ring * 0.4) * (7 + ring * 0.42) +
        Math.sin(angle * 7 - ring * 0.31) * 4 +
        (random() - 0.5) * 2.2;
      const x = centerX + Math.cos(angle) * (radius + wobble);
      const y = centerY + Math.sin(angle) * (radius * 0.74 + wobble);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.18 + ring * 0.035;
    ctx.lineWidth = ring % 4 === 0 ? 5 : 2;
    ctx.stroke();
  }
}

const motifPainters: Record<
  RecordMotif,
  (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    random: () => number,
  ) => void
> = {
  "signal-bloom": drawSignalBloom,
  "tidal-lines": drawTidalLines,
  "night-grid": drawNightGrid,
  "cut-paper": drawCutPaper,
  "orbit-cluster": drawOrbitCluster,
  "magnetic-field": drawMagneticField,
  "glass-prism": drawGlassPrism,
  topographic: drawTopographic,
};

function drawMotif(
  ctx: CanvasRenderingContext2D,
  record: CatalogRecord,
  width: number,
  height: number,
  seedSuffix: string,
) {
  ctx.save();
  ctx.strokeStyle = record.accent;
  ctx.fillStyle = record.accent;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  motifPainters[record.motif](
    ctx,
    width,
    height,
    seeded(`${record.id}:${seedSuffix}`),
  );
  ctx.restore();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, midpoint).trimEnd()}${ellipsis}`).width <= maxWidth) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  return `${text.slice(0, low).trimEnd()}${ellipsis}`;
}

function importedTracklistType(record: CatalogRecord) {
  if (record.localSource?.provider !== "spotify") return null;
  return record.localSource.type === "album" ||
    record.localSource.type === "playlist"
    ? record.localSource.type
    : null;
}

function drawImportedTracklistBackCover(
  ctx: CanvasRenderingContext2D,
  record: CatalogRecord,
  width: number,
  height: number,
  sourceType: "album" | "playlist",
) {
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, importedBackPalette.paper);
  background.addColorStop(1, importedBackPalette.paperDeep);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  addSleeveGrain(ctx, width, height, `${record.id}:${sourceType}-back`);

  ctx.save();
  ctx.strokeStyle = importedBackPalette.ink;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, width - 40, height - 40);
  ctx.restore();

  ctx.fillStyle = importedBackPalette.inkMuted;
  ctx.textBaseline = "top";
  ctx.font = `650 11px ${sans}`;
  ctx.letterSpacing = "2.6px";
  ctx.fillText(
    sourceType === "album" ? "ALBUM ARCHIVE" : "PLAYLIST ARCHIVE",
    59,
    48,
  );

  ctx.fillStyle = importedBackPalette.ink;
  ctx.letterSpacing = "0px";
  const titleSize = record.title.length > 34 ? 31 : 36;
  ctx.font = `520 ${titleSize}px ${displayFace}`;
  wrapText(ctx, record.title, 58, 73, width - 116, titleSize * 1.02, 2);

  ctx.font = `650 12px ${sans}`;
  ctx.letterSpacing = "1.8px";
  ctx.fillStyle = importedBackPalette.inkMuted;
  ctx.fillText(record.artist.toUpperCase(), 59, 164, width - 260);

  ctx.save();
  ctx.textAlign = "right";
  ctx.fillText(
    `${record.tracks.length} ${
      record.tracks.length === 1 ? "TRACK" : "TRACKS"
    }`,
    width - 59,
    164,
  );
  ctx.restore();

  ctx.fillStyle = importedBackPalette.accent;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(59, 193, 76, 4);

  const layout = getImportedBackCoverTrackLayout(record.tracks.length);
  ctx.globalAlpha = 1;
  ctx.fillStyle = importedBackPalette.ink;
  ctx.font = `560 ${layout.fontSize}px ${sans}`;
  ctx.letterSpacing = "0px";

  for (let column = 1; column < layout.columnCount; column += 1) {
    const dividerX =
      59 +
      column * (layout.columnWidth + layout.columnGap) -
      layout.columnGap * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillRect(
      dividerX,
      layout.trackTop - 4,
      1,
      layout.trackBottom - layout.trackTop + 8,
    );
    ctx.restore();
  }

  record.tracks.forEach((track, index) => {
    const column = Math.floor(index / layout.rowsPerColumn);
    const row = index % layout.rowsPerColumn;
    const x = 59 + column * (layout.columnWidth + layout.columnGap);
    const y = layout.trackTop + row * layout.lineHeight;
    const label = formatBackCoverTrack(track, true);
    ctx.fillText(fitText(ctx, label, layout.columnWidth), x, y);
  });

  ctx.fillStyle = importedBackPalette.inkMuted;
  ctx.font = `550 11px ${sans}`;
  ctx.letterSpacing = "1.35px";
  const metadata = [
    record.catalogNumber,
    `${record.rpm} RPM`,
    String(record.year),
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(metadata.toUpperCase(), 59, height - 82, width - 118);

  if (record.edition) {
    ctx.letterSpacing = "0.35px";
    ctx.fillText(record.edition, 59, height - 57, width - 118);
  }
}

export function createFrontCover(record: CatalogRecord) {
  const canvas = createCanvas(SURFACE_RESOLUTION);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.save();
  paintSleeveBase(ctx, record, canvas.width, canvas.height, "front");
  drawMotif(ctx, record, canvas.width, canvas.height, "front");
  addSleeveGrain(ctx, canvas.width, canvas.height, `${record.id}:front`);

  ctx.save();
  ctx.strokeStyle = record.ink;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
  ctx.restore();

  ctx.fillStyle = record.ink;
  ctx.textBaseline = "top";
  ctx.font = `600 18px ${sans}`;
  ctx.letterSpacing = "3px";
  ctx.fillText(record.artist.toUpperCase(), 54, 51);

  ctx.letterSpacing = "0px";
  const titleSize =
    record.title.length > 26 ? 64 : record.title.length > 18 ? 74 : 86;
  ctx.font = `520 ${titleSize}px ${displayFace}`;
  const titleLines = wrapText(
    ctx,
    record.title,
    50,
    91,
    canvas.width - 100,
    titleSize * 0.88,
    3,
  );

  ctx.globalAlpha = 0.74;
  ctx.font = `500 14px ${sans}`;
  ctx.letterSpacing = "2.4px";
  const footer = [record.catalogNumber, String(record.year)]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(footer, 54, canvas.height - 61);

  if (titleLines === 0) ctx.fillText(record.shortTitle, 54, 110);
  ctx.restore();
  return canvas;
}

export function createBackCover(record: CatalogRecord) {
  const canvas = createCanvas(SURFACE_RESOLUTION);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.save();
  const sourceType = importedTracklistType(record);
  if (sourceType) {
    drawImportedTracklistBackCover(
      ctx,
      record,
      canvas.width,
      canvas.height,
      sourceType,
    );
    ctx.restore();
    return canvas;
  }

  paintSleeveBase(ctx, record, canvas.width, canvas.height, "back");
  addSleeveGrain(ctx, canvas.width, canvas.height, `${record.id}:back`);

  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.translate(canvas.width * 0.42, canvas.height * 0.08);
  ctx.scale(0.72, 0.72);
  drawMotif(ctx, record, canvas.width, canvas.height, "back");
  ctx.restore();

  ctx.fillStyle = record.ink;
  ctx.textBaseline = "top";
  ctx.font = `520 35px ${displayFace}`;
  ctx.letterSpacing = "0px";
  ctx.fillText(record.title, 58, 61, canvas.width - 116);

  ctx.font = `600 15px ${sans}`;
  ctx.letterSpacing = "2.3px";
  ctx.fillText(record.artist.toUpperCase(), 59, 112);

  ctx.globalAlpha = 0.82;
  ctx.font = `450 22px ${displayFace}`;
  ctx.letterSpacing = "0px";
  const descriptionLines = wrapText(
    ctx,
    record.description,
    59,
    173,
    canvas.width - 118,
    30,
    7,
  );

  const trackStart = 205 + descriptionLines * 30;
  ctx.globalAlpha = 1;
  ctx.fillStyle = record.accent;
  ctx.fillRect(59, trackStart, 76, 4);

  const trackColumns = record.discCount > 1 ? record.discCount : 1;
  const tracksPerColumn = Math.ceil(record.tracks.length / trackColumns);
  const trackColumnGap = 28;
  const trackColumnWidth =
    (canvas.width - 118 - trackColumnGap * (trackColumns - 1)) / trackColumns;
  const trackLineHeight = 24;
  ctx.fillStyle = record.ink;
  ctx.font = `560 ${trackColumns > 1 ? 14 : 16}px ${sans}`;
  record.tracks.forEach((track, index) => {
    const column = Math.floor(index / tracksPerColumn);
    const row = index % tracksPerColumn;
    ctx.fillText(
      formatBackCoverTrack(track),
      59 + column * (trackColumnWidth + trackColumnGap),
      trackStart + 31 + row * trackLineHeight,
      trackColumnWidth,
    );
  });

  const metadataY = canvas.height - 113;
  ctx.globalAlpha = 0.75;
  ctx.font = `500 12px ${sans}`;
  ctx.letterSpacing = "1.6px";
  const metadata = [
    record.label,
    record.catalogNumber,
    `${record.rpm} RPM`,
    String(record.year),
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(metadata.toUpperCase(), 59, metadataY, canvas.width - 118);

  ctx.letterSpacing = "0.6px";
  ctx.fillText(record.genres.join(" / "), 59, metadataY + 29);
  if (record.edition) {
    ctx.fillText(record.edition, 59, metadataY + 55, canvas.width - 118);
  }

  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = record.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
  ctx.restore();
  return canvas;
}

export function createSpineCover(record: CatalogRecord) {
  const textureSize = getSleeveSpineTextureSize(
    resolveSleeveDimensions(record),
  );
  const canvas = createCanvas(textureSize.width, textureSize.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.save();
  paintSleeveBase(ctx, record, canvas.width, canvas.height, "front");
  addSleeveGrain(ctx, canvas.width, canvas.height, `${record.id}:spine`);

  ctx.fillStyle = record.accent;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(
    canvas.width * 0.08,
    canvas.height * 0.025,
    Math.max(1, canvas.width * 0.055),
    canvas.height * 0.95,
  );

  ctx.save();
  ctx.fillStyle = record.ink;
  ctx.globalAlpha = 1;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `560 ${Math.max(12, canvas.width * 0.38)}px ${displayFace}`;
  ctx.letterSpacing = `${Math.max(0.4, canvas.width * 0.012)}px`;
  ctx.fillText(
    record.shortTitle,
    0,
    -canvas.width * 0.11,
    canvas.height * 0.72,
  );
  ctx.font = `560 ${Math.max(8, canvas.width * 0.18)}px ${sans}`;
  ctx.letterSpacing = `${Math.max(0.5, canvas.width * 0.018)}px`;
  ctx.fillText(
    record.artist.toUpperCase(),
    0,
    canvas.width * 0.24,
    canvas.height * 0.68,
  );
  ctx.restore();

  ctx.fillStyle = record.ink;
  ctx.globalAlpha = 0.72;
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.max(7, canvas.width * 0.14)}px ${sans}`;
  ctx.fillText(
    record.catalogNumber ?? String(record.year),
    canvas.width * 0.56,
    canvas.height * 0.018,
    canvas.width * 0.72,
  );
  ctx.restore();
  return canvas;
}

export function createRecordLabel(
  record: CatalogRecord,
  side: RecordSide = "A",
) {
  const canvas = createCanvas(LABEL_RESOLUTION);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const center = canvas.width / 2;
  const radius = canvas.width * 0.47;
  const random = seeded(`${record.id}:label:${side}`);

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = record.accent;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const wash = ctx.createRadialGradient(
    center * (0.85 + random() * 0.3),
    center * (0.85 + random() * 0.3),
    12,
    center,
    center,
    radius,
  );
  wash.addColorStop(0, "rgba(255,255,255,0.18)");
  wash.addColorStop(1, `${record.sleeveColor}72`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = record.ink;
  ctx.globalAlpha = 0.2;
  for (let ring = 0; ring < 8; ring += 1) {
    ctx.beginPath();
    ctx.arc(center, center, 82 + ring * 19, 0, Math.PI * 2);
    ctx.lineWidth = ring % 3 === 0 ? 3 : 1.5;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = record.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `650 18px ${sans}`;
  ctx.letterSpacing = "2.8px";
  ctx.fillText(record.artist.toUpperCase(), center, 102, 350);

  ctx.font = `540 29px ${displayFace}`;
  ctx.letterSpacing = "0px";
  ctx.fillText(record.shortTitle, center, 145, 350);

  ctx.font = `760 78px ${sans}`;
  ctx.fillText(side, center, 322);

  ctx.font = `600 14px ${sans}`;
  ctx.letterSpacing = "1.4px";
  const discNumber =
    record.tracks.find((track) => track.side === side)?.discNumber ?? 1;
  const footer = [
    record.catalogNumber,
    record.discCount > 1 ? `LP ${discNumber}` : undefined,
    `${record.rpm} RPM`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(footer, center, 400, 340);

  const sideTracks = record.tracks.filter((track) => track.side === side);
  const trackText = sideTracks.length
    ? sideTracks.map((track) => track.title).join(" · ")
    : record.tracks.map((track) => track.title).join(" · ");
  ctx.font = `500 12px ${sans}`;
  ctx.letterSpacing = "0.4px";
  ctx.fillText(trackText, center, 429, 340);

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(center, center, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return canvas;
}

/** Alias retained for terse engine imports. */
export const createLabelArt = createRecordLabel;
