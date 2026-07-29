import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type TurntableModel = {
  root: THREE.Group;
  reveal: THREE.Group;
  platter: THREE.Group;
  platterMaterial: THREE.MeshPhysicalMaterial;
  tonearmPivot: THREE.Group;
  tonearmLift: THREE.Group;
  stylus: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  visualizerRings: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >[];
};

function physical(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshPhysicalMaterialParameters> = {},
) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.45,
    metalness: 0.08,
    ...options,
  });
}

function rounded(
  name: string,
  size: [number, number, number],
  radius: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(size[0], size[1], size[2], 7, radius),
    material,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radiusTop,
      radiusBottom,
      height,
      segments,
    ),
    material,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Authored, articulated hi-fi deck built as separate functional groups.
 * The wrapper is the presentation transform; the part-local transforms remain
 * stable so a future imported asset can replace the visual meshes without
 * changing cue choreography.
 */
export function createTurntableModel(): TurntableModel {
  const root = new THREE.Group();
  root.name = "turntableStage";
  root.visible = false;

  const reveal = new THREE.Group();
  reveal.name = "turntablePresentation";
  root.add(reveal);

  const walnut = physical("#5a3827", {
    roughness: 0.48,
    metalness: 0.015,
    clearcoat: 0.28,
    clearcoatRoughness: 0.38,
    sheen: 0.16,
    sheenColor: new THREE.Color("#c88a56"),
  });
  const walnutEdge = physical("#35231b", {
    roughness: 0.56,
    metalness: 0.02,
    clearcoat: 0.16,
    clearcoatRoughness: 0.48,
  });
  const deck = physical("#242722", {
    roughness: 0.3,
    metalness: 0.54,
    clearcoat: 0.38,
    clearcoatRoughness: 0.2,
  });
  const rubber = physical("#10120f", {
    roughness: 0.82,
    metalness: 0.02,
    clearcoat: 0.04,
  });
  const brushedMetal = physical("#bcb29f", {
    roughness: 0.23,
    metalness: 0.93,
    clearcoat: 0.24,
    clearcoatRoughness: 0.18,
  });
  const darkMetal = physical("#4b4e48", {
    roughness: 0.27,
    metalness: 0.86,
    clearcoat: 0.2,
  });
  const cream = physical("#ddd1bc", {
    roughness: 0.52,
    metalness: 0.03,
  });
  const accent = physical("#a13f2f", {
    roughness: 0.35,
    metalness: 0.3,
    emissive: new THREE.Color("#a13f2f"),
    emissiveIntensity: 0.12,
  });

  const lowerBand = rounded(
    "walnutLowerBand",
    [3.56, 0.3, 2.62],
    0.12,
    walnutEdge,
  );
  lowerBand.position.y = -0.03;
  reveal.add(lowerBand);

  const plinth = rounded(
    "walnutPlinth",
    [3.44, 0.42, 2.5],
    0.115,
    walnut,
  );
  plinth.position.y = 0.12;
  reveal.add(plinth);

  const topPlate = rounded(
    "brushedTopPlate",
    [3.26, 0.12, 2.3],
    0.065,
    deck,
  );
  topPlate.position.y = 0.39;
  reveal.add(topPlate);

  const insetBorder = rounded(
    "topPlateInset",
    [3.05, 0.035, 2.09],
    0.04,
    walnutEdge,
  );
  insetBorder.position.y = 0.47;
  reveal.add(insetBorder);

  const footGeometry = new THREE.CylinderGeometry(0.17, 0.2, 0.2, 32);
  [
    [-1.42, -0.25, -0.93],
    [1.42, -0.25, -0.93],
    [-1.42, -0.25, 0.93],
    [1.42, -0.25, 0.93],
  ].forEach(([x, y, z], index) => {
    const foot = new THREE.Mesh(footGeometry, rubber);
    foot.name = `isolationFoot:${index}`;
    foot.position.set(x, y, z);
    foot.castShadow = true;
    reveal.add(foot);

    const footRing = cylinder(
      `isolationFootRing:${index}`,
      0.19,
      0.19,
      0.035,
      32,
      brushedMetal,
    );
    footRing.position.set(x, y + 0.1, z);
    reveal.add(footRing);
  });

  const platter = new THREE.Group();
  platter.name = "platterAssembly";
  platter.position.set(-0.55, 0.56, -0.02);
  reveal.add(platter);

  const platterWell = cylinder(
    "platterWell",
    1.11,
    1.11,
    0.06,
    112,
    darkMetal,
  );
  platterWell.position.y = -0.035;
  platter.add(platterWell);

  const rim = cylinder(
    "aluminiumPlatterRim",
    1.075,
    1.075,
    0.17,
    128,
    brushedMetal,
  );
  platter.add(rim);

  const platterMaterial = physical("#171916", {
    roughness: 0.32,
    metalness: 0.44,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    emissive: new THREE.Color("#a13f2f"),
    emissiveIntensity: 0.01,
  });
  const mat = cylinder(
    "rubberPlatterMat",
    1.015,
    1.015,
    0.08,
    128,
    platterMaterial,
  );
  mat.position.y = 0.1;
  platter.add(mat);

  for (let groove = 0; groove < 9; groove += 1) {
    const radius = 0.34 + groove * 0.074;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.0032, 5, 112),
      groove % 3 === 0 ? darkMetal : rubber,
    );
    ring.name = `matGroove:${groove}`;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.145;
    platter.add(ring);
  }

  const strobeGeometry = new THREE.BoxGeometry(0.032, 0.025, 0.012);
  const strobeDots = new THREE.InstancedMesh(
    strobeGeometry,
    cream,
    48,
  );
  strobeDots.name = "platterStrobeDots";
  const strobeMatrix = new THREE.Matrix4();
  const strobeQuaternion = new THREE.Quaternion();
  const strobeScale = new THREE.Vector3(1, 1, 1);
  const strobePosition = new THREE.Vector3();
  for (let index = 0; index < 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    strobePosition.set(
      Math.cos(angle) * 1.082,
      0.085,
      Math.sin(angle) * 1.082,
    );
    strobeQuaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -angle,
    );
    strobeMatrix.compose(strobePosition, strobeQuaternion, strobeScale);
    strobeDots.setMatrixAt(index, strobeMatrix);
  }
  strobeDots.instanceMatrix.needsUpdate = true;
  platter.add(strobeDots);

  const spindle = cylinder(
    "spindle",
    0.035,
    0.035,
    0.3,
    32,
    brushedMetal,
  );
  spindle.position.y = 0.23;
  platter.add(spindle);

  const spindleCollar = cylinder(
    "spindleCollar",
    0.095,
    0.095,
    0.026,
    48,
    darkMetal,
  );
  spindleCollar.position.y = 0.17;
  platter.add(spindleCollar);

  const pitchRail = rounded(
    "pitchRail",
    [0.105, 0.03, 0.72],
    0.016,
    rubber,
  );
  pitchRail.position.set(-1.43, 0.5, 0.06);
  reveal.add(pitchRail);

  const pitchFader = rounded(
    "pitchFader",
    [0.26, 0.075, 0.15],
    0.022,
    brushedMetal,
  );
  pitchFader.position.set(-1.43, 0.55, -0.08);
  reveal.add(pitchFader);

  const powerKnob = cylinder(
    "powerKnob",
    0.115,
    0.125,
    0.105,
    40,
    brushedMetal,
  );
  powerKnob.position.set(-1.43, 0.54, 0.84);
  reveal.add(powerKnob);

  const powerCap = cylinder(
    "powerKnobCap",
    0.055,
    0.055,
    0.112,
    32,
    darkMetal,
  );
  powerCap.position.set(-1.43, 0.56, 0.84);
  reveal.add(powerCap);

  [-0.02, 0.28].forEach((z, index) => {
    const speedButton = cylinder(
      `speedButton:${index}`,
      0.075,
      0.075,
      0.06,
      32,
      index === 0 ? accent : brushedMetal,
    );
    speedButton.position.set(1.38, 0.53, z);
    reveal.add(speedButton);
  });

  const cueLeverBase = cylinder(
    "cueLeverBase",
    0.07,
    0.08,
    0.065,
    30,
    darkMetal,
  );
  cueLeverBase.position.set(1.31, 0.53, 0.73);
  reveal.add(cueLeverBase);

  const cueLever = cylinder(
    "cueLever",
    0.018,
    0.018,
    0.28,
    16,
    brushedMetal,
  );
  cueLever.rotation.z = -0.46;
  cueLever.position.set(1.22, 0.65, 0.73);
  reveal.add(cueLever);

  const cueHandle = cylinder(
    "cueLeverHandle",
    0.04,
    0.04,
    0.09,
    20,
    rubber,
  );
  cueHandle.rotation.z = -0.46;
  cueHandle.position.set(1.16, 0.73, 0.73);
  reveal.add(cueHandle);

  const armBase = cylinder(
    "tonearmBase",
    0.28,
    0.33,
    0.26,
    64,
    darkMetal,
  );
  armBase.position.set(1.05, 0.58, -0.62);
  reveal.add(armBase);

  const armBaseRing = cylinder(
    "tonearmBaseRing",
    0.34,
    0.34,
    0.055,
    64,
    brushedMetal,
  );
  armBaseRing.position.set(1.05, 0.51, -0.62);
  reveal.add(armBaseRing);

  const gimbalOuter = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.027, 14, 56),
    brushedMetal,
  );
  gimbalOuter.name = "tonearmGimbalOuter";
  gimbalOuter.rotation.x = Math.PI / 2;
  gimbalOuter.position.set(1.05, 0.75, -0.62);
  reveal.add(gimbalOuter);

  const tonearmPivot = new THREE.Group();
  tonearmPivot.name = "tonearmPivot";
  tonearmPivot.position.set(1.05, 0.76, -0.62);
  reveal.add(tonearmPivot);

  const tonearmLift = new THREE.Group();
  tonearmLift.name = "tonearmLift";
  tonearmPivot.add(tonearmLift);

  const counterweight = cylinder(
    "counterweight",
    0.15,
    0.17,
    0.34,
    48,
    darkMetal,
  );
  counterweight.rotation.z = Math.PI / 2;
  counterweight.position.set(0.2, 0.02, -0.04);
  tonearmLift.add(counterweight);

  const counterweightBand = cylinder(
    "counterweightBand",
    0.175,
    0.175,
    0.045,
    48,
    brushedMetal,
  );
  counterweightBand.rotation.z = Math.PI / 2;
  counterweightBand.position.set(0.21, 0.02, -0.04);
  tonearmLift.add(counterweightBand);

  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.03, 0.04, 0),
    new THREE.Vector3(-0.48, 0.09, 0.035),
    new THREE.Vector3(-1.03, 0.06, 0.13),
    new THREE.Vector3(-1.46, 0, 0.18),
  ]);
  const armTube = new THREE.Mesh(
    new THREE.TubeGeometry(armCurve, 48, 0.026, 12, false),
    brushedMetal,
  );
  armTube.name = "curvedTonearmTube";
  armTube.castShadow = true;
  tonearmLift.add(armTube);

  const headshell = rounded(
    "headshell",
    [0.34, 0.075, 0.2],
    0.025,
    darkMetal,
  );
  headshell.position.set(-1.57, -0.01, 0.2);
  headshell.rotation.y = -0.08;
  tonearmLift.add(headshell);

  const headshellSlots = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.11, 0.012, 0.025),
    cream,
    2,
  );
  headshellSlots.name = "headshellSlots";
  const slotMatrix = new THREE.Matrix4();
  [-0.035, 0.035].forEach((z, index) => {
    slotMatrix.makeTranslation(-1.58, 0.032, 0.2 + z);
    headshellSlots.setMatrixAt(index, slotMatrix);
  });
  headshellSlots.instanceMatrix.needsUpdate = true;
  tonearmLift.add(headshellSlots);

  const cartridge = rounded(
    "cartridge",
    [0.16, 0.08, 0.12],
    0.018,
    accent,
  );
  cartridge.position.set(-1.67, -0.07, 0.2);
  tonearmLift.add(cartridge);

  const stylus = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, 0.13, 0.022),
    new THREE.MeshStandardMaterial({
      color: "#e5d8c2",
      roughness: 0.34,
      metalness: 0.34,
      emissive: "#a13f2f",
      emissiveIntensity: 0.22,
    }),
  );
  stylus.name = "stylus";
  stylus.position.set(-1.7, -0.15, 0.2);
  stylus.castShadow = true;
  tonearmLift.add(stylus);

  const visualizerRings: TurntableModel["visualizerRings"] = [];
  for (let index = 0; index < 3; index += 1) {
    const visualizer = new THREE.Mesh(
      new THREE.RingGeometry(
        1.14 + index * 0.12,
        1.16 + index * 0.12,
        112,
      ),
      new THREE.MeshBasicMaterial({
        color: index === 1 ? "#b18a52" : "#a13f2f",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    visualizer.name = `audioRing:${index}`;
    visualizer.rotation.x = -Math.PI / 2;
    visualizer.position.set(-0.55, 0.74 + index * 0.009, -0.02);
    reveal.add(visualizer);
    visualizerRings.push(visualizer);
  }

  const badgePlate = rounded(
    "makerBadge",
    [0.72, 0.025, 0.18],
    0.012,
    cream,
  );
  badgePlate.position.set(0.89, 0.51, 0.91);
  reveal.add(badgePlate);

  const badgeLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.018),
    new THREE.MeshBasicMaterial({
      color: "#4d463d",
      transparent: true,
      opacity: 0.76,
    }),
  );
  badgeLine.name = "makerBadgeLine";
  badgeLine.rotation.x = -Math.PI / 2;
  badgeLine.position.set(0.89, 0.526, 0.91);
  reveal.add(badgeLine);

  return {
    root,
    reveal,
    platter,
    platterMaterial,
    tonearmPivot,
    tonearmLift,
    stylus,
    visualizerRings,
  };
}
