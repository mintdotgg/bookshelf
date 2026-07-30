import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type {
  CatalogRecord,
  RecordSide,
  RecordTrack,
  VinylDiscNumber,
} from "./record-catalog";
import {
  browsePhaseDuration,
  browseRecordMotionPose,
  createRecordMotionLayout,
  cueMotionPose,
  focusedRecordPose,
  reinsertProgressForExtraction,
  presentedRecordPose,
  recordShelfGap,
  recordFootprintsOverlap,
  shelvedRecordPose,
  type BrowseMotionPhase,
  type CueMotionLayout,
  type CueMotionPhase,
  type CueMotionPose,
  type RecordFootprint,
  type RecordMotionLayout,
  type RecordPose,
} from "./record-motion";
import {
  createBackCover,
  createFrontCover,
  createLabelArt,
  createSpineCover,
} from "./record-art";
import {
  createSleeveModel,
  sleeveOpeningContract,
} from "./sleeve-model";
import {
  createLogBandLayout,
  smoothBandLevels,
  writeBandLevels,
  type AudioBandLayout,
} from "./audio/audio-visualizer";
import {
  createVinylBodyGeometry,
  createTurntableModel,
  platterRecordCenterY,
  vinylSpec,
} from "./turntable-model";
import {
  defaultTurntableVariantId,
  getTurntableVariant,
  type TurntableVariantId,
} from "./turntable-variants";
import {
  disposeMintGltfRuntime,
  loadMintGltf,
} from "./assets/gltf-runtime";
import { siteConfig } from "./site-config";

export type SceneMode = "browse" | "focusing" | "inspect" | "returning";
export type VisualPlaybackMode =
  | "idle"
  | "loading"
  | "cueing"
  | "playing"
  | "paused"
  | "seeking"
  | "stopping"
  | "error";

type EngineCallbacks = {
  onActiveIndex: (index: number) => void;
  onMode: (mode: SceneMode, selectedIndex: number | null) => void;
  onStatus: (message: string) => void;
  onReady: () => void;
  onNeedleContact: () => void;
  onVinylReturned: () => void;
  onVinylAnchor: (anchor: VinylScreenAnchor | null) => void;
};

export type VinylScreenAnchor = {
  x: number;
  y: number;
  visible: boolean;
};

type RuntimeRecord = {
  data: CatalogRecord;
  index: number;
  slot: THREE.Group;
  content: THREE.Group;
  inspectionIdle: THREE.Group;
  sleeve: THREE.Group;
  sleeveMouth: THREE.Group;
  frontSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  backSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  vinyl: THREE.Group;
  vinylDisc: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>;
  vinylLabel: THREE.Mesh<THREE.RingGeometry, THREE.MeshStandardMaterial>;
  vinylGlow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  pickProxy: THREE.Mesh;
  x: number;
  width: number;
  height: number;
  thickness: number;
  pose: RecordPose;
  hover: number;
  targetHover: number;
  idleAmount: number;
  activeSide: RecordSide;
  activeDiscNumber: VinylDiscNumber;
  textures: THREE.Texture[];
};

export type VinylLibraryDiagnostics = ReturnType<
  RecordShelfEngine["getDiagnostics"]
>;

const clamp = THREE.MathUtils.clamp;
const shelfTop = 0.26;
const browseCamera = new THREE.Vector3(0, 1.55, 8.2);
const browseTarget = new THREE.Vector3(0, 1.32, 0.1);
const focusInDuration = 0.5;
const focusOutDuration = 0.38;
const sleeveOpenDuration = 0.72;
const sleeveCloseDuration = 0.62;
const desktopFocusX = -1.08;
const desktopFocusZ = 1.5;
const desktopFocusScale = 0.84;
const mobileFocusZ = 1.18;
const mobileFocusScale = 0.76;
const idleVinylReveal = 0.88;
const cueDurations: Record<Exclude<CueMotionPhase, "playing">, number> = {
  "extract-vinyl": 0.58,
  "transport-to-turntable": 0.88,
  "lower-tonearm": 0.82,
  "raise-tonearm": 0.56,
  "return-to-sleeve": 0.78,
  "reinsert-vinyl": 0.5,
};

function damp(current: number, target: number, lambda: number, delta: number) {
  return THREE.MathUtils.damp(current, target, lambda, delta);
}

function easeOutCubic(value: number) {
  const t = 1 - clamp(value, 0, 1);
  return 1 - t * t * t;
}

