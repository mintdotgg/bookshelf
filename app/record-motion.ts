export type RecordPose = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
};

export type RecordFootprint = RecordPose & {
  id: string;
  width: number;
  thickness: number;
};

export type MotionRecordSize = {
  width: number;
  thickness: number;
};

export type RecordMotionLayout = {
  shelvedZ: number;
  presentedZ: number;
  rotationLaneZ: number;
  presentedScale: number;
  collisionMargin: number;
};

export type BrowseMotionPhase =
  | "retreat-current"
  | "turn-current"
  | "shelve-current"
  | "extract-next"
  | "turn-next"
  | "settle-next";

export const shelvedYaw = Math.PI / 2;
export const presentedYaw = Math.PI * 0.42;
export const recordShelfGap = 0.22;

const presentedX = -0.2;
const shelvedZ = -0.64;
const minimumPresentedZ = 0.62;
const presentedScale = 1.02;
const maximumFocusScale = 1.08;
const collisionMargin = 0.045;

export const browsePhaseDuration: Record<BrowseMotionPhase, number> = {
  "retreat-current": 0.18,
  "turn-current": 0.22,
  "shelve-current": 0.2,
  "extract-next": 0.2,
  "turn-next": 0.22,
  "settle-next": 0.24,
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smooth(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function smoother(value: number) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export function createRecordMotionLayout(
  records: MotionRecordSize[],
): RecordMotionLayout {
  const maxShelvedHalfDepth = records.reduce(
    (maximum, record) => Math.max(maximum, record.width * 0.5),
    0,
  );
  const maxPresentedHalfDepth = records.reduce(
    (maximum, record) =>
      Math.max(
        maximum,
        (record.width * 0.5 * Math.abs(Math.sin(presentedYaw)) +
          record.thickness * 0.5 * Math.abs(Math.cos(presentedYaw))) *
          presentedScale,
      ),
    0,
  );
  const maxRotationRadius = records.reduce(
    (maximum, record) =>
      Math.max(
        maximum,
        Math.hypot(record.width, record.thickness) *
          0.5 *
          maximumFocusScale,
      ),
    0,
  );
  const presentedZ = Math.max(
    minimumPresentedZ,
    shelvedZ +
      maxShelvedHalfDepth +
      maxPresentedHalfDepth +
      collisionMargin * 2,
  );

  return {
    shelvedZ,
    presentedZ,
    rotationLaneZ:
      Math.max(
        shelvedZ +
          maxShelvedHalfDepth +
          maxRotationRadius +
          collisionMargin,
        presentedZ + 0.14,
      ),
    presentedScale,
    collisionMargin,
  };
}

export function shelvedRecordPose(layout: RecordMotionLayout): RecordPose {
  return {
    x: 0,
    z: layout.shelvedZ,
    yaw: shelvedYaw,
    scale: 1,
  };
}

export function presentedRecordPose(layout: RecordMotionLayout): RecordPose {
  return {
    x: presentedX,
    z: layout.presentedZ,
    yaw: presentedYaw,
    scale: layout.presentedScale,
  };
}

export function browseRecordMotionPose(
  phase: BrowseMotionPhase,
  progress: number,
  layout: RecordMotionLayout,
): RecordPose {
  const t = smoother(progress);

  switch (phase) {
    case "retreat-current":
      return {
        x: presentedX,
        z: lerp(layout.presentedZ, layout.rotationLaneZ, t),
        yaw: presentedYaw,
        scale: lerp(layout.presentedScale, 1, t),
      };
    case "turn-current":
      return {
        x: lerp(presentedX, 0, t),
        z: layout.rotationLaneZ,
        yaw: lerp(presentedYaw, shelvedYaw, t),
        scale: 1,
      };
    case "shelve-current":
      return {
        x: 0,
        z: lerp(layout.rotationLaneZ, layout.shelvedZ, t),
        yaw: shelvedYaw,
        scale: 1,
      };
    case "extract-next":
      return {
        x: 0,
        z: lerp(layout.shelvedZ, layout.rotationLaneZ, t),
        yaw: shelvedYaw,
        scale: 1,
      };
    case "turn-next":
      return {
        x: lerp(0, presentedX, t),
        z: layout.rotationLaneZ,
        yaw: lerp(shelvedYaw, presentedYaw, t),
        scale: 1,
      };
    case "settle-next":
      return {
        x: presentedX,
        z: lerp(layout.rotationLaneZ, layout.presentedZ, t),
        yaw: presentedYaw,
        scale: lerp(1, layout.presentedScale, t),
      };
  }
}

export function focusedRecordPose(
  progress: number,
  layout: RecordMotionLayout,
  focusX: number,
  focusZ: number,
  focusScale: number,
): RecordPose {
  const value = clamp01(progress);
  const clearanceProgress = smooth(Math.min(1, value / 0.55));
  const presentationProgress = smooth(
    Math.max(0, (value - 0.55) / 0.45),
  );

  return {
    x: lerp(presentedX, focusX, presentationProgress),
    z: lerp(layout.presentedZ, focusZ, clearanceProgress),
    yaw: lerp(presentedYaw, 0, presentationProgress),
    scale: lerp(
      layout.presentedScale,
      focusScale,
      presentationProgress,
    ),
  };
}

type Axis = { x: number; z: number };

function dot(left: Axis, right: Axis) {
  return left.x * right.x + left.z * right.z;
}

function axesFor(footprint: RecordFootprint) {
  const cosine = Math.cos(footprint.yaw);
  const sine = Math.sin(footprint.yaw);
  return {
    width: { x: cosine, z: -sine },
    thickness: { x: sine, z: cosine },
  };
}

export function recordFootprintsOverlap(
  left: RecordFootprint,
  right: RecordFootprint,
  margin = collisionMargin,
) {
  const leftAxes = axesFor(left);
  const rightAxes = axesFor(right);
  const axes = [
    leftAxes.width,
    leftAxes.thickness,
    rightAxes.width,
    rightAxes.thickness,
  ];
  const centerDelta = {
    x: right.x - left.x,
    z: right.z - left.z,
  };
  const leftHalfWidth = left.width * left.scale * 0.5 + margin * 0.5;
  const leftHalfThickness =
    left.thickness * left.scale * 0.5 + margin * 0.5;
  const rightHalfWidth =
    right.width * right.scale * 0.5 + margin * 0.5;
  const rightHalfThickness =
    right.thickness * right.scale * 0.5 + margin * 0.5;

  return axes.every((axis) => {
    const distance = Math.abs(dot(centerDelta, axis));
    const leftRadius =
      leftHalfWidth * Math.abs(dot(leftAxes.width, axis)) +
      leftHalfThickness * Math.abs(dot(leftAxes.thickness, axis));
    const rightRadius =
      rightHalfWidth * Math.abs(dot(rightAxes.width, axis)) +
      rightHalfThickness * Math.abs(dot(rightAxes.thickness, axis));
    return distance < leftRadius + rightRadius;
  });
}

export type VinylPose = {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  scale: number;
};

export type TonearmPose = {
  yaw: number;
  lift: number;
};

export type CueMotionLayout = {
  sleevedVinyl: VinylPose;
  extractedVinyl: VinylPose;
  turntableApproachVinyl: VinylPose;
  platterVinyl: VinylPose;
  tonearmRestYaw: number;
  tonearmLeadInYaw: number;
  tonearmRunoutYaw: number;
  tonearmRaisedLift: number;
  tonearmContactLift: number;
};

export type CueMotionPhase =
  | "extract-vinyl"
  | "transport-to-turntable"
  | "lower-tonearm"
  | "playing"
  | "raise-tonearm"
  | "return-to-sleeve"
  | "reinsert-vinyl";

export type CueMotionPose = {
  vinyl: VinylPose;
  tonearm: TonearmPose;
  platterSpeed: number;
  stylusContact: number;
};

function interpolateVinylPose(
  from: VinylPose,
  to: VinylPose,
  progress: number,
): VinylPose {
  const t = smooth(progress);
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    z: lerp(from.z, to.z, t),
    pitch: lerp(from.pitch, to.pitch, t),
    yaw: lerp(from.yaw, to.yaw, t),
    roll: lerp(from.roll, to.roll, t),
    scale: lerp(from.scale, to.scale, t),
  };
}

function vinylExtractionPose(
  progress: number,
  layout: CueMotionLayout,
): VinylPose {
  return interpolateVinylPose(
    layout.sleevedVinyl,
    layout.extractedVinyl,
    progress,
  );
}

function vinylTransportPose(
  progress: number,
  layout: CueMotionLayout,
): VinylPose {
  const value = clamp01(progress);
  const approachEnd = 0.68;

  if (value <= approachEnd) {
    return interpolateVinylPose(
      layout.extractedVinyl,
      layout.turntableApproachVinyl,
      value / approachEnd,
    );
  }

  return interpolateVinylPose(
    layout.turntableApproachVinyl,
    layout.platterVinyl,
    (value - approachEnd) / (1 - approachEnd),
  );
}

function grooveYaw(progress: number, layout: CueMotionLayout) {
  return lerp(
    layout.tonearmLeadInYaw,
    layout.tonearmRunoutYaw,
    clamp01(progress),
  );
}

function tonearmLoweringPose(
  progress: number,
  grooveProgress: number,
  layout: CueMotionLayout,
): TonearmPose {
  const value = clamp01(progress);
  const positioningEnd = 0.62;
  const targetYaw = grooveYaw(grooveProgress, layout);

  if (value <= positioningEnd) {
    return {
      yaw: lerp(
        layout.tonearmRestYaw,
        targetYaw,
        smooth(value / positioningEnd),
      ),
      lift: layout.tonearmRaisedLift,
    };
  }

  return {
    yaw: targetYaw,
    lift: lerp(
      layout.tonearmRaisedLift,
      layout.tonearmContactLift,
      smooth((value - positioningEnd) / (1 - positioningEnd)),
    ),
  };
}

function restingTonearm(layout: CueMotionLayout): TonearmPose {
  return {
    yaw: layout.tonearmRestYaw,
    lift: layout.tonearmRaisedLift,
  };
}

function cueContact(progress: number) {
  const positioningEnd = 0.62;
  return smooth((clamp01(progress) - positioningEnd) / (1 - positioningEnd));
}

/**
 * Samples one deterministic phase of the record cue choreography.
 *
 * `progress` and `grooveProgress` are normalized to [0, 1]. Callers may run
 * progress forward or backward; no hidden timing state is retained. For the
 * `playing` phase, progress is used as the groove position when an explicit
 * grooveProgress is omitted.
 */
export function cueMotionPose(
  phase: CueMotionPhase,
  progress: number,
  layout: CueMotionLayout,
  grooveProgress = progress,
): CueMotionPose {
  const value = clamp01(progress);
  const groove = clamp01(grooveProgress);
  const rest = restingTonearm(layout);

  switch (phase) {
    case "extract-vinyl":
      return {
        vinyl: vinylExtractionPose(value, layout),
        tonearm: rest,
        platterSpeed: 0,
        stylusContact: 0,
      };
    case "transport-to-turntable":
      return {
        vinyl: vinylTransportPose(value, layout),
        tonearm: rest,
        platterSpeed: 0,
        stylusContact: 0,
      };
    case "lower-tonearm":
      return {
        vinyl: { ...layout.platterVinyl },
        tonearm: tonearmLoweringPose(value, groove, layout),
        platterSpeed: smooth(value / 0.45),
        stylusContact: cueContact(value),
      };
    case "playing":
      return {
        vinyl: { ...layout.platterVinyl },
        tonearm: {
          yaw: grooveYaw(groove, layout),
          lift: layout.tonearmContactLift,
        },
        platterSpeed: 1,
        stylusContact: 1,
      };
    case "raise-tonearm":
      return {
        vinyl: { ...layout.platterVinyl },
        tonearm: tonearmLoweringPose(1 - value, groove, layout),
        platterSpeed: 1 - smooth((value - 0.45) / 0.55),
        stylusContact: cueContact(1 - value),
      };
    case "return-to-sleeve":
      return {
        vinyl: vinylTransportPose(1 - value, layout),
        tonearm: rest,
        platterSpeed: 0,
        stylusContact: 0,
      };
    case "reinsert-vinyl":
      return {
        vinyl: vinylExtractionPose(1 - value, layout),
        tonearm: rest,
        platterSpeed: 0,
        stylusContact: 0,
      };
  }
}
