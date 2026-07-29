import * as THREE from "three";

export type SleeveModelOptions = {
  width: number;
  height: number;
  thickness: number;
  color: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  frontTexture: THREE.Texture;
  backTexture: THREE.Texture;
  spineTexture: THREE.Texture;
};

export type SleeveModel = {
  root: THREE.Group;
  mouthFlex: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshPhysicalMaterial>;
  frontSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  backSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  spineSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
};

/**
 * Builds a thin, open-sided cardstock pocket. The layered seams and mouth are
 * deliberately separate from the cover artwork so the jacket still reads as a
 * physical sleeve when custom flat artwork is supplied.
 */
export function createSleeveModel(options: SleeveModelOptions): SleeveModel {
  const {
    width,
    height,
    thickness,
    color,
    accent,
    frontTexture,
    backTexture,
    spineTexture,
  } = options;
  const root = new THREE.Group();
  root.name = "recordSleeve";

  const stockColor = new THREE.Color(color);
  const edgeColor = stockColor.clone().multiplyScalar(0.72);
  const foldColor = stockColor.clone().lerp(new THREE.Color(accent), 0.12);
  const innerColor = stockColor
    .clone()
    .lerp(new THREE.Color("#e9e0cf"), 0.38)
    .multiplyScalar(0.78);

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: stockColor,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.16,
    sheenColor: foldColor,
    sheenRoughness: 0.92,
    clearcoat: 0.015,
    clearcoatRoughness: 0.95,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, thickness),
    bodyMaterial,
  );
  body.name = "cardstockPocket";
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const frontSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.018, height - 0.018),
    new THREE.MeshPhysicalMaterial({
      map: frontTexture,
      roughness: 0.84,
      metalness: 0,
      sheen: 0.08,
      sheenRoughness: 0.96,
      clearcoat: 0.018,
      clearcoatRoughness: 0.92,
    }),
  );
  frontSurface.name = "frontArtwork";
  frontSurface.position.z = thickness * 0.5 + 0.0025;
  frontSurface.castShadow = true;
  frontSurface.receiveShadow = true;
  root.add(frontSurface);

  const backSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.018, height - 0.018),
    new THREE.MeshPhysicalMaterial({
      map: backTexture,
      roughness: 0.88,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.96,
    }),
  );
  backSurface.name = "backArtwork";
  backSurface.position.z = -thickness * 0.5 - 0.0025;
  backSurface.rotation.y = Math.PI;
  backSurface.castShadow = true;
  root.add(backSurface);

  const spineSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.018, thickness - 0.008), height - 0.025),
    new THREE.MeshPhysicalMaterial({
      map: spineTexture,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  spineSurface.name = "spineArtwork";
  spineSurface.rotation.y = -Math.PI / 2;
  spineSurface.position.x = -width * 0.5 - 0.0025;
  root.add(spineSurface);

  const seamMaterial = new THREE.MeshStandardMaterial({
    color: foldColor,
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const frontZ = thickness * 0.5 + 0.004;
  const verticalSeam = new THREE.Mesh(
    new THREE.PlaneGeometry(0.012, height - 0.055),
    seamMaterial,
  );
  verticalSeam.name = "foldedLeftSeam";
  verticalSeam.position.set(-width * 0.5 + 0.016, 0, frontZ);
  root.add(verticalSeam);

  const bottomSeam = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.055, 0.012),
    seamMaterial,
  );
  bottomSeam.name = "foldedBottomSeam";
  bottomSeam.position.set(0, -height * 0.5 + 0.016, frontZ);
  root.add(bottomSeam);

  const mouthMaterial = new THREE.MeshStandardMaterial({
    color: edgeColor,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mouthFlex = new THREE.Group();
  mouthFlex.name = "sleeveMouthFlex";
  mouthFlex.position.x = width * 0.5;
  root.add(mouthFlex);

  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(thickness * 0.72, height - 0.055),
    mouthMaterial,
  );
  mouth.name = "openPocketMouth";
  mouth.rotation.y = Math.PI / 2;
  mouth.position.x = 0.002;
  mouthFlex.add(mouth);

  const innerLip = new THREE.Mesh(
    new THREE.PlaneGeometry(thickness * 0.42, height - 0.095),
    new THREE.MeshStandardMaterial({
      color: innerColor,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  innerLip.name = "innerPaperLip";
  innerLip.rotation.y = Math.PI / 2;
  innerLip.position.set(0.0035, 0, -thickness * 0.04);
  mouthFlex.add(innerLip);

  const notchRadius = height * 0.064;
  const notch = new THREE.Mesh(
    new THREE.CircleGeometry(notchRadius, 32, Math.PI / 2, Math.PI),
    new THREE.MeshStandardMaterial({
      color: innerColor,
      roughness: 1,
      metalness: 0,
    }),
  );
  notch.name = "thumbNotch";
  notch.position.set(-0.004, 0, frontZ + 0.001);
  mouthFlex.add(notch);

  const notchRim = new THREE.Mesh(
    new THREE.RingGeometry(
      notchRadius - 0.009,
      notchRadius,
      32,
      1,
      Math.PI / 2,
      Math.PI,
    ),
    new THREE.MeshBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  notchRim.name = "thumbNotchRim";
  notchRim.position.set(-0.004, 0, frontZ + 0.0015);
  mouthFlex.add(notchRim);

  const rearSeamMaterial = seamMaterial.clone();
  rearSeamMaterial.opacity = 0.42;
  const rearBottomSeam = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.78, 0.01),
    rearSeamMaterial,
  );
  rearBottomSeam.name = "rearGlueFlap";
  rearBottomSeam.position.set(
    0,
    -height * 0.5 + 0.022,
    -thickness * 0.5 - 0.004,
  );
  rearBottomSeam.rotation.y = Math.PI;
  root.add(rearBottomSeam);

  return {
    root,
    mouthFlex,
    body,
    frontSurface,
    backSurface,
    spineSurface,
  };
}
