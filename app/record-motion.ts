export type RecordPose = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
};

export type SleeveFace = "front" | "back";

export type SleeveFlipPose = {
  yaw: number;
  lift: number;
  scale: number;
};

export type Axis = {
  x: number;
  z: number;
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

export type ShelvedRecordView = {
  recordX: number;
  slotZ: number;
  cameraX: number;
  cameraZ: number;
  width: number;
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
export const presentedYaw = 0;
export const recordShelfGap = 0.22;
export const sleeveFlipDuration = 0.56;

const presentedX = -0.2;
const shelvedZ = -0.64;
const minimumPresentedZ = 1.12;
const presentedScale = 1.02;
const maximumFocusScale = 1.08;
const collisionMargin = 0.045;

export const browsePhaseDuration: Record<BrowseMotionPhase, number> = {
  "retreat-current": 0.15,
  "turn-current": 0.18,
  "shelve-current": 0.17,
  "extract-next": 0.17,
  "turn-next": 0.18,
  "settle-next": 0.2,
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function reinsertProgressForExtraction(
  extractionProgress: number,
  targetReveal: number,
) {
  const target = clamp01(targetReveal);
  if (target >= 1) return 1;
  return clamp01(
    (1 - clamp01(extractionProgress)) / Math.max(1e-6, 1 - target),
  );
}

function smoother(value: number) {
  const t = clamp01(value);
  if (t <= Number.EPSILON) return 0;
  if (t >= 1 - Number.EPSILON) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(start: number, end: number, amount: number) {
  if (amount === 0) return start;
  if (Math.abs(1 - amount) <= 1e-12) return end;
  return start + (end - start) * amount;
}

export function sleeveFaceYaw(face: SleeveFace) {
  return face === "back" ? Math.PI : 0;
}

export function sleeveFlipMotionPose(
  fromYaw: number,
  toYaw: number,
  progress: number,
): SleeveFlipPose {
  const value = clamp01(progress);
  const turn = smoother(value);
  const arc = Math.sin(value * Math.PI);
  return {
    yaw: lerp(fromYaw, toYaw, turn),
    lift: arc * 0.075,
    scale: 1 - arc * 0.012,
  };
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

export function recordSpineAnchor(
  pose: RecordPose,
  width: number,
): Axis {
  return {
    x: pose.x - Math.cos(pose.yaw) * width * 0.5,
    z: pose.z + Math.sin(pose.yaw) * width * 0.5,
  };
}

export function shelvedRecordPose(
  layout: RecordMotionLayout,
  view?: ShelvedRecordView,
): RecordPose {
  if (view) {
    const anchor = {
      x: 0,
      z: layout.shelvedZ + view.width * 0.5,
    };
    const cameraDelta = {
      x: view.cameraX - view.recordX - anchor.x,
      z: view.cameraZ - view.slotZ - anchor.z,
    };
    const yaw = Math.atan2(cameraDelta.z, -cameraDelta.x);
    return {
      x: anchor.x + Math.cos(yaw) * view.width * 0.5,
      z: anchor.z - Math.sin(yaw) * view.width * 0.5,
      yaw,
      scale: 1,
    };
  }

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
  shelvedPose = shelvedRecordPose(layout),
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
        x: lerp(0, shelvedPose.x, t),
        z: lerp(layout.rotationLaneZ, shelvedPose.z, t),
        yaw: lerp(shelvedYaw, shelvedPose.yaw, t),
        scale: 1,
      };
    case "extract-next":
      return {
        x: lerp(shelvedPose.x, 0, t),
        z: lerp(shelvedPose.z, layout.rotationLaneZ, t),
        yaw: lerp(shelvedPose.yaw, shelvedYaw, t),
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
  const clearanceProgress = smoother(Math.min(1, value / 0.55));
  const presentationProgress = smoother(
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
  sleeveMouthVinyl: VinylPose;
  sleeveClearVinyl: VinylPose;
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

export type TrackTransitionMotionPhase =
  | "lift-tonearm"
  | "change-vinyl"
  | "waiting"
  | "lower-tonearm";

export type TrackTransitionMotionKind =
  | "same-side"
  | "flip-side"
  | "swap-disc";

export type CueMotionPose = {
  vinyl: VinylPose;
  tonearm: TonearmPose;
  platterSpeed: number;
  stylusContact: number;
};

export type VinylPresentation =
  | "sleeve"
  | "moving-to-turntable"
  | "turntable"
  | "moving-to-sleeve";

export function cueCameraTurntableMix(
  phase: CueMotionPhase,
  progress: number,
) {
  const value = smoother(clamp01(progress));
  const handoffMix = 0.16;
  switch (phase) {
    case "extract-vinyl":
      return handoffMix * value;
    case "transport-to-turntable":
      return lerp(handoffMix, 1, value);
    case "lower-tonearm":
    case "playing":
    case "raise-tonearm":
      return 1;
    case "return-to-sleeve":
      return lerp(1, handoffMix, value);
    case "reinsert-vinyl":
      return lerp(handoffMix, 0, value);
  }
}

export function vinylPresentationForCue(
  phase: CueMotionPhase | null,
  trackTransitionActive = false,
): VinylPresentation {
  if (trackTransitionActive) return "turntable";
  switch (phase) {
    case "extract-vinyl":
    case "transport-to-turntable":
      return "moving-to-turntable";
    case "lower-tonearm":
    case "playing":
    case "raise-tonearm":
      return "turntable";
    case "return-to-sleeve":
    case "reinsert-vinyl":
      return "moving-to-sleeve";
    case null:
      return "sleeve";
  }
}

function interpolateVinylPose(
  from: VinylPose,
  to: VinylPose,
  progress: number,
): VinylPose {
  const t = smoother(progress);
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

function cubicHermite(
  start: number,
  end: number,
  startTangent: number,
  endTangent: number,
  progress: number,
) {
  const t = clamp01(progress);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * start +
    (t3 - 2 * t2 + t) * startTangent +
    (-2 * t3 + 3 * t2) * end +
    (t3 - t2) * endTangent
  );
}

function vinylExtractionPose(
  progress: number,
  layout: CueMotionLayout,
): VinylPose {
  const value = clamp01(progress);
  const mouthEnd = 0.42;
  const clearEnd = 0.82;

  if (value <= mouthEnd) {
    const firstVelocity =
      (layout.sleeveMouthVinyl.x - layout.sleevedVinyl.x) / mouthEnd;
    const secondVelocity =
      (layout.sleeveClearVinyl.x - layout.sleeveMouthVinyl.x) /
      (clearEnd - mouthEnd);
    return {
      ...layout.sleevedVinyl,
      x: cubicHermite(
        layout.sleevedVinyl.x,
        layout.sleeveMouthVinyl.x,
        0,
        ((firstVelocity + secondVelocity) * 0.5) * mouthEnd,
        value / mouthEnd,
      ),
    };
  }

  if (value <= clearEnd) {
    const firstVelocity =
      (layout.sleeveMouthVinyl.x - layout.sleevedVinyl.x) / mouthEnd;
    const secondVelocity =
      (layout.sleeveClearVinyl.x - layout.sleeveMouthVinyl.x) /
      (clearEnd - mouthEnd);
    return {
      ...layout.sleeveMouthVinyl,
      x: cubicHermite(
        layout.sleeveMouthVinyl.x,
        layout.sleeveClearVinyl.x,
        ((firstVelocity + secondVelocity) * 0.5) *
          (clearEnd - mouthEnd),
        0,
        (value - mouthEnd) / (clearEnd - mouthEnd),
      ),
    };
  }

  return interpolateVinylPose(
    layout.sleeveClearVinyl,
    layout.extractedVinyl,
    (value - clearEnd) / (1 - clearEnd),
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
        smoother(value / positioningEnd),
      ),
      lift: layout.tonearmRaisedLift,
    };
  }

  return {
    yaw: targetYaw,
    lift: lerp(
      layout.tonearmRaisedLift,
      layout.tonearmContactLift,
      smoother((value - positioningEnd) / (1 - positioningEnd)),
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
  return smoother(
    (clamp01(progress) - positioningEnd) / (1 - positioningEnd),
  );
}

export function trackTransitionMotionPose(
  kind: TrackTransitionMotionKind,
  phase: TrackTransitionMotionPhase,
  progress: number,
  layout: CueMotionLayout,
  fromGrooveProgress: number,
  toGrooveProgress: number,
): CueMotionPose {
  const value = clamp01(progress);
  const fromYaw = grooveYaw(fromGrooveProgress, layout);
  const toYaw = grooveYaw(toGrooveProgress, layout);
  const raisedTarget =
    kind === "same-side" ? toYaw : layout.tonearmRestYaw;
  const vinyl = { ...layout.platterVinyl };

  if (phase === "lift-tonearm") {
    const liftEnd = 0.46;
    const lifting = smoother(value / liftEnd);
    const moving = smoother((value - liftEnd) / (1 - liftEnd));
    return {
      vinyl,
      tonearm: {
        yaw: lerp(fromYaw, raisedTarget, moving),
        lift: lerp(
          layout.tonearmContactLift,
          layout.tonearmRaisedLift,
          lifting,
        ),
      },
      platterSpeed: kind === "same-side" ? 1 : 1 - smoother(value),
      stylusContact: 1 - lifting,
    };
  }

  if (phase === "change-vinyl") {
    const liftArc = Math.sin(value * Math.PI);
    if (kind === "flip-side") {
      vinyl.y += liftArc * 0.54;
      vinyl.roll += Math.PI * smoother(value);
    } else if (kind === "swap-disc") {
      const halfProgress =
        value < 0.5
          ? smoother(value * 2)
          : smoother((value - 0.5) * 2);
      vinyl.x +=
        value < 0.5
          ? halfProgress * 0.72
          : -(1 - halfProgress) * 0.72;
      vinyl.y += liftArc * 0.42;
      vinyl.scale *=
        value < 0.5
          ? lerp(1, 0.04, halfProgress)
          : lerp(0.04, 1, halfProgress);
    }
    return {
      vinyl,
      tonearm: {
        yaw: layout.tonearmRestYaw,
        lift: layout.tonearmRaisedLift,
      },
      platterSpeed: 0,
      stylusContact: 0,
    };
  }

  if (phase === "waiting") {
    return {
      vinyl,
      tonearm: {
        yaw: toYaw,
        lift: layout.tonearmRaisedLift,
      },
      platterSpeed: 1,
      stylusContact: 0,
    };
  }

  const lowering = smoother(value);
  return {
    vinyl,
    tonearm: {
      yaw: toYaw,
      lift: lerp(
        layout.tonearmRaisedLift,
        layout.tonearmContactLift,
        lowering,
      ),
    },
    platterSpeed: 1,
    stylusContact: lowering,
  };
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
  reinsertTarget = 0,
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
        platterSpeed: smoother(value / 0.45),
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
        platterSpeed: 1 - smoother((value - 0.45) / 0.55),
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
        vinyl: vinylExtractionPose(
          lerp(1, clamp01(reinsertTarget), value),
          layout,
        ),
        tonearm: rest,
        platterSpeed: 0,
        stylusContact: 0,
      };
  }
}