function smooth(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function toTexture(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  anisotropy = 8,
) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(
    anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function disposeMaterial(material: THREE.Material) {
  const textured = material as THREE.Material & Record<string, unknown>;
  [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "alphaMap",
    "emissiveMap",
  ].forEach((key) => {
    const value = textured[key];
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material && disposeMaterial(material));
  });
}

export class RecordShelfEngine {
  private canvas: HTMLCanvasElement;
  private recordsData: CatalogRecord[];
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private shelfGroup = new THREE.Group();
  private shelfFurniture = new THREE.Group();
  private turntable = new THREE.Group();
  private turntableBase = new THREE.Group();
  private turntableShell = new THREE.Group();
  private importedTurntableShell: THREE.Object3D | null = null;
  private turntableVariantId: TurntableVariantId =
    defaultTurntableVariantId;
  private turntableVariantRequestId = 0;
  private platter = new THREE.Group();
  private platterMat!: THREE.MeshPhysicalMaterial;
  private tonearmPivot = new THREE.Group();
  private tonearmLift = new THREE.Group();
  private stylus!: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private visualizerRings: THREE.Mesh<
    THREE.RingGeometry,
    THREE.MeshBasicMaterial
  >[] = [];
  private runtimeRecords: RuntimeRecord[] = [];
  private pickTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private animationFrame = 0;
  private resizeObserver: ResizeObserver;
  private mode: SceneMode = "browse";
  private playbackMode: VisualPlaybackMode = "idle";
  private selectedIndex: number | null = null;
  private activeIndex = 0;
  private presentedIndex: number | null = 0;
  private pendingFocusIndex: number | null = null;
  private browseMotionPhase: BrowseMotionPhase | "idle" = "idle";
  private browseMotionProgress = 0;
  private motionRecordIndex: number | null = null;
  private motionLayout: RecordMotionLayout = createRecordMotionLayout([]);
  private collisionRejects = 0;
  private lastCollisionPair: [string, string] | null = null;
  private scrollIndex = 0;
  private targetScrollIndex = 0;
  private focusProgress = 0;
  private sleeveRevealProgress = 0;
  private lastInputTime = 0;
  private pointerDown = false;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerLastX = 0;
  private pointerTravel = 0;
  private reducedMotion = false;
  private focusCameraPosition = new THREE.Vector3();
  private focusCameraTarget = new THREE.Vector3();
  private responsiveBrowseCamera = browseCamera.clone();
  private responsiveBrowseTarget = browseTarget.clone();
  private lastTimestamp = 0;
  private lastDiagnosticsAt = 0;
  private isDisposed = false;
  private cuePhase: CueMotionPhase | null = null;
  private cueProgress = 0;
  private grooveProgress = 0;
  private platterSpeed = 0;
  private platterAngle = 0;
  private cueContactFired = false;
  private vinylReturnFired = false;
  private returnAfterVinyl = false;
  private analyserReader: ((target: Uint8Array) => boolean) | null = null;
  private analyserData = new Uint8Array(512);
  private audioBandLayout: AudioBandLayout = createLogBandLayout({
    frequencyBinCount: 512,
    sampleRate: 48_000,
    bandCount: 8,
  });
  private rawAudioBands = new Float32Array(8);
  private smoothedAudioBands = new Float32Array(8);
  private audioLow = 0;
  private audioMid = 0;
  private audioHigh = 0;
  private audioLevel = 0;

  constructor(
    canvas: HTMLCanvasElement,
    records: CatalogRecord[],
    callbacks: EngineCallbacks,
  ) {
    this.canvas = canvas;
    this.recordsData = records;
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.08, 70);
    this.camera.position.copy(browseCamera);
    this.camera.lookAt(browseTarget);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 8;
    this.controls.minPolarAngle = Math.PI * 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.76;

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.setupScene();
    this.createRecords();
    this.createTurntable();
    this.bindEvents();
    this.resizeObserver.observe(canvas);
    this.handleResize();
    this.callbacks.onReady();
    this.animate();
  }

  private setupScene() {
    this.scene.background = new THREE.Color(siteConfig.theme.paper);
    this.scene.fog = new THREE.Fog(siteConfig.theme.paper, 11, 25);

    const hemisphere = new THREE.HemisphereLight("#fff7e5", "#51443b", 2.2);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight("#fff1d8", 4.5);
    key.position.set(-4.5, 7.2, 5.5);
    key.castShadow = true;
    const shadowSize = window.innerWidth < 700 ? 1024 : 2048;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight("#b9c9d8", 2.05);
    rim.position.set(5.5, 3.5, -3.5);
    this.scene.add(rim);

    const amber = new THREE.PointLight("#d69a5d", 1.25, 9, 2);
    amber.position.set(2.5, 2.1, 3.4);
    this.scene.add(amber);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 18),
      new THREE.MeshStandardMaterial({
        color: siteConfig.theme.paper,
        roughness: 1,
      }),
    );
    wall.position.set(0, 5, -3.1);
    wall.receiveShadow = true;
    this.scene.add(wall);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 20),
      new THREE.MeshStandardMaterial({
        color: siteConfig.theme.paperDeep,
        roughness: 0.93,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.24;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(this.shelfGroup);
    this.shelfGroup.add(this.shelfFurniture);
  }

  private createRecords() {
    let cursor = 0;

    this.recordsData.forEach((record, index) => {
      const thickness = record.sleeveThickness ?? 0.042;
      cursor += thickness * 0.5;
      const runtime = this.createRecord(record, index, cursor);
      this.runtimeRecords.push(runtime);
      this.shelfGroup.add(runtime.slot);
      this.scene.add(runtime.vinyl);
      cursor += thickness * 0.5 + recordShelfGap;

      if (record.coverImage) {
        void this.loadSurfaceTexture(
          runtime,
          runtime.frontSurface,
          record.coverImage,
          "cover",
        );
      }
      if (record.backCoverImage) {
        void this.loadSurfaceTexture(
          runtime,
          runtime.backSurface,
          record.backCoverImage,
          "back",
        );
      }
      if (record.labelImage) {
        void this.loadLabelTexture(runtime, record.labelImage);
      }
    });

    this.motionLayout = createRecordMotionLayout(
      this.runtimeRecords.map((record) => ({
        width: record.width,
        thickness: record.thickness,
      })),
    );

    this.runtimeRecords.forEach((record, index) => {
      this.commitRecordPose(
        record,
        index === 0
          ? presentedRecordPose(this.motionLayout)
          : shelvedRecordPose(this.motionLayout),
        false,
      );
    });

    const shelfWidth = Math.max(6.2, cursor + 3.2);
    const shelfMaterial = new THREE.MeshPhysicalMaterial({
      color: "#553a2d",
      roughness: 0.6,
      metalness: 0.02,
      clearcoat: 0.12,
      clearcoatRoughness: 0.56,
    });
    const shelf = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.2, 1.68, 5, 0.04),
      shelfMaterial,
    );
    shelf.name = "archiveShelf";
    shelf.position.set(cursor * 0.5, shelfTop - 0.13, 0);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    this.shelfFurniture.add(shelf);

    const brassEdge = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.055, 0.085, 3, 0.018),
      new THREE.MeshPhysicalMaterial({
        color: "#9b7848",
        roughness: 0.34,
        metalness: 0.74,
      }),
    );
    brassEdge.position.set(cursor * 0.5, shelfTop - 0.025, 0.82);
    brassEdge.castShadow = true;
    this.shelfFurniture.add(brassEdge);

    const backRail = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.45, 0.12, 3, 0.025),
      shelfMaterial,
    );
    backRail.position.set(cursor * 0.5, shelfTop + 0.1, -0.76);
    backRail.castShadow = true;
    this.shelfFurniture.add(backRail);

    const topShelf = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.16, 1.68, 5, 0.04),
      shelfMaterial,
    );
    topShelf.name = "archiveShelfTop";
    topShelf.position.set(cursor * 0.5, shelfTop + 2.48, 0);
    topShelf.castShadow = true;
    topShelf.receiveShadow = true;
    this.shelfFurniture.add(topShelf);

    const sideGeometry = new RoundedBoxGeometry(0.18, 2.5, 1.68, 5, 0.04);
    const shelfCenter = cursor * 0.5;
    const sideOffset = shelfWidth * 0.5 - 0.09;
    [-1, 1].forEach((direction) => {
      const side = new THREE.Mesh(sideGeometry, shelfMaterial);
      side.name = direction < 0 ? "archiveShelfLeft" : "archiveShelfRight";
      side.position.set(
        shelfCenter + direction * sideOffset,
        shelfTop + 1.17,
        0,
      );
      side.castShadow = true;
      side.receiveShadow = true;
      this.shelfFurniture.add(side);
    });
  }

  private createRecord(
    record: CatalogRecord,
    index: number,
    x: number,
  ): RuntimeRecord {
    const size = record.sleeveSize ?? 2.16;
    const thickness = record.sleeveThickness ?? 0.042;
    const width = size;
    const slot = new THREE.Group();
    slot.name = `recordSlot:${record.id}`;
    slot.position.set(x, shelfTop + size * 0.5, 0.04);

    const content = new THREE.Group();
    content.name = `recordPresentation:${record.id}`;
    slot.add(content);
    const pose = shelvedRecordPose(this.motionLayout);
    content.position.set(pose.x, 0, pose.z);
    content.rotation.y = pose.yaw;
    content.scale.setScalar(pose.scale);

    const inspectionIdle = new THREE.Group();
    inspectionIdle.name = `recordInspectionIdle:${record.id}`;
    content.add(inspectionIdle);

    const frontTexture = toTexture(createFrontCover(record), this.renderer);
    const backTexture = toTexture(createBackCover(record), this.renderer);
    const spineTexture = toTexture(
      createSpineCover(record),
      this.renderer,
      4,
    );
    const initialTrack = record.tracks[0];
    const initialSide = initialTrack?.side ?? "A";
    const initialDiscNumber = initialTrack?.discNumber ?? 1;
    const labelTexture = toTexture(
      createLabelArt(record, initialSide),
      this.renderer,
    );
    const textures = [frontTexture, backTexture, spineTexture, labelTexture];

    const sleeveModel = createSleeveModel({
      width,
      height: size,
      thickness,
      color: record.sleeveColor,
      accent: record.accent,
      frontTexture,
      backTexture,
      spineTexture,
    });
    const sleeve = sleeveModel.root;
    sleeve.name = `recordSleeve:${record.id}`;
    inspectionIdle.add(sleeve);
    const {
      frontSurface,
      backSurface,
      mouthFlex: sleeveMouth,
    } = sleeveModel;

    const pickProxy = new THREE.Mesh(
      new THREE.BoxGeometry(width, size, thickness + 0.08),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    pickProxy.name = `pick:${record.id}`;
    pickProxy.userData.recordIndex = index;
    inspectionIdle.add(pickProxy);
    this.pickTargets.push(pickProxy);

    const vinyl = new THREE.Group();
    vinyl.name = `vinyl:${record.id}`;
    vinyl.visible = false;

    const vinylDisc = new THREE.Mesh(
      createVinylBodyGeometry(size * vinylSpec.discRadiusFactor),
      new THREE.MeshPhysicalMaterial({
        color: record.vinylColor,
        roughness: 0.28,
        metalness: 0.18,
        clearcoat: 0.82,
        clearcoatRoughness: 0.18,
        transparent: (record.vinylOpacity ?? 1) < 1,
        opacity: record.vinylOpacity ?? 1,
      }),
    );
    vinylDisc.name = "pressing";
    vinylDisc.castShadow = true;
    vinylDisc.receiveShadow = true;
    vinyl.add(vinylDisc);

    const vinylLabel = new THREE.Mesh(
      new THREE.RingGeometry(
        vinylSpec.centerHoleRadius + 0.002,
        size * 0.115,
        72,
      ),
      new THREE.MeshStandardMaterial({
        map: labelTexture,
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    vinylLabel.name = "recordLabel";
    vinylLabel.rotation.x = -Math.PI / 2;
    vinylLabel.position.y = vinylSpec.discThickness * 0.5 + 0.001;
    vinyl.add(vinylLabel);

    for (let groove = 0; groove < 11; groove += 1) {
      const radius = size * (0.16 + groove * 0.0195);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.0034, 96),
        new THREE.MeshBasicMaterial({
          color: groove % 3 === 0 ? record.accent : "#efeadf",
          transparent: true,
          opacity: groove % 3 === 0 ? 0.15 : 0.07,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.014;
      vinyl.add(ring);
    }

    if (record.vinylMarbling) {
      for (let streak = 0; streak < 7; streak += 1) {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(
            size * (0.22 + streak * 0.018),
            0.004 + (streak % 2) * 0.002,
            5,
            64,
            Math.PI * (0.65 + (streak % 3) * 0.18),
          ),
          new THREE.MeshBasicMaterial({
            color: streak % 2 === 0 ? record.accent : record.ink,
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
          }),
        );
        arc.rotation.x = Math.PI / 2;
        arc.rotation.z = streak * 0.81;
        arc.position.y = 0.016;
        vinyl.add(arc);
      }
    }

    const centerBoreEdge = new THREE.Mesh(
      new THREE.TorusGeometry(
        vinylSpec.centerHoleRadius,
        0.0014,
        6,
        48,
      ),
      new THREE.MeshStandardMaterial({
        color: "#0c0d0b",
        roughness: 0.82,
        metalness: 0.04,
      }),
    );
    centerBoreEdge.name = "centerBoreEdge";
    centerBoreEdge.rotation.x = Math.PI / 2;
    centerBoreEdge.position.y = vinylSpec.discThickness * 0.5;
    vinyl.add(centerBoreEdge);

    const vinylGlow = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.4, size * 0.43, 96),
      new THREE.MeshBasicMaterial({
        color: record.accent,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    vinylGlow.rotation.x = -Math.PI / 2;
    vinylGlow.position.y = -0.008;
    vinyl.add(vinylGlow);

    return {
      data: record,
      index,
      slot,
      content,
      inspectionIdle,
      sleeve,
      sleeveMouth,
      frontSurface,
      backSurface,
      vinyl,
      vinylDisc,
      vinylLabel,
      vinylGlow,
      pickProxy,
      x,
      width,
      height: size,
      thickness,
      pose,
      hover: 0,
      targetHover: 0,
      idleAmount: 0,
      activeSide: initialSide,
      activeDiscNumber: initialDiscNumber,
      textures,
    };
  }

  private createTurntable() {
    const model = createTurntableModel();
    this.turntable = model.root;
    this.turntableBase = model.reveal;
    this.turntableShell = model.shell;
    this.platter = model.platter;
    this.platterMat = model.platterMaterial;
    this.tonearmPivot = model.tonearmPivot;
    this.tonearmLift = model.tonearmLift;
    this.stylus = model.stylus;
    this.visualizerRings = model.visualizerRings;
    this.turntable.position.set(1.98, -0.03, 0.08);
    this.turntable.scale.setScalar(0.62);
    this.scene.add(this.turntable);
  }

  async setTurntableVariant(id: TurntableVariantId) {
    const variant = getTurntableVariant(id);
    const requestId = ++this.turntableVariantRequestId;

    if (!variant.available) {
      throw new Error(`${variant.label} is waiting for its synchronized asset.`);
    }

    if (variant.source === "builtin") {
      if (this.importedTurntableShell) {
        this.turntableBase.remove(this.importedTurntableShell);
        disposeObject(this.importedTurntableShell);
        this.importedTurntableShell = null;
      }
      this.turntableShell.visible = true;
      this.turntableVariantId = variant.id;
      return variant.id;
    }

    if (!variant.modelUrl || !variant.transform) {
      throw new Error(`${variant.label} is missing its runtime asset contract.`);
    }

    const gltf = await loadMintGltf(variant.modelUrl);
    const nextShell = gltf.scene;
    if (this.isDisposed || requestId !== this.turntableVariantRequestId) {
      disposeObject(nextShell);
      return this.turntableVariantId;
    }

    nextShell.name = `turntableVariant:${variant.id}`;
    nextShell.position.fromArray([...variant.transform.position]);
    nextShell.rotation.fromArray([
      ...variant.transform.rotation,
      nextShell.rotation.order,
    ]);
    nextShell.scale.fromArray([...variant.transform.scale]);
    nextShell.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });

    if (this.importedTurntableShell) {
      this.turntableBase.remove(this.importedTurntableShell);
      disposeObject(this.importedTurntableShell);
    }
    this.importedTurntableShell = nextShell;
    this.turntableBase.add(nextShell);
    this.turntableShell.visible = false;
    this.turntableVariantId = variant.id;
    return variant.id;
  }

  private bindEvents() {
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    // Keep browse keys available after someone has clicked one of the HTML
    // controls around the canvas. The handler itself ignores form fields and
    // modal dialogs, so their native keyboard behavior is preserved.
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleWheel = (event: WheelEvent) => {
    if (this.mode !== "browse") return;
    event.preventDefault();
    this.pendingFocusIndex = null;
    const dominant =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    this.targetScrollIndex = clamp(
      this.targetScrollIndex + dominant * 0.0027,
      0,
      this.runtimeRecords.length - 1,
    );
    this.lastInputTime = performance.now();
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (this.mode !== "browse") return;
    this.canvas.focus({ preventScroll: true });
    this.pointerDown = true;
    this.pointerId = event.pointerId;
    this.pointerStartX = event.clientX;
    this.pointerLastX = event.clientX;
    this.pointerTravel = 0;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    this.updatePointer(event);
    if (this.mode !== "browse") return;

    if (this.pointerDown && event.pointerId === this.pointerId) {
      this.pendingFocusIndex = null;
      const delta = event.clientX - this.pointerLastX;
      this.pointerLastX = event.clientX;
      this.pointerTravel += Math.abs(delta);
      this.targetScrollIndex = clamp(
        this.targetScrollIndex -
          delta / Math.max(105, this.canvas.clientWidth * 0.12),
        0,
        this.runtimeRecords.length - 1,
      );
      this.lastInputTime = performance.now();
      this.canvas.classList.add("is-dragging");
      return;
    }
    this.updateHover();
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    const wasClick =
      this.pointerTravel < 7 &&
      Math.abs(event.clientX - this.pointerStartX) < 7;
    this.clearPointerInteraction(event.pointerId);
    if (this.mode === "browse" && wasClick) {
      this.updatePointer(event);
      const hit = this.raycastRecord();
      if (hit !== null) this.focusRecord(hit);
    }
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.clearPointerInteraction(event.pointerId);
  };

  private handlePointerLeave = () => {
    if (!this.pointerDown) {
      this.runtimeRecords.forEach((record) => {
        record.targetHover = 0;
      });
      this.canvas.style.cursor = "grab";
    }
  };

  private handleWindowBlur = () => {
    this.clearPointerInteraction();
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") this.clearPointerInteraction();
  };

  private clearPointerInteraction(pointerId = this.pointerId) {
    this.pointerDown = false;
    this.pointerId = null;
    this.canvas.classList.remove("is-dragging");
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }

  private isEditableKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [role='dialog']",
      ),
    );
  }

  private isNativeActivationTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button, a, [role='button'], [role='radio']"));
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || this.isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (event.key === "Escape") {
      this.requestReturnToShelf();
      return;
    }
    if ((event.key === "r" || event.key === "R") && this.mode === "inspect") {
      this.resetFocusView();
      return;
    }
    if (this.mode !== "browse") return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.browseBy(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.browseBy(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.browseTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      this.browseTo(this.runtimeRecords.length - 1);
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      !this.isNativeActivationTarget(event.target)
    ) {
      event.preventDefault();
      this.focusRecord(this.activeIndex);
    }
  };

  private updatePointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastRecord() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    return typeof hit?.object.userData.recordIndex === "number"
      ? (hit.object.userData.recordIndex as number)
      : null;
  }

  private updateHover() {
    const hit = this.raycastRecord();
    this.runtimeRecords.forEach((record) => {
      record.targetHover = record.index === hit ? 1 : 0;
    });
    this.canvas.style.cursor = hit === null ? "grab" : "pointer";
  }

  private xAtIndex(index: number) {
    const lower = Math.floor(index);
    const upper = Math.min(this.runtimeRecords.length - 1, Math.ceil(index));
    const fraction = index - lower;
    return THREE.MathUtils.lerp(
      this.runtimeRecords[lower]?.x ?? 0,
      this.runtimeRecords[upper]?.x ?? 0,
      fraction,
    );
  }

  private footprintFor(
    record: RuntimeRecord,
    pose: RecordPose = record.pose,
  ): RecordFootprint {
    return {
      id: record.data.id,
      x: record.x + pose.x,
      z: record.slot.position.z + pose.z,
      yaw: pose.yaw,
      scale: pose.scale,
      width: record.width,
      thickness: record.thickness,
    };
  }

  private collisionFor(record: RuntimeRecord, pose: RecordPose) {
    const proposed = this.footprintFor(record, pose);
    return (
      this.runtimeRecords.find(
        (other) =>
          other !== record &&
          recordFootprintsOverlap(
            proposed,
            this.footprintFor(other),
            this.motionLayout.collisionMargin,
          ),
      ) ?? null
    );
  }

  private commitRecordPose(
    record: RuntimeRecord,
    pose: RecordPose,
    guardCollision = true,
  ) {
    if (guardCollision) {
      const collidedWith = this.collisionFor(record, pose);
      if (collidedWith) {
        this.collisionRejects += 1;
        this.lastCollisionPair = [record.data.id, collidedWith.data.id];
        return false;
      }
    }
    record.pose = { ...pose };
    record.content.position.x = pose.x;
    record.content.position.z = pose.z;
    record.content.rotation.y = pose.yaw;
    record.content.scale.setScalar(pose.scale);
    return true;
  }

  private beginFocus(index: number) {
    if (
      this.mode !== "browse" ||
      this.browseMotionPhase !== "idle" ||
      this.presentedIndex !== index
    ) {
      return;
    }
    this.pendingFocusIndex = null;
    this.selectedIndex = index;
    this.focusProgress = 0;
    this.sleeveRevealProgress = 0;
    this.mode = "focusing";
    this.runtimeRecords.forEach((record) => {
      record.targetHover = 0;
    });
    this.callbacks.onMode(this.mode, index);
    this.callbacks.onStatus(
      `Opening ${this.runtimeRecords[index].data.shortTitle}`,
    );
  }

  private updateBrowseMotion(delta: number) {
    if (this.browseMotionPhase === "idle") {
      if (this.presentedIndex === this.activeIndex) {
        if (this.pendingFocusIndex === this.activeIndex) {
          this.beginFocus(this.activeIndex);
        }
        return;
      }
      this.motionRecordIndex = this.presentedIndex;
      this.browseMotionPhase =
        this.motionRecordIndex === null ? "extract-next" : "retreat-current";
      if (this.motionRecordIndex === null) {
        this.motionRecordIndex = this.activeIndex;
      }
      this.browseMotionProgress = 0;
    }

    const phase = this.browseMotionPhase;
    const motionIndex = this.motionRecordIndex;
    if (motionIndex === null) return;
    const duration = this.reducedMotion
      ? Math.max(0.055, browsePhaseDuration[phase] * 0.45)
      : browsePhaseDuration[phase];
    const nextProgress = clamp(
      this.browseMotionProgress + delta / duration,
      0,
      1,
    );
    const movingRecord = this.runtimeRecords[motionIndex];
    const proposedPose = browseRecordMotionPose(
      phase,
      nextProgress,
      this.motionLayout,
    );
    if (!this.commitRecordPose(movingRecord, proposedPose)) return;

    this.browseMotionProgress = nextProgress;
    if (nextProgress < 1) return;
    this.browseMotionProgress = 0;
    switch (phase) {
      case "retreat-current":
        this.browseMotionPhase = "turn-current";
        break;
      case "turn-current":
        this.browseMotionPhase = "shelve-current";
        break;
      case "shelve-current":
        this.presentedIndex = null;
        this.motionRecordIndex = this.activeIndex;
        this.browseMotionPhase = "extract-next";
        break;
      case "extract-next":
        this.browseMotionPhase = "turn-next";
        break;
      case "turn-next":
        this.browseMotionPhase = "settle-next";
        break;
      case "settle-next":
        this.presentedIndex = motionIndex;
        this.motionRecordIndex = null;
        this.browseMotionPhase = "idle";
        if (this.pendingFocusIndex === this.presentedIndex) {
          this.beginFocus(this.presentedIndex);
        }
        break;
    }
  }

  private animate = () => {
    if (this.isDisposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const timestamp = performance.now();
    const delta = clamp(
      (timestamp - this.lastTimestamp) / 1000 || 1 / 60,
      0,
      0.05,
    );
    this.lastTimestamp = timestamp;

    this.updateState(delta, timestamp);
    this.updateRecords(delta);
    this.updateCue(delta);
    this.updateAudioVisuals(delta);
    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateVinylAnchor();
    this.updateDiagnostics(timestamp);
  };

  private updateState(delta: number, timestamp: number) {
    if (this.mode === "browse") {
      if (!this.pointerDown && timestamp - this.lastInputTime > 150) {
        this.targetScrollIndex = damp(
          this.targetScrollIndex,
          Math.round(this.targetScrollIndex),
          this.reducedMotion ? 18 : 8.5,
          delta,
        );
      }
      this.scrollIndex = damp(
        this.scrollIndex,
        this.targetScrollIndex,
        this.reducedMotion ? 20 : 10,
        delta,
      );
      this.focusProgress = damp(this.focusProgress, 0, 10, delta);
      this.camera.position.lerp(
        this.responsiveBrowseCamera,
        1 - Math.exp(-(this.reducedMotion ? 18 : 7) * delta),
      );
      this.camera.lookAt(this.responsiveBrowseTarget);
    } else if (this.mode === "focusing") {
      this.focusProgress = clamp(
        this.focusProgress +
          delta / (this.reducedMotion ? 0.08 : focusInDuration),
        0,
        1,
      );
      this.updateFocusCamera(delta);
      if (this.focusProgress >= 1) {
        this.sleeveRevealProgress = clamp(
          this.sleeveRevealProgress +
            delta / (this.reducedMotion ? 0.1 : sleeveOpenDuration),
          0,
          1,
        );
      }
      if (this.focusProgress >= 1 && this.sleeveRevealProgress >= 1) {
        this.mode = "inspect";
        this.controls.enabled = true;
        this.controls.target.copy(this.focusCameraTarget);
        this.callbacks.onMode(this.mode, this.selectedIndex);
        if (this.selectedIndex !== null) {
          this.callbacks.onStatus(
            `${this.runtimeRecords[this.selectedIndex].data.shortTitle} sleeve open`,
          );
        }
      }
    } else if (this.mode === "returning") {
      this.controls.enabled = false;
      const previousSleeveReveal = this.sleeveRevealProgress;
      if (previousSleeveReveal > 0) {
        this.sleeveRevealProgress = clamp(
          previousSleeveReveal -
            delta / (this.reducedMotion ? 0.1 : sleeveCloseDuration),
          0,
          1,
        );
        this.applyFocusViewOffset(1);
        this.camera.position.lerp(
          this.focusCameraPosition,
          1 - Math.exp(-(this.reducedMotion ? 24 : 14) * delta),
        );
        this.camera.lookAt(this.focusCameraTarget);
        if (
          previousSleeveReveal > 0 &&
          this.sleeveRevealProgress <= 0
        ) {
          this.callbacks.onStatus("Returning the closed sleeve to the shelf");
        }
      } else {
        this.focusProgress = clamp(
          this.focusProgress -
            delta / (this.reducedMotion ? 0.08 : focusOutDuration),
          0,
          1,
        );
        this.applyFocusViewOffset(easeOutCubic(this.focusProgress));
        this.camera.position.lerp(
          this.responsiveBrowseCamera,
          1 - Math.exp(-(this.reducedMotion ? 24 : 14) * delta),
        );
        this.camera.lookAt(this.responsiveBrowseTarget);
      }
      if (this.focusProgress <= 0) {
        if (this.selectedIndex !== null) {
          this.commitRecordPose(
            this.runtimeRecords[this.selectedIndex],
            presentedRecordPose(this.motionLayout),
          );
          this.presentedIndex = this.selectedIndex;
        }
        this.selectedIndex = null;
        this.mode = "browse";
        this.turntable.visible = false;
        this.callbacks.onMode(this.mode, null);
        const pressingCount = this.recordsData.reduce(
          (total, record) => total + record.discCount,
          0,
        );
        this.callbacks.onStatus(
          `${pressingCount} pressings across ${this.recordsData.length} releases ready`,
        );
        this.canvas.focus({ preventScroll: true });
      }
    }

    const nextActive = clamp(
      Math.round(this.scrollIndex),
      0,
      this.runtimeRecords.length - 1,
    );
    if (nextActive !== this.activeIndex) {
      this.activeIndex = nextActive;
      this.callbacks.onActiveIndex(this.activeIndex);
    }
    this.shelfGroup.position.x = -this.xAtIndex(this.scrollIndex);
    if (this.mode === "browse") this.updateBrowseMotion(delta);
  }

  private updateRecords(delta: number) {
    const motionFocus =
      this.mode === "returning"
        ? this.focusProgress
        : easeOutCubic(this.focusProgress);
    const isolated = this.selectedIndex !== null && motionFocus > 0.72;
    this.shelfFurniture.visible = !isolated;
    this.turntable.visible = this.selectedIndex !== null && motionFocus > 0.46;

    if (this.turntable.visible) {
      const reveal = smooth((motionFocus - 0.46) / 0.54);
      this.turntableBase.position.y = (1 - reveal) * -0.24;
      this.turntableBase.scale.setScalar(0.92 + reveal * 0.08);
      this.turntableBase.rotation.y = (1 - reveal) * -0.08;
    }

    const focusX = this.isMobile() ? 0 : desktopFocusX;
    const focusZ = this.isMobile() ? mobileFocusZ : desktopFocusZ;
    const focusScale = this.isMobile()
      ? mobileFocusScale
      : desktopFocusScale;

    if (this.selectedIndex !== null) {
      this.commitRecordPose(
        this.runtimeRecords[this.selectedIndex],
        focusedRecordPose(
          motionFocus,
          this.motionLayout,
          focusX,
          focusZ,
          focusScale,
        ),
      );
    }

    this.runtimeRecords.forEach((record) => {
      record.hover = damp(record.hover, record.targetHover, 12, delta);
      const isSelected = record.index === this.selectedIndex;
      record.content.visible = !isolated || isSelected;
      record.content.position.y = isSelected ? motionFocus * 0.04 : 0;
      const idleTarget = 0;
      record.idleAmount = damp(record.idleAmount, idleTarget, 5, delta);
      record.inspectionIdle.position.y = 0;
      record.inspectionIdle.rotation.set(0, 0, 0);
      const mouthOpen = isSelected ? smooth(this.sleeveRevealProgress) : 0;
      record.sleeveMouth.scale.z = 1 + mouthOpen * 0.72;
      record.sleeveMouth.rotation.y = -mouthOpen * 0.014;
      record.sleeveMouth.position.z = mouthOpen * 0.0035;

      if (!isSelected) record.vinyl.visible = false;
      const hoverScale = 1 + record.hover * 0.008;
      if (!isSelected) record.content.scale.setScalar(record.pose.scale * hoverScale);
    });
  }

  private cueLayout(): CueMotionLayout | null {
    if (this.selectedIndex === null) return null;
    const selected = this.runtimeRecords[this.selectedIndex];
    const sleeveWorld = new THREE.Vector3();
    selected.inspectionIdle.getWorldPosition(sleeveWorld);
    const platterWorld = new THREE.Vector3();
    this.platter.getWorldPosition(platterWorld);
    const turntableScale = this.turntable.getWorldScale(
      new THREE.Vector3(),
    ).x;
    const selectedScale = selected.content.getWorldScale(
      new THREE.Vector3(),
    ).x;
    const pocketZ =
      sleeveWorld.z + sleeveOpeningContract.pocketDepthBias * selectedScale;
    const sleeveMouthX =
      sleeveWorld.x +
      sleeveOpeningContract.directionX *
        selected.width *
        selectedScale *
        0.5;
    const vinylRadius =
      selected.width * vinylSpec.discRadiusFactor * selectedScale;
    const sleeveClearX =
      sleeveMouthX +
      sleeveOpeningContract.directionX *
        (vinylRadius +
          sleeveOpeningContract.trailingEdgeClearance * selectedScale);
    return {
      sleevedVinyl: {
        x: sleeveWorld.x + 0.12,
        y: sleeveWorld.y,
        z: pocketZ,
        pitch: Math.PI / 2,
        yaw: 0,
        roll: 0,
        scale: selectedScale,
      },
      sleeveMouthVinyl: {
        x: sleeveMouthX,
        y: sleeveWorld.y,
        z: pocketZ,
        pitch: Math.PI / 2,
        yaw: 0,
        roll: 0,
        scale: selectedScale,
      },
      sleeveClearVinyl: {
        x: sleeveClearX,
        y: sleeveWorld.y,
        z: pocketZ,
        pitch: Math.PI / 2,
        yaw: 0,
        roll: 0,
        scale: selectedScale,
      },
      extractedVinyl: {
        x: sleeveClearX + 0.08 * selectedScale,
        y: sleeveWorld.y + 0.04,
        z: sleeveWorld.z + 0.22,
        pitch: Math.PI / 2,
        yaw: -0.08,
        roll: -0.05,
        scale: selectedScale * 0.93,
      },
      turntableApproachVinyl: {
        x: platterWorld.x,
        y: platterWorld.y + 1.18,
        z: platterWorld.z + 0.08,
        pitch: 0.18,
        yaw: 0.08,
        roll: 0,
        scale: turntableScale,
      },
      platterVinyl: {
        x: platterWorld.x,
        y: platterWorld.y + platterRecordCenterY() * turntableScale,
        z: platterWorld.z,
        pitch: 0,
        yaw: 0,
        roll: 0,
        scale: turntableScale,
      },
      tonearmRestYaw: -0.34,
      tonearmLeadInYaw: 0.13,
      tonearmRunoutYaw: 0.49,
      tonearmRaisedLift: 0.12,
      tonearmContactLift: 0,
    };
  }

  private updateCue(delta: number) {
    const layout = this.cueLayout();
    if (!layout || this.selectedIndex === null) return;
    const selected = this.runtimeRecords[this.selectedIndex];

    if (this.cuePhase === null) {
      selected.vinyl.visible =
        this.mode !== "browse" && this.sleeveRevealProgress > 0;
      if (selected.vinyl.visible) {
        const peek = cueMotionPose(
          "extract-vinyl",
          idleVinylReveal * this.sleeveRevealProgress,
          layout,
          0,
        );
        this.applyCuePose(selected, peek, delta);
      }
      return;
    }

    selected.vinyl.visible = true;
    let pose: CueMotionPose;
    if (this.cuePhase === "playing") {
      pose = cueMotionPose("playing", this.grooveProgress, layout);
      if (this.playbackMode === "paused") {
        pose = {
          ...pose,
          tonearm: { ...pose.tonearm, lift: 0.038 },
          platterSpeed: 0.16,
          stylusContact: 0,
        };
      } else if (this.playbackMode === "seeking") {
        pose = {
          ...pose,
          tonearm: { ...pose.tonearm, lift: 0.065 },
          stylusContact: 0,
        };
      }
      this.applyCuePose(selected, pose, delta);
      return;
    }

    const duration = this.reducedMotion
      ? 0.09
      : cueDurations[this.cuePhase as Exclude<CueMotionPhase, "playing">];
    this.cueProgress = clamp(this.cueProgress + delta / duration, 0, 1);
    const reinsertTarget = this.returnAfterVinyl ? 0 : idleVinylReveal;
    pose = cueMotionPose(
      this.cuePhase,
      this.cueProgress,
      layout,
      this.grooveProgress,
      reinsertTarget,
    );
    if (this.cuePhase === "reinsert-vinyl") {
      this.sleeveRevealProgress = this.returnAfterVinyl
        ? 1 - smooth(this.cueProgress)
        : 1;
    }
    this.applyCuePose(selected, pose, delta);
    if (this.cueProgress < 1) return;

    this.cueProgress = 0;
    switch (this.cuePhase) {
      case "extract-vinyl":
        this.cuePhase = "transport-to-turntable";
        this.callbacks.onStatus("Moving the pressing to the platter");
        break;
      case "transport-to-turntable":
        this.cuePhase = "lower-tonearm";
        this.callbacks.onStatus("Cueing the selected track");
        break;
      case "lower-tonearm":
        this.cuePhase = "playing";
        this.cueContactFired = true;
        this.callbacks.onNeedleContact();
        break;
      case "raise-tonearm":
        this.cuePhase = "return-to-sleeve";
        this.callbacks.onStatus("Returning the pressing to its sleeve");
        break;
      case "return-to-sleeve":
        this.cuePhase = "reinsert-vinyl";
        break;
      case "reinsert-vinyl":
        this.cuePhase = null;
        selected.vinyl.visible = !this.returnAfterVinyl;
        this.sleeveRevealProgress = this.returnAfterVinyl ? 0 : 1;
        this.playbackMode = "idle";
        this.cueContactFired = false;
        if (!this.vinylReturnFired) {
          this.vinylReturnFired = true;
          this.callbacks.onVinylReturned();
        }
        if (this.returnAfterVinyl) {
          this.returnAfterVinyl = false;
          this.beginReturnToShelf();
        }
        break;
    }
  }

  private applyCuePose(
    selected: RuntimeRecord,
    pose: CueMotionPose,
    delta: number,
  ) {
    selected.vinyl.position.set(pose.vinyl.x, pose.vinyl.y, pose.vinyl.z);
    selected.vinyl.rotation.set(
      pose.vinyl.pitch,
      pose.vinyl.yaw + this.platterAngle,
      pose.vinyl.roll,
    );
    selected.vinyl.scale.setScalar(pose.vinyl.scale);
    this.tonearmPivot.rotation.y = pose.tonearm.yaw;
    this.tonearmLift.position.y = pose.tonearm.lift;
    this.platterSpeed = damp(this.platterSpeed, pose.platterSpeed, 6, delta);
    const rpm = selected.data.rpm;
    this.platterAngle += delta * this.platterSpeed * ((rpm / 60) * Math.PI * 2);
    this.platter.rotation.y = this.platterAngle;
    this.stylus.material.emissiveIntensity =
      0.2 + pose.stylusContact * (0.35 + this.audioHigh * 1.2);
  }

  private updateAudioVisuals(delta: number) {
    let available = false;
    if (this.analyserReader) {
      available = this.analyserReader(this.analyserData);
    }
    if (available) {
      writeBandLevels(
        this.analyserData,
        this.audioBandLayout,
        this.rawAudioBands,
      );
    } else {
      this.rawAudioBands.fill(0);
    }
    smoothBandLevels(
      this.rawAudioBands,
      this.smoothedAudioBands,
      delta,
    );
    const average = (start: number, end: number) => {
      let total = 0;
      for (let index = start; index < end; index += 1) {
        total += this.smoothedAudioBands[index] ?? 0;
      }
      return total / Math.max(1, end - start);
    };
    const targetLow = average(0, 3);
    const targetMid = average(3, 6);
    const targetHigh = average(6, 8);
    this.audioLow = damp(this.audioLow, targetLow, 10, delta);
    this.audioMid = damp(this.audioMid, targetMid, 10, delta);
    this.audioHigh = damp(this.audioHigh, targetHigh, 10, delta);
    this.audioLevel = (this.audioLow * 1.3 + this.audioMid + this.audioHigh) / 3.3;

    this.visualizerRings.forEach((ring, index) => {
      const energy =
        index === 0 ? this.audioLow : index === 1 ? this.audioMid : this.audioHigh;
      ring.material.opacity =
        this.playbackMode === "playing" ? 0.06 + energy * 0.34 : 0;
      ring.scale.setScalar(1 + energy * (0.035 + index * 0.018));
    });
    this.platterMat.emissiveIntensity =
      this.playbackMode === "playing" ? 0.025 + this.audioLow * 0.16 : 0.01;

    if (this.selectedIndex !== null) {
      const selected = this.runtimeRecords[this.selectedIndex];
      selected.vinylGlow.material.opacity =
        this.playbackMode === "playing" ? 0.035 + this.audioMid * 0.26 : 0;
      selected.vinylGlow.scale.setScalar(1 + this.audioLow * 0.04);
    }
  }

  private updateFocusCamera(delta: number) {
    if (this.selectedIndex === null) return;
    const selected = this.runtimeRecords[this.selectedIndex];
    const worldPosition = new THREE.Vector3();
    selected.content.getWorldPosition(worldPosition);
    this.frameFocusedRecord(worldPosition, easeOutCubic(this.focusProgress));
    this.camera.position.lerp(
      this.focusCameraPosition,
      1 - Math.exp(-(this.reducedMotion ? 28 : 13) * delta),
    );
    this.camera.lookAt(this.focusCameraTarget);
  }

  private frameFocusedRecord(
    worldPosition: THREE.Vector3,
    compositionProgress = 1,
  ) {
    const isMobile = this.isMobile();
    const focusDistance = isMobile ? 6.7 : 9;
    this.applyFocusViewOffset(compositionProgress);
    this.focusCameraTarget.set(
      worldPosition.x + (isMobile ? 0 : 1.68),
      worldPosition.y - (isMobile ? 0.08 : 0.22),
      worldPosition.z,
    );
    this.focusCameraPosition.set(
      this.focusCameraTarget.x,
      this.focusCameraTarget.y,
      this.focusCameraTarget.z + focusDistance,
    );
  }

  private updateVinylAnchor() {
    if (
      this.selectedIndex === null ||
      this.mode !== "inspect"
    ) {
      this.callbacks.onVinylAnchor?.(null);
      return;
    }
    const selected = this.runtimeRecords[this.selectedIndex];
    if (!selected.vinyl.visible) {
      this.callbacks.onVinylAnchor?.(null);
      return;
    }
    const projected = new THREE.Vector3();
    selected.vinylLabel.getWorldPosition(projected);
    projected.project(this.camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      projected.x > -1.08 &&
      projected.x < 1.08 &&
      projected.y > -1.08 &&
      projected.y < 1.08;
    this.callbacks.onVinylAnchor?.({
      x: (projected.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible,
    });
  }

  private applyFocusViewOffset(progress: number) {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (this.isMobile() || progress <= 0.001) {
      this.camera.clearViewOffset();
      return;
    }
    const panelWidth = Math.min(410, width * 0.31);
    this.camera.setViewOffset(
      width,
      height,
      panelWidth * 0.22 * clamp(progress, 0, 1),
      0,
      width,
      height,
    );
  }

  private handleResize = () => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dprCap = width < 760 ? 1.5 : 1.75;
    this.responsiveBrowseCamera.set(
      width < 760 ? 0.55 : browseCamera.x,
      width < 760 ? 1.53 : browseCamera.y,
      width < 760 ? 13.2 : browseCamera.z,
    );
    this.responsiveBrowseTarget.set(
      width < 760 ? 0.55 : browseTarget.x,
      browseTarget.y,
      browseTarget.z,
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 34 : width < 920 ? 31 : 28;
    this.camera.updateProjectionMatrix();
    this.turntable.position.set(
      width < 760 ? 0.42 : width < 980 ? 1.68 : 1.98,
      width < 760 ? 2.42 : -0.03,
      width < 760 ? 0.18 : 0.08,
    );
    this.turntable.scale.setScalar(
      width < 760 ? 0.36 : width < 980 ? 0.55 : 0.62,
    );
    if (this.mode === "browse" && this.focusProgress < 0.01) {
      this.camera.clearViewOffset();
      this.camera.position.copy(this.responsiveBrowseCamera);
      this.camera.lookAt(this.responsiveBrowseTarget);
    } else if (this.mode === "inspect" && this.selectedIndex !== null) {
      const worldPosition = new THREE.Vector3();
      this.runtimeRecords[this.selectedIndex].content.getWorldPosition(
        worldPosition,
      );
      this.frameFocusedRecord(worldPosition);
    }
  };

  private isMobile() {
    return this.canvas.clientWidth < 760;
  }

  private async loadSurfaceTexture(
    runtime: RuntimeRecord,
    surface: RuntimeRecord["frontSurface"] | RuntimeRecord["backSurface"],
    url: string,
    kind: string,
  ) {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      if (this.isDisposed) {
        texture.dispose();
        return;
      }
      texture.name = `${kind}:${runtime.data.id}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      const previous = surface.material.map;
      surface.material.map = texture;
      surface.material.needsUpdate = true;
      runtime.textures.push(texture);
      previous?.dispose();
    } catch {
      this.callbacks.onStatus(
        `Using generated artwork for ${runtime.data.shortTitle}`,
      );
    }
  }

  private async loadLabelTexture(runtime: RuntimeRecord, url: string) {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      if (this.isDisposed) {
        texture.dispose();
        return;
      }
      texture.name = `label:${runtime.data.id}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      const previous = runtime.vinylLabel.material.map;
      runtime.vinylLabel.material.map = texture;
      runtime.vinylLabel.material.needsUpdate = true;
      runtime.textures.push(texture);
      previous?.dispose();
    } catch {
      this.callbacks.onStatus(
        `Using generated label art for ${runtime.data.shortTitle}`,
      );
    }
  }

  private updateDiagnostics(timestamp: number) {
    if (timestamp - this.lastDiagnosticsAt <= 500) return;
    const diagnostics = this.getDiagnostics();
    this.canvas.dataset.drawCalls = String(diagnostics.drawCalls);
    this.canvas.dataset.triangles = String(diagnostics.triangles);
    this.canvas.dataset.geometries = String(diagnostics.geometries);
    this.canvas.dataset.textures = String(diagnostics.textures);
    this.canvas.dataset.pixelRatio = String(diagnostics.pixelRatio);
    this.canvas.dataset.motionPhase = diagnostics.motionPhase;
    this.canvas.dataset.cuePhase = diagnostics.cuePhase ?? "idle";
    this.canvas.dataset.sceneMode = diagnostics.sceneMode;
    this.canvas.dataset.playbackMode = diagnostics.playbackMode;
    this.canvas.dataset.turntableVariant = diagnostics.turntableVariantId;
    this.canvas.dataset.collisionFree = String(
      diagnostics.currentCollision === null,
    );
    this.lastDiagnosticsAt = timestamp;
  }

  private findAnyCollision(): [string, string] | null {
    for (let leftIndex = 0; leftIndex < this.runtimeRecords.length; leftIndex += 1) {
      const left = this.runtimeRecords[leftIndex];
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < this.runtimeRecords.length;
        rightIndex += 1
      ) {
        const right = this.runtimeRecords[rightIndex];
        if (
          recordFootprintsOverlap(
            this.footprintFor(left),
            this.footprintFor(right),
            this.motionLayout.collisionMargin,
          )
        ) {
          return [left.data.id, right.data.id];
        }
      }
    }
    return null;
  }

  browseBy(direction: number) {
    if (this.mode !== "browse") return;
    this.browseTo(Math.round(this.targetScrollIndex) + direction);
  }

  browseTo(index: number) {
    if (this.mode !== "browse") return;
    const next = clamp(Math.round(index), 0, this.runtimeRecords.length - 1);
    this.pendingFocusIndex = null;
    this.targetScrollIndex = next;
    this.lastInputTime = performance.now() - 1000;
  }

  focusRecord(index = this.activeIndex) {
    if (this.mode !== "browse") return;
    const next = clamp(Math.round(index), 0, this.runtimeRecords.length - 1);
    this.targetScrollIndex = next;
    this.scrollIndex = next;
    this.activeIndex = next;
    this.pendingFocusIndex = next;
    this.callbacks.onActiveIndex(next);
    this.callbacks.onStatus(
      `Preparing ${this.runtimeRecords[next].data.shortTitle}`,
    );
    if (
      this.browseMotionPhase === "idle" &&
      this.presentedIndex === next
    ) {
      this.beginFocus(next);
    }
  }

  startCue(grooveProgress = 0) {
    if (
      this.mode !== "inspect" ||
      this.selectedIndex === null ||
      (this.cuePhase !== null && this.cuePhase !== "playing")
    ) {
      return false;
    }
    if (this.cuePhase === "playing") return true;
    this.controls.enabled = false;
    this.cuePhase = "extract-vinyl";
    this.cueProgress = idleVinylReveal;
    this.sleeveRevealProgress = 1;
    this.grooveProgress = clamp(grooveProgress, 0, 1);
    this.cueContactFired = false;
    this.vinylReturnFired = false;
    this.playbackMode = "cueing";
    this.callbacks.onStatus("Removing the pressing from its sleeve");
    return true;
  }

  stopAndReturnVinyl(returnToShelf = false) {
    this.returnAfterVinyl ||= returnToShelf;
    if (this.cuePhase === null) {
      if (returnToShelf) this.beginReturnToShelf();
      else if (!this.vinylReturnFired) {
        this.vinylReturnFired = true;
        this.callbacks.onVinylReturned();
      }
      return;
    }
    this.controls.enabled = false;
    this.playbackMode = "stopping";
    this.cueContactFired = false;
    if (this.cuePhase === "playing" || this.cuePhase === "lower-tonearm") {
      this.cueProgress =
        this.cuePhase === "lower-tonearm" ? 1 - this.cueProgress : 0;
      this.cuePhase = "raise-tonearm";
    } else if (this.cuePhase === "transport-to-turntable") {
      this.cueProgress = 1 - this.cueProgress;
      this.cuePhase = "return-to-sleeve";
    } else if (this.cuePhase === "extract-vinyl") {
      this.cueProgress = reinsertProgressForExtraction(
        this.cueProgress,
        this.returnAfterVinyl ? 0 : idleVinylReveal,
      );
      this.cuePhase = "reinsert-vinyl";
    }
  }

  setPlaybackMode(mode: VisualPlaybackMode) {
    this.playbackMode = mode;
    if (mode === "playing") {
      this.controls.enabled = this.mode === "inspect";
    }
  }

  selectTrack(track: RecordTrack) {
    if (this.selectedIndex === null) return false;
    const runtime = this.runtimeRecords[this.selectedIndex];
    const selectedTrack = runtime.data.tracks.find(
      (candidate) => candidate.id === track.id,
    );
    if (!selectedTrack) return false;

    const nextSide = selectedTrack.side ?? "A";
    const nextDiscNumber = selectedTrack.discNumber ?? 1;
    const presentationChanged =
      runtime.activeSide !== nextSide ||
      runtime.activeDiscNumber !== nextDiscNumber;
    runtime.activeSide = nextSide;
    runtime.activeDiscNumber = nextDiscNumber;

    if (!presentationChanged || runtime.data.labelImage) return true;

    const texture = toTexture(
      createLabelArt(runtime.data, nextSide),
      this.renderer,
    );
    texture.name = `label:${runtime.data.id}:disc-${nextDiscNumber}:side-${nextSide}`;
    const previous = runtime.vinylLabel.material.map;
    runtime.vinylLabel.material.map = texture;
    runtime.vinylLabel.material.needsUpdate = true;
    const previousIndex = previous
      ? runtime.textures.indexOf(previous)
      : -1;
    if (previousIndex >= 0) runtime.textures.splice(previousIndex, 1, texture);
    else runtime.textures.push(texture);
    previous?.dispose();
    return true;
  }

  setPlaybackProgress(progress: number) {
    this.grooveProgress = clamp(progress, 0, 1);
  }

  setAnalyserReader(
    reader: ((target: Uint8Array) => boolean) | null,
    sampleRate = 48_000,
    frequencyBinCount = 512,
  ) {
    this.analyserReader = reader;
    if (frequencyBinCount !== this.analyserData.length) {
      this.analyserData = new Uint8Array(frequencyBinCount);
    }
    this.audioBandLayout = createLogBandLayout({
      frequencyBinCount,
      sampleRate,
      bandCount: this.rawAudioBands.length,
    });
  }

  requestReturnToShelf() {
    if (this.mode === "browse" && this.pendingFocusIndex !== null) {
      this.pendingFocusIndex = null;
      this.callbacks.onStatus("Opening cancelled");
      return;
    }
    if (this.mode === "browse" || this.mode === "returning") return;
    if (this.cuePhase !== null) {
      this.stopAndReturnVinyl(true);
      return;
    }
    this.beginReturnToShelf();
  }

  private beginReturnToShelf() {
    if (this.mode === "browse" || this.mode === "returning") return;
    this.controls.enabled = false;
    this.mode = "returning";
    this.callbacks.onMode(this.mode, this.selectedIndex);
    this.callbacks.onStatus(
      this.sleeveRevealProgress > 0
        ? "Sliding the pressing into its sleeve"
        : "Returning the album to the shelf",
    );
  }

  resetFocusView() {
    if (this.mode !== "inspect" || this.selectedIndex === null) return;
    const selected = this.runtimeRecords[this.selectedIndex];
    const worldPosition = new THREE.Vector3();
    selected.content.getWorldPosition(worldPosition);
    this.frameFocusedRecord(worldPosition);
    this.controls.target.copy(this.focusCameraTarget);
    this.camera.position.copy(this.focusCameraPosition);
    this.controls.update();
  }

  getDiagnostics() {
    const info = this.renderer.info;
    return {
      sceneMode: this.mode,
      playbackMode: this.playbackMode,
      activeIndex: this.activeIndex,
      selectedIndex: this.selectedIndex,
      activeDiscNumber:
        this.selectedIndex === null
          ? null
          : this.runtimeRecords[this.selectedIndex].activeDiscNumber,
      activeSide:
        this.selectedIndex === null
          ? null
          : this.runtimeRecords[this.selectedIndex].activeSide,
      records: this.runtimeRecords.length,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      motionPhase: this.browseMotionPhase,
      cuePhase: this.cuePhase,
      cueProgress: this.cueProgress,
      sleeveRevealProgress: this.sleeveRevealProgress,
      collisionRejects: this.collisionRejects,
      lastCollisionPair: this.lastCollisionPair,
      currentCollision: this.findAnyCollision(),
      audio: {
        low: this.audioLow,
        mid: this.audioMid,
        high: this.audioHigh,
        level: this.audioLevel,
      },
      canvas: {
        width: this.canvas.width,
        height: this.canvas.height,
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
      },
      turntableVariantId: this.turntableVariantId,
    };
  }

  dispose() {
    this.isDisposed = true;
    this.turntableVariantRequestId += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );

    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material && disposeMaterial(material));
    });
    this.runtimeRecords.forEach((record) => {
      record.textures.forEach((texture) => texture.dispose());
    });
    disposeMintGltfRuntime();
    this.renderer.dispose();
  }
}
