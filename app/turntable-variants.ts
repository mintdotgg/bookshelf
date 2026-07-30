export const turntablePreferenceKey = "side-one:turntable-variant";
export const legacyTurntablePreferenceKey =
  "needle-archive:turntable-variant";

const chassisCollectionRoot =
  "/assets/mint/turntable-chassis-collection";
const chassisCollectionArtifactStem =
  "vd75nctc66ayy4vqeqfqd5j39n8bfe21";

export type TurntableVariantId =
  | "archive-walnut"
  | "mint-walnut-console"
  | "mint-studio-aluminium"
  | "mint-clear-acrylic";

export type TurntableVariantTransform = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: readonly [number, number, number];
};

export type TurntableVariant = {
  id: TurntableVariantId;
  label: string;
  description: string;
  palette: readonly [string, string, string];
  source: "builtin" | "mint";
  available: boolean;
  assetKey?: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  transform?: TurntableVariantTransform;
};

/**
 * Stable application-facing IDs let a synchronized Mint artifact replace a
 * pending entry without changing settings persistence or scene code.
 */
export const turntableVariants: readonly TurntableVariant[] = [
  {
    id: "archive-walnut",
    label: "Walnut Classic",
    description: "Warm timber plinth with a brushed-metal playback deck.",
    palette: ["#5a3827", "#242722", "#bcb29f"],
    source: "builtin",
    available: true,
  },
  {
    id: "mint-walnut-console",
    label: "Walnut Console",
    description: "A low mid-century chassis with sculpted timber edges.",
    palette: ["#70452d", "#171815", "#d0b78f"],
    source: "mint",
    available: true,
    assetKey: "turntable-chassis-collection",
    modelUrl:
      `${chassisCollectionRoot}/asset_pack_item_glb-${chassisCollectionArtifactStem}` +
      "-0-ks72w1nqrx9pj1g05r5h73zmdd8bf8d6.glb",
    thumbnailUrl:
      `${chassisCollectionRoot}/preview_image-${chassisCollectionArtifactStem}` +
      "-0.webp",
    transform: {
      position: [0, 0.133, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 4.2, 2.86],
    },
  },
  {
    id: "mint-studio-aluminium",
    label: "Studio Aluminium",
    description: "A precise direct-drive shell in satin silver and graphite.",
    palette: ["#c5c7c5", "#363936", "#8d2f26"],
    source: "mint",
    available: true,
    assetKey: "turntable-chassis-collection",
    modelUrl:
      `${chassisCollectionRoot}/asset_pack_item_glb-${chassisCollectionArtifactStem}` +
      "-1-ks74m2ptp855hy0n2jjn5zvg858bfz87.glb",
    thumbnailUrl:
      `${chassisCollectionRoot}/preview_image-${chassisCollectionArtifactStem}` +
      "-1.webp",
    transform: {
      position: [0, 0.147, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 3.55, 3.16],
    },
  },
  {
    id: "mint-clear-acrylic",
    label: "Clear Acrylic",
    description: "A minimal transparent plinth with restrained metal details.",
    palette: ["#dce7e5", "#7a8e8b", "#c0a36d"],
    source: "mint",
    available: true,
    assetKey: "turntable-clear-acrylic",
    modelUrl: "/assets/mint/turntable-clear-acrylic/original_glb.glb",
    thumbnailUrl: "/assets/mint/turntable-clear-acrylic/preview_image.webp",
    transform: {
      position: [0, 0.137, 0],
      rotation: [0, 0, 0],
      scale: [3.57, 3.2, 2.9],
    },
  },
] as const;

export const defaultTurntableVariantId: TurntableVariantId =
  "archive-walnut";

export function isTurntableVariantId(
  value: string | null,
): value is TurntableVariantId {
  return turntableVariants.some((variant) => variant.id === value);
}

export function getTurntableVariant(id: TurntableVariantId) {
  return (
    turntableVariants.find((variant) => variant.id === id) ??
    turntableVariants[0]
  );
}
