export type SleeveDimensionOverrides = {
  sleeveSize?: number;
  sleeveThickness?: number;
};

export type SleeveDimensions = {
  width: number;
  height: number;
  thickness: number;
};

export type SleeveSpineDimensions = {
  width: number;
  height: number;
  surfaceOffset: number;
};

export const sleeveDefaults = {
  size: 2.16,
  thickness: 0.042,
} as const;

const spineDepthInset = 0.004;
const spineHeightInset = 0.025;
const spineSurfaceOffset = 0.0025;
const spineTextureLongEdge = 2048;

export function resolveSleeveDimensions(
  overrides: SleeveDimensionOverrides,
): SleeveDimensions {
  const size = overrides.sleeveSize ?? sleeveDefaults.size;
  return {
    width: size,
    height: size,
    thickness: overrides.sleeveThickness ?? sleeveDefaults.thickness,
  };
}

export function getSleeveSpineDimensions(
  dimensions: Pick<SleeveDimensions, "height" | "thickness">,
): SleeveSpineDimensions {
  return {
    width: Math.max(0.018, dimensions.thickness - spineDepthInset),
    height: Math.max(0.1, dimensions.height - spineHeightInset),
    surfaceOffset: spineSurfaceOffset,
  };
}

export function getSleeveSpineTextureSize(
  dimensions: Pick<SleeveDimensions, "height" | "thickness">,
) {
  const spine = getSleeveSpineDimensions(dimensions);
  return {
    width: Math.max(
      32,
      Math.round(spineTextureLongEdge * (spine.width / spine.height)),
    ),
    height: spineTextureLongEdge,
  };
}
