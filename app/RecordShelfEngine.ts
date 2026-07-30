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
  cueCameraTurntableMix,
  cueMotionPose,
  focusedRecordPose,
  reinsertProgressForExtraction,
  presentedRecordPose,
  recordShelfGap,
  recordFootprintsOverlap,
  shelvedRecordPose,
  sleeveFaceYaw,
  sleeveFlipDuration,
  sleeveFlipMotionPose,
  trackTransitionMotionPose,
  vinylPresentationForCue,
  type BrowseMotionPhase,
  type CueMotionLayout,
  type CueMotionPhase,
  type CueMotionPose,
  type RecordFootprint,
  type RecordMotionLayout,
  type RecordPose,
  type SleeveFace,
  type TrackTransitionMotionPhase,
  type VinylPresentation,
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
  getSleeveSpineDimensions,
  resolveSleeveDimensions,
} from "./sleeve-spec";
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
import {
  classifyTrackTransition,
  trackGrooveProgress,
  type TrackTransitionKind,
} from "./track-transition";
import { artworkRetryUrl } from "./artwork-url";

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
  onSleeveState: (state: SleevePresentationState) => void;
  onStatus: (message: string) => void;
  onReady: () => void;
  onNeedleContact: () => void;
  onVinylReturned: () => void;
  onVinylAnchor: (anchor: VinylScreenAnchor | null) => void;
  onVinylPresentation: (presentation: VinylPresentation) => void;
};

export type VinylScreenAnchor = {
  x: number;
  y: number;
  visible: boolean;
};

export type SleevePresentationState = {
  recordIndex: number | null;
  face: SleeveFace;
  flipping: boolean;
  canFlip: boolean;
};

type ArtworkLoadState = "generated" | "loading" | "loaded" | "failed";

type RuntimeRecord = {
  data: CatalogRecord;
  index: number;
  slot: THREE.Group;
  content: THREE.Group;
  inspectionIdle: THREE.Group;
  sleeveFlipPivot: THREE.Group;
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
  sleeveFace: SleeveFace;
  sleeveFlipTarget: SleeveFace;
  sleeveFlipProgress: number;
  sleeveFlipFromYaw: number;
  sleeveFlipToYaw: number;
  sleeveFlipYaw: number;
  sleeveFlipping: boolean;
  sleeveFlipReason: SleeveFlipReason;
  activeSide: RecordSide;
  activeDiscNumber: VinylDiscNumber;
  activeTrackId: string | null;
  surfaceTextureState: {
    cover: ArtworkLoadState;
    back: ArtworkLoadState;
  };
  textures: THREE.Texture[];
};

type ActiveTrackTransition = {
  kind: TrackTransitionKind;
  phase: TrackTransitionMotionPhase;
  progress: number;
  fromGrooveProgress: number;
  toGrooveProgress: number;
  targetTrack: RecordTrack;
  trackReady: boolean;
  presentationCommitted: boolean;
};

type SleeveFlipReason =
  | "manual"
  | "browse-reset"
  | "cue"
  | "return";

export type VinylLibraryDiagnostics = ReturnType<
  RecordShelfEngine["getDiagnostics"]
>;

const clamp = THREE.MathUtils.clamp;
const shelfTop = 0.26;
const shelfMinimumWidth = 9.8;
const shelfEndOverhang = 6.4;
const browseCamera = new THREE.Vector3(-0.38, 1.48, 9.4);
const browseTarget = new THREE.Vector3(-0.38, 1.26, 0.1);
const focusInDuration = 0.46;
const focusOutDuration = 0.34;
const sleeveOpenDuration = 0.58;
const sleeveCloseDuration = 0.54;
const playingCameraReturnDuration = 0.62;
const cameraResetDuration = 0.42;
const desktopFocusX = -1.08;
const desktopFocusZ = 1.5;
const desktopFocusScale = 0.84;
const mobileFocusZ = 1.18;
const mobileFocusScale = 0.76;
const idleVinylReveal = 0.88;
const cueDurations: Record<Exclude<CueMotionPhase, "playing">, number> = {
  "extract-vinyl": 0.52,
  "transport-to-turntable": 0.76,
  "lower-tonearm": 0.68,
  "raise-tonearm": 0.5,
  "return-to-sleeve": 0.68,
  "reinsert-vinyl": 0.44,
};
const trackTransitionDurations: Record<
  Exclude<TrackTransitionMotionPhase, "waiting">,
  number
> = {
  "lift-tonearm": 0.42,
  "change-vinyl": 0.84,
  "lower-tonearm": 0.48,
};

function damp(current: number, target: number, lambda: number, delta: number) {
  return THREE.MathUtils.damp(current, target, lambda, delta);
}

function easeOutCubic(value: number) {
  const t = 1 - clamp(value, 0, 1);
  return 1 - t * t * t;
}

function smoother(value: number) {
  const t = clamp(value, 0, 1);
  if (t <= Number.EPSILON) return 0;
  if (t >= 1 - Number.EPSILON) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
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
  private reducedMotionQuery: MediaQueryList;
  private focusCameraPosition = new THREE.Vector3();
  private focusCameraTarget = new THREE.Vector3();
  private cameraResetStartPosition = new THREE.Vector3();
  private cameraResetStartTarget = new THREE.Vector3();
  private cameraResetProgress = 1;
  private cueCameraSleevePosition = new THREE.Vector3();
  private cueCameraSleeveTarget = new THREE.Vector3();
  private cueCameraReturnPosition = new THREE.Vector3();
  private cueCameraReturnTarget = new THREE.Vector3();
  private cueCameraTurntablePosition = new THREE.Vector3();
  private cueCameraTurntableTarget = new THREE.Vector3();
  private cueCameraPlatterWorld = new THREE.Vector3();
  private cueCameraTurntableScale = new THREE.Vector3();
  private scratchWorldPosition = new THREE.Vector3();
  private scratchPlatterWorld = new THREE.Vector3();
  private scratchSelectedScale = new THREE.Vector3();
  private scratchTurntableScale = new THREE.Vector3();
  private scratchProjection = new THREE.Vector3();
  private vinylAnchor: VinylScreenAnchor = {
    x: 0,
    y: 0,
    visible: false,
  };
  private vinylAnchorActive = false;
  private responsiveBrowseCamera = browseCamera.clone();
  private responsiveBrowseTarget = browseTarget.clone();
  private lastTimestamp = 0;
  private lastDiagnosticsAt = 0;
  private frameTimes = new Float32Array(180);
  private frameTimeIndex = 0;
  private frameTimeCount = 0;
  private isDisposed = false;
  private cuePhase: CueMotionPhase | null = null;
  private cueProgress = 0;
  private grooveProgress = 0;
  private targetGrooveProgress = 0;
  private platterSpeed = 0;
  private platterAngle = 0;
  private cueContactFired = false;
  private vinylReturnFired = false;
  private returnAfterVinyl = false;
  private pendingCueProgress: number | null = null;
  private pendingReturnAfterSleeveFlip = false;
  private lastSleeveStateKey = "";
  private lastVinylPresentation: VinylPresentation | null = null;
  private trackTransition: ActiveTrackTransition | null = null;
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
    this.reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener(
      "change",
      this.handleReducedMotionChange,
    );

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
    this.lastTimestamp = performance.now();
    this.animate();
  }

  private setupScene() {
    this.scene.background = new THREE.Color(siteConfig.theme.paper);
    this.scene.fog = new THREE.Fog(siteConfig.theme.paper, 11, 25);

    const hemisphere = new THREE.HemisphereLight("#fffaf1", "#5d554d", 1.75);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight("#fff8ed", 3.4);
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

    const rim = new THREE.DirectionalLight("#e6ded2", 1.1);
    rim.position.set(5.5, 3.5, -3.5);
    this.scene.add(rim);

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
      const { thickness } = resolveSleeveDimensions(record);
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
          : this.shelvedPoseFor(record),
        false,
      );
    });

    const shelfWidth = Math.max(
      shelfMinimumWidth,
      cursor + shelfEndOverhang,
    );
    const shelfMaterial = new THREE.MeshPhysicalMaterial({
      color: siteConfig.theme.structure,
      roughness: 0.82,
      metalness: 0,
    });
    const shelf = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.11, 1.18, 5, 0.035),
      shelfMaterial,
    );
    shelf.name = "archiveShelf";
    shelf.position.set(cursor * 0.5, shelfTop - 0.075, 0.02);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    this.shelfFurniture.add(shelf);

    const backRail = new THREE.Mesh(
      new RoundedBoxGeometry(shelfWidth, 0.13, 0.055, 3, 0.018),
      shelfMaterial,
    );
    backRail.position.set(cursor * 0.5, shelfTop + 0.02, -0.55);
    backRail.castShadow = true;
    this.shelfFurniture.add(backRail);
  }

  private createRecord(
    record: CatalogRecord,
    index: number,
    x: number,
  ): RuntimeRecord {
    const {
      width,
      height: size,
      thickness,
    } = resolveSleeveDimensions(record);
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

    const sleeveFlipPivot = new THREE.Group();
    sleeveFlipPivot.name = `recordSleeveFlip:${record.id}`;
    inspectionIdle.add(sleeveFlipPivot);

    const frontTexture = toTexture(createFrontCover(record), this.renderer);
    const backTexture = toTexture(createBackCover(record), this.renderer);
    const spineTexture = toTexture(
      createSpineCover(record),
      this.renderer,
      8,
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
      spineDimensions: getSleeveSpineDimensions({
        height: size,
        thickness,
      }),
    });
    const sleeve = sleeveModel.root;
    sleeve.name = `recordSleeve:${record.id}`;
    sleeveFlipPivot.add(sleeve);
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
    sleeveFlipPivot.add(pickProxy);
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
      sleeveFlipPivot,
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
      sleeveFace: "front",
      sleeveFlipTarget: "front",
      sleeveFlipProgress: 1,
      sleeveFlipFromYaw: 0,
      sleeveFlipToYaw: 0,
      sleeveFlipYaw: 0,
      sleeveFlipping: false,
      sleeveFlipReason: "manual",
      activeSide: initialSide,
      activeDiscNumber: initialDiscNumber,
      activeTrackId: initialTrack?.id ?? null,
      surfaceTextureState: {
        cover: record.coverImage ? "loading" : "generated",
        back: record.backCoverImage ? "loading" : "generated",
      },
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

  private handleReducedMotionChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    if (!event.matches || this.cameraResetProgress >= 1) return;
    this.cameraResetProgress = 1;
    this.camera.position.copy(this.focusCameraPosition);
    this.controls.target.copy(this.focusCameraTarget);
    this.camera.lookAt(this.controls.target);
    if (this.selectedIndex !== null) {
      const selected = this.runtimeRecords[this.selectedIndex];
      this.controls.enabled =
        this.mode === "inspect" &&
        this.trackTransition === null &&
        !selected.sleeveFlipping;
    }
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.clearPointerInteraction();
      return;
    }
    this.lastTimestamp = performance.now();
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
    if (
      (event.key === "f" || event.key === "F") &&
      !this.isNativeActivationTarget(event.target)
    ) {
      if (this.toggleSleeveFace()) event.preventDefault();
      return;
    }
    if (this.mode !== "browse") return;
    const jumpToShelfEdge = event.metaKey || event.ctrlKey;
    if (jumpToShelfEdge && event.key === "ArrowRight") {
      event.preventDefault();
      this.browseTo(this.runtimeRecords.length - 1);
    } else if (jumpToShelfEdge && event.key === "ArrowLeft") {
      event.preventDefault();
      this.browseTo(0);
    } else if (event.key === "ArrowRight") {
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

  private shelvedPoseFor(record: RuntimeRecord) {
    return shelvedRecordPose(this.motionLayout, {
      recordX: record.x,
      slotZ: record.slot.position.z,
      cameraX: this.responsiveBrowseCamera.x - this.shelfGroup.position.x,
      cameraZ: this.responsiveBrowseCamera.z,
      width: record.width,
    });
  }

  private updateShelvedRecordPoses() {
    this.runtimeRecords.forEach((record) => {
      if (
        record.index === this.selectedIndex ||
        record.index === this.presentedIndex ||
        record.index === this.motionRecordIndex
      ) {
        return;
      }
      this.commitRecordPose(record, this.shelvedPoseFor(record), false);
    });
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
    record.pose.x = pose.x;
    record.pose.z = pose.z;
    record.pose.yaw = pose.yaw;
    record.pose.scale = pose.scale;
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
      if (this.presentedIndex !== null) {
        const presented = this.runtimeRecords[this.presentedIndex];
        if (
          presented.sleeveFace !== "front" ||
          presented.sleeveFlipping
        ) {
          if (
            !presented.sleeveFlipping ||
            presented.sleeveFlipTarget !== "front"
          ) {
            this.beginSleeveFlip(presented, "front", "browse-reset");
          }
          return;
        }
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
      this.shelvedPoseFor(movingRecord),
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
    const rawDelta =
      (timestamp - this.lastTimestamp) / 1000 || 1 / 60;
    const delta = clamp(rawDelta, 0, 0.05);
    this.lastTimestamp = timestamp;
    this.recordFrameTime(Math.min(rawDelta * 1000, 250));

    this.updateState(delta, timestamp);
    this.updateCameraReset(delta);
    this.updateRecords(delta);
    this.updateCue(delta);
    this.emitVinylPresentation();
    this.updateAudioVisuals(delta);
    this.emitSleeveState();
    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateVinylAnchor();
    this.updateDiagnostics(timestamp);
  };

  private recordFrameTime(frameTimeMs: number) {
    this.frameTimes[this.frameTimeIndex] = frameTimeMs;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
    this.frameTimeCount = Math.min(
      this.frameTimeCount + 1,
      this.frameTimes.length,
    );
  }

  private frameTimeDiagnostics() {
    const samples = Array.from(
      this.frameTimes.subarray(0, this.frameTimeCount),
    ).sort((left, right) => left - right);
    const percentile = (value: number) =>
      samples[
        Math.min(
          samples.length - 1,
          Math.floor(samples.length * value),
        )
      ] ?? 0;
    return {
      samples: samples.length,
      meanMs:
        samples.reduce((total, value) => total + value, 0) /
        Math.max(1, samples.length),
      p95Ms: percentile(0.95),
      maxMs: samples.at(-1) ?? 0,
      over20ms: samples.filter((value) => value > 20).length,
      over32ms: samples.filter((value) => value > 32).length,
    };
  }

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
      if (this.focusProgress >= 0.62) {
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
    } else if (this.mode === "inspect" && this.cuePhase !== null) {
      this.updateCueCamera(delta);
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
      const activeRecord = this.runtimeRecords[this.activeIndex];
      if (activeRecord.surfaceTextureState.cover === "failed") {
        this.callbacks.onStatus(
          `Using generated artwork for ${activeRecord.data.shortTitle}`,
        );
      }
    }
    this.shelfGroup.position.x = -this.xAtIndex(this.scrollIndex);
    this.updateShelvedRecordPoses();
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
      const reveal = smoother((motionFocus - 0.46) / 0.54);
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
      this.updateSleeveFlip(record, delta);
      const mouthOpen = isSelected ? smoother(this.sleeveRevealProgress) : 0;
      record.sleeveMouth.scale.z = 1 + mouthOpen * 0.72;
      record.sleeveMouth.rotation.y = -mouthOpen * 0.014;
      record.sleeveMouth.position.z = mouthOpen * 0.0035;

      if (!isSelected) record.vinyl.visible = false;
      const hoverScale = 1 + record.hover * 0.008;
      if (!isSelected) record.content.scale.setScalar(record.pose.scale * hoverScale);
    });
  }

  private currentSleeveRecord() {
    const index =
      this.mode === "browse" ? this.activeIndex : this.selectedIndex;
    return index === null ? null : this.runtimeRecords[index] ?? null;
  }

  private canFlipSleeve(record = this.currentSleeveRecord()) {
    if (!record || record.sleeveFlipping) return false;
    if (this.mode === "browse") {
      return (
        this.presentedIndex === this.activeIndex &&
        record.index === this.activeIndex &&
        this.browseMotionPhase === "idle" &&
        this.pendingFocusIndex === null
      );
    }
    if (this.mode !== "inspect" || record.index !== this.selectedIndex) {
      return false;
    }
    if (
      this.trackTransition !== null ||
      this.pendingCueProgress !== null ||
      this.pendingReturnAfterSleeveFlip
    ) {
      return false;
    }
    if (this.cuePhase !== null && this.cuePhase !== "playing") return false;
    return (
      this.playbackMode !== "loading" &&
      this.playbackMode !== "cueing" &&
      this.playbackMode !== "seeking" &&
      this.playbackMode !== "stopping"
    );
  }

  private beginSleeveFlip(
    record: RuntimeRecord,
    target: SleeveFace,
    reason: SleeveFlipReason,
  ) {
    if (
      record.sleeveFlipping &&
      record.sleeveFlipTarget === target
    ) {
      record.sleeveFlipReason = reason;
      return false;
    }
    if (!record.sleeveFlipping && record.sleeveFace === target) return false;

    let targetYaw = sleeveFaceYaw(target);
    while (targetYaw - record.sleeveFlipYaw > Math.PI) {
      targetYaw -= Math.PI * 2;
    }
    while (targetYaw - record.sleeveFlipYaw < -Math.PI) {
      targetYaw += Math.PI * 2;
    }

    record.sleeveFlipFromYaw = record.sleeveFlipYaw;
    record.sleeveFlipToYaw = targetYaw;
    record.sleeveFlipTarget = target;
    record.sleeveFlipProgress = 0;
    record.sleeveFlipping = true;
    record.sleeveFlipReason = reason;
    return true;
  }

  private updateSleeveFlip(record: RuntimeRecord, delta: number) {
    if (record.sleeveFlipping) {
      const duration = this.reducedMotion ? 0.08 : sleeveFlipDuration;
      record.sleeveFlipProgress = clamp(
        record.sleeveFlipProgress + delta / duration,
        0,
        1,
      );
    }

    const pose = record.sleeveFlipping
      ? sleeveFlipMotionPose(
          record.sleeveFlipFromYaw,
          record.sleeveFlipToYaw,
          record.sleeveFlipProgress,
        )
      : {
          yaw: sleeveFaceYaw(record.sleeveFace),
          lift: 0,
          scale: 1,
        };
    record.sleeveFlipYaw = pose.yaw;
    record.sleeveFlipPivot.rotation.y = pose.yaw;
    record.sleeveFlipPivot.position.y = pose.lift;
    record.sleeveFlipPivot.scale.setScalar(pose.scale);

    if (!record.sleeveFlipping || record.sleeveFlipProgress < 1) return;

    const reason = record.sleeveFlipReason;
    record.sleeveFace = record.sleeveFlipTarget;
    record.sleeveFlipping = false;
    record.sleeveFlipProgress = 1;
    record.sleeveFlipYaw = sleeveFaceYaw(record.sleeveFace);
    record.sleeveFlipFromYaw = record.sleeveFlipYaw;
    record.sleeveFlipToYaw = record.sleeveFlipYaw;
    record.sleeveFlipPivot.rotation.y = record.sleeveFlipYaw;
    record.sleeveFlipPivot.position.y = 0;
    record.sleeveFlipPivot.scale.setScalar(1);

    if (reason === "manual") {
      this.callbacks.onStatus(
        `${record.sleeveFace === "back" ? "Back" : "Front"} cover of ${
          record.data.shortTitle
        }`,
      );
    }
    if (
      record.index === this.selectedIndex &&
      record.sleeveFace === "front" &&
      this.pendingCueProgress !== null
    ) {
      const trackProgress = this.pendingCueProgress;
      this.pendingCueProgress = null;
      this.beginCue(trackProgress);
    }
    if (
      record.index === this.selectedIndex &&
      record.sleeveFace === "front" &&
      this.pendingReturnAfterSleeveFlip
    ) {
      this.pendingReturnAfterSleeveFlip = false;
      this.beginReturnToShelf();
    }
  }

  private getSleevePresentationState(): SleevePresentationState {
    const record = this.currentSleeveRecord();
    return {
      recordIndex: record?.index ?? null,
      face: record?.sleeveFace ?? "front",
      flipping: record?.sleeveFlipping ?? false,
      canFlip: this.canFlipSleeve(record),
    };
  }

  private emitSleeveState() {
    const state = this.getSleevePresentationState();
    const key = [
      state.recordIndex ?? "none",
      state.face,
      state.flipping,
      state.canFlip,
    ].join(":");
    if (key === this.lastSleeveStateKey) return;
    this.lastSleeveStateKey = key;
    this.callbacks.onSleeveState(state);
  }

  private cueLayout(): CueMotionLayout | null {
    if (this.selectedIndex === null) return null;
    const selected = this.runtimeRecords[this.selectedIndex];
    const sleeveWorld = this.scratchWorldPosition;
    selected.inspectionIdle.getWorldPosition(sleeveWorld);
    const platterWorld = this.scratchPlatterWorld;
    this.platter.getWorldPosition(platterWorld);
    const turntableScale = this.turntable.getWorldScale(
      this.scratchTurntableScale,
    ).x;
    const selectedScale = selected.content.getWorldScale(
      this.scratchSelectedScale,
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

    if (this.trackTransition) {
      this.updateTrackTransition(selected, layout, delta);
      return;
    }

    if (this.cuePhase === null) {
      selected.vinyl.visible =
        this.mode !== "browse" &&
        this.sleeveRevealProgress > 0 &&
        selected.sleeveFace === "front" &&
        !selected.sleeveFlipping;
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
      this.grooveProgress = damp(
        this.grooveProgress,
        this.targetGrooveProgress,
        this.playbackMode === "seeking" ? 18 : 5.5,
        delta,
      );
      pose = cueMotionPose("playing", this.grooveProgress, layout);
      if (
        this.playbackMode === "paused" ||
        this.playbackMode === "idle" ||
        this.playbackMode === "loading" ||
        this.playbackMode === "error"
      ) {
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
        ? 1 - smoother(this.cueProgress)
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
        this.cueCameraReturnPosition.copy(this.camera.position);
        this.cueCameraReturnTarget.copy(this.controls.target);
        this.controls.enabled = false;
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

  private updateTrackTransition(
    selected: RuntimeRecord,
    layout: CueMotionLayout,
    delta: number,
  ) {
    const transition = this.trackTransition;
    if (!transition) return;

    selected.vinyl.visible = true;
    if (transition.phase === "waiting") {
      this.applyCuePose(
        selected,
        trackTransitionMotionPose(
          transition.kind,
          "waiting",
          1,
          layout,
          transition.fromGrooveProgress,
          transition.toGrooveProgress,
        ),
        delta,
      );
      if (!transition.trackReady) return;
      if (this.playbackMode === "cueing") {
        transition.phase = "lower-tonearm";
        transition.progress = 0;
      } else {
        this.completeTrackTransition(false);
      }
      return;
    }

    const duration = this.reducedMotion
      ? 0.09
      : trackTransitionDurations[transition.phase];
    transition.progress = clamp(transition.progress + delta / duration, 0, 1);
    if (
      transition.phase === "change-vinyl" &&
      transition.progress >= 0.5 &&
      !transition.presentationCommitted
    ) {
      this.commitTrackPresentation(selected, transition.targetTrack);
      transition.presentationCommitted = true;
    }
    this.applyCuePose(
      selected,
      trackTransitionMotionPose(
        transition.kind,
        transition.phase,
        transition.progress,
        layout,
        transition.fromGrooveProgress,
        transition.toGrooveProgress,
      ),
      delta,
    );
    if (transition.progress < 1) return;

    if (transition.phase === "lift-tonearm") {
      transition.progress = 0;
      if (transition.kind === "same-side") {
        this.finishPhysicalTrackChange();
      } else {
        transition.phase = "change-vinyl";
        this.callbacks.onStatus(
          transition.kind === "flip-side"
            ? `Flipping to side ${transition.targetTrack.side ?? "A"}`
            : `Changing to LP ${transition.targetTrack.discNumber ?? 1}`,
        );
      }
      return;
    }

    if (transition.phase === "change-vinyl") {
      if (!transition.presentationCommitted) {
        this.commitTrackPresentation(selected, transition.targetTrack);
        transition.presentationCommitted = true;
      }
      transition.progress = 0;
      this.finishPhysicalTrackChange();
      return;
    }

    this.completeTrackTransition(true);
  }

  private finishPhysicalTrackChange() {
    const transition = this.trackTransition;
    if (!transition) return;
    if (!transition.trackReady) {
      transition.phase = "waiting";
      transition.progress = 0;
      if (this.playbackMode !== "error") {
        this.callbacks.onStatus("Track readying · needle held above the groove");
      }
      return;
    }
    if (this.playbackMode !== "cueing") {
      this.completeTrackTransition(false);
      return;
    }
    transition.phase = "lower-tonearm";
    transition.progress = 0;
    this.callbacks.onStatus(`Cueing ${transition.targetTrack.title}`);
  }

  private completeTrackTransition(needleContact: boolean) {
    const transition = this.trackTransition;
    if (!transition || this.selectedIndex === null) return;
    const selected = this.runtimeRecords[this.selectedIndex];
    if (!transition.presentationCommitted) {
      this.commitTrackPresentation(selected, transition.targetTrack);
    }
    this.grooveProgress = transition.toGrooveProgress;
    this.targetGrooveProgress = transition.toGrooveProgress;
    this.trackTransition = null;
    this.cuePhase = "playing";
    this.cueProgress = 1;
    this.cueContactFired = needleContact;
    this.controls.enabled =
      this.mode === "inspect" && !selected.sleeveFlipping;
    if (needleContact) this.callbacks.onNeedleContact();
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
    const worldPosition = this.scratchWorldPosition;
    selected.content.getWorldPosition(worldPosition);
    this.frameFocusedRecord(worldPosition, easeOutCubic(this.focusProgress));
    this.camera.position.lerp(
      this.focusCameraPosition,
      1 - Math.exp(-(this.reducedMotion ? 28 : 13) * delta),
    );
    this.camera.lookAt(this.focusCameraTarget);
  }

  private beginCameraReset() {
    if (this.mode !== "inspect" || this.selectedIndex === null) return;
    const selected = this.runtimeRecords[this.selectedIndex];
    this.cameraResetStartPosition.copy(this.camera.position);
    this.cameraResetStartTarget.copy(this.controls.target);
    selected.content.getWorldPosition(this.scratchWorldPosition);
    this.frameFocusedRecord(this.scratchWorldPosition);
    this.controls.enabled = false;
    this.cameraResetProgress = 0;

    if (this.reducedMotion) {
      this.cameraResetProgress = 1;
      this.camera.position.copy(this.focusCameraPosition);
      this.controls.target.copy(this.focusCameraTarget);
      this.camera.lookAt(this.controls.target);
      this.controls.enabled =
        this.trackTransition === null && !selected.sleeveFlipping;
    }
  }

  private updateCameraReset(delta: number) {
    if (this.cameraResetProgress >= 1 || this.selectedIndex === null) return;
    this.cameraResetProgress = clamp(
      this.cameraResetProgress +
        delta / (this.reducedMotion ? 0.08 : cameraResetDuration),
      0,
      1,
    );
    const progress = smoother(this.cameraResetProgress);
    this.camera.position.lerpVectors(
      this.cameraResetStartPosition,
      this.focusCameraPosition,
      progress,
    );
    this.controls.target.lerpVectors(
      this.cameraResetStartTarget,
      this.focusCameraTarget,
      progress,
    );
    this.camera.lookAt(this.controls.target);
    this.applyFocusViewOffset(1);

    if (this.cameraResetProgress < 1) return;
    const selected = this.runtimeRecords[this.selectedIndex];
    this.controls.enabled =
      this.mode === "inspect" &&
      this.trackTransition === null &&
      !selected.sleeveFlipping;
  }

  private frameTurntableCamera() {
    this.platter.getWorldPosition(this.cueCameraPlatterWorld);
    const turntableScale = this.turntable.getWorldScale(
      this.cueCameraTurntableScale,
    ).x;
    const mobile = this.isMobile();
    this.cueCameraTurntableTarget.set(
      this.cueCameraPlatterWorld.x +
        turntableScale * (mobile ? 0.12 : 0.28),
      this.cueCameraPlatterWorld.y + turntableScale * 0.1,
      this.cueCameraPlatterWorld.z,
    );
    this.cueCameraTurntablePosition.set(
      this.cueCameraTurntableTarget.x - (mobile ? 0.28 : 0.58),
      this.cueCameraTurntableTarget.y + (mobile ? 1.9 : 2.75),
      this.cueCameraTurntableTarget.z + (mobile ? 4.2 : 5.15),
    );
  }

  private updateCueCamera(delta: number) {
    const phase = this.cuePhase;
    if (!phase) return;
    if (phase === "playing") {
      if (this.cueProgress >= 1) return;
      this.cueProgress = clamp(
        this.cueProgress +
          delta / (this.reducedMotion ? 0.08 : playingCameraReturnDuration),
        0,
        1,
      );
      const returnProgress = smoother(this.cueProgress);
      this.camera.position.lerpVectors(
        this.cueCameraReturnPosition,
        this.cueCameraSleevePosition,
        returnProgress,
      );
      this.controls.target.lerpVectors(
        this.cueCameraReturnTarget,
        this.cueCameraSleeveTarget,
        returnProgress,
      );
      this.camera.lookAt(this.controls.target);
      this.applyFocusViewOffset(returnProgress);
      if (this.cueProgress >= 1 && this.selectedIndex !== null) {
        const selected = this.runtimeRecords[this.selectedIndex];
        this.controls.enabled =
          this.mode === "inspect" && !selected.sleeveFlipping;
      }
      return;
    }
    const phaseProgress =
      phase === "extract-vinyl"
        ? clamp(
            (this.cueProgress - idleVinylReveal) /
              Math.max(0.001, 1 - idleVinylReveal),
            0,
            1,
          )
        : this.cueProgress;
    const mix = cueCameraTurntableMix(phase, phaseProgress);
    const returning =
      phase === "raise-tonearm" ||
      phase === "return-to-sleeve" ||
      phase === "reinsert-vinyl";
    if (!returning) this.frameTurntableCamera();
    const turntablePosition = returning
      ? this.cueCameraReturnPosition
      : this.cueCameraTurntablePosition;
    const turntableTarget = returning
      ? this.cueCameraReturnTarget
      : this.cueCameraTurntableTarget;
    this.camera.position.lerpVectors(
      this.cueCameraSleevePosition,
      turntablePosition,
      mix,
    );
    this.controls.target.lerpVectors(
      this.cueCameraSleeveTarget,
      turntableTarget,
      mix,
    );
    this.camera.lookAt(this.controls.target);
    this.applyFocusViewOffset(1 - mix);
  }

  private emitVinylPresentation() {
    const presentation = vinylPresentationForCue(
      this.cuePhase,
      this.trackTransition !== null,
    );
    if (presentation === this.lastVinylPresentation) return;
    this.lastVinylPresentation = presentation;
    this.callbacks.onVinylPresentation(presentation);
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
    if (this.selectedIndex === null || this.mode !== "inspect") {
      if (this.vinylAnchorActive) {
        this.vinylAnchorActive = false;
        this.callbacks.onVinylAnchor(null);
      }
      return;
    }
    const selected = this.runtimeRecords[this.selectedIndex];
    if (!selected.vinyl.visible) {
      if (this.vinylAnchorActive) {
        this.vinylAnchorActive = false;
        this.callbacks.onVinylAnchor(null);
      }
      return;
    }
    const projected = this.scratchProjection;
    selected.vinylLabel.getWorldPosition(projected);
    projected.project(this.camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      projected.x > -1.08 &&
      projected.x < 1.08 &&
      projected.y > -1.08 &&
      projected.y < 1.08;
    this.vinylAnchor.x =
      (projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
    this.vinylAnchor.y =
      (-projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
    this.vinylAnchor.visible = visible;
    this.vinylAnchorActive = true;
    this.callbacks.onVinylAnchor(this.vinylAnchor);
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
    this.updateShelvedRecordPoses();
    if (this.mode === "browse" && this.focusProgress < 0.01) {
      this.camera.clearViewOffset();
      this.camera.position.copy(this.responsiveBrowseCamera);
      this.camera.lookAt(this.responsiveBrowseTarget);
    } else if (this.mode === "inspect" && this.selectedIndex !== null) {
      if (this.cuePhase === "playing") {
        this.cueProgress = 1;
        this.beginCameraReset();
      } else if (this.cuePhase === null) {
        this.beginCameraReset();
      }
    }
  };

  private isMobile() {
    return this.canvas.clientWidth < 760;
  }

  private async loadSurfaceTexture(
    runtime: RuntimeRecord,
    surface: RuntimeRecord["frontSurface"] | RuntimeRecord["backSurface"],
    url: string,
    kind: "cover" | "back",
  ) {
    runtime.surfaceTextureState[kind] = "loading";
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    let texture: THREE.Texture;
    try {
      try {
        texture = await loader.loadAsync(url);
      } catch {
        if (this.isDisposed) return;
        texture = await loader.loadAsync(artworkRetryUrl(url));
      }

      if (this.isDisposed) {
        texture.dispose();
        return;
      }
      runtime.surfaceTextureState[kind] = "loaded";
      texture.name = `${kind}:${runtime.data.id}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      const previous = surface.material.map;
      surface.material.map = texture;
      surface.material.needsUpdate = true;
      const previousIndex = previous
        ? runtime.textures.indexOf(previous)
        : -1;
      if (previousIndex >= 0) {
        runtime.textures.splice(previousIndex, 1, texture);
      } else {
        runtime.textures.push(texture);
      }
      previous?.dispose();
    } catch {
      if (this.isDisposed) return;
      runtime.surfaceTextureState[kind] = "failed";
      const currentIndex =
        this.mode === "browse" ? this.activeIndex : this.selectedIndex;
      if (runtime.index === currentIndex) {
        this.callbacks.onStatus(
          `Using generated artwork for ${runtime.data.shortTitle}`,
        );
      }
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
    this.canvas.dataset.frameP95 = diagnostics.frameTime.p95Ms.toFixed(2);
    this.canvas.dataset.frameMax = diagnostics.frameTime.maxMs.toFixed(2);
    this.canvas.dataset.frameOver20 = String(diagnostics.frameTime.over20ms);
    this.canvas.dataset.motionPhase = diagnostics.motionPhase;
    this.canvas.dataset.cuePhase = diagnostics.cuePhase ?? "idle";
    this.canvas.dataset.trackTransition =
      diagnostics.trackTransitionPhase ?? "idle";
    this.canvas.dataset.sceneMode = diagnostics.sceneMode;
    this.canvas.dataset.playbackMode = diagnostics.playbackMode;
    this.canvas.dataset.sleeveFace = diagnostics.sleeveFace;
    this.canvas.dataset.sleeveFlipPhase = diagnostics.sleeveFlipPhase;
    this.canvas.dataset.canFlipSleeve = String(diagnostics.canFlipSleeve);
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

  toggleSleeveFace() {
    const record = this.currentSleeveRecord();
    if (!this.canFlipSleeve(record) || !record) return false;
    const target = record.sleeveFace === "front" ? "back" : "front";
    this.beginSleeveFlip(record, target, "manual");
    this.callbacks.onStatus(
      `Turning ${record.data.shortTitle} to the ${target} cover`,
    );
    return true;
  }

  startCue(trackProgress = 0) {
    if (
      this.mode !== "inspect" ||
      this.selectedIndex === null ||
      (this.cuePhase !== null && this.cuePhase !== "playing")
    ) {
      return false;
    }
    if (this.cuePhase === "playing") return true;
    const runtime = this.runtimeRecords[this.selectedIndex];
    if (runtime.sleeveFace !== "front" || runtime.sleeveFlipping) {
      this.controls.enabled = false;
      this.pendingCueProgress = clamp(trackProgress, 0, 1);
      this.playbackMode = "cueing";
      this.beginSleeveFlip(runtime, "front", "cue");
      this.callbacks.onStatus("Turning the sleeve front before cueing");
      return true;
    }
    return this.beginCue(trackProgress);
  }

  private beginCue(trackProgress = 0) {
    if (this.mode !== "inspect" || this.selectedIndex === null) return false;
    this.cameraResetProgress = 1;
    this.controls.enabled = false;
    this.cueCameraSleevePosition.copy(this.camera.position);
    this.cueCameraSleeveTarget.copy(this.controls.target);
    this.frameTurntableCamera();
    this.cueCameraReturnPosition.copy(this.cueCameraTurntablePosition);
    this.cueCameraReturnTarget.copy(this.cueCameraTurntableTarget);
    this.cuePhase = "extract-vinyl";
    this.cueProgress = idleVinylReveal;
    this.sleeveRevealProgress = 1;
    const runtime = this.runtimeRecords[this.selectedIndex];
    const activeTrack = runtime.data.tracks.find(
      (track) => track.id === runtime.activeTrackId,
    );
    this.grooveProgress = activeTrack
      ? trackGrooveProgress(activeTrack, runtime.data.tracks, trackProgress)
      : clamp(trackProgress, 0, 1);
    this.targetGrooveProgress = this.grooveProgress;
    this.cueContactFired = false;
    this.vinylReturnFired = false;
    this.playbackMode = "cueing";
    this.callbacks.onStatus("Removing the pressing from its sleeve");
    return true;
  }

  stopAndReturnVinyl(returnToShelf = false) {
    this.pendingCueProgress = null;
    this.returnAfterVinyl ||= returnToShelf;
    if (this.trackTransition) {
      this.completeTrackTransition(false);
    }
    if (this.cuePhase === null) {
      if (returnToShelf) this.beginReturnToShelf();
      else if (!this.vinylReturnFired) {
        this.vinylReturnFired = true;
        this.callbacks.onVinylReturned();
      }
      return;
    }
    this.cueCameraReturnPosition.copy(this.camera.position);
    this.cueCameraReturnTarget.copy(this.controls.target);
    if (this.selectedIndex !== null) {
      const selected = this.runtimeRecords[this.selectedIndex];
      if (selected.sleeveFace !== "front" || selected.sleeveFlipping) {
        this.beginSleeveFlip(selected, "front", "return");
      }
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
      const selected =
        this.selectedIndex === null
          ? null
          : this.runtimeRecords[this.selectedIndex];
      this.controls.enabled =
        this.mode === "inspect" &&
        !selected?.sleeveFlipping &&
        (this.cuePhase !== "playing" || this.cueProgress >= 1);
    }
  }

  startTrackTransition(track: RecordTrack): TrackTransitionKind | null {
    if (
      this.mode !== "inspect" ||
      this.selectedIndex === null ||
      this.cuePhase !== "playing" ||
      this.trackTransition !== null
    ) {
      return null;
    }
    const runtime = this.runtimeRecords[this.selectedIndex];
    if (runtime.sleeveFlipping) return null;
    const targetTrack = runtime.data.tracks.find(
      (candidate) => candidate.id === track.id,
    );
    if (!targetTrack) return null;

    const kind = classifyTrackTransition(
      {
        side: runtime.activeSide,
        discNumber: runtime.activeDiscNumber,
      },
      targetTrack,
    );
    this.trackTransition = {
      kind,
      phase: "lift-tonearm",
      progress: 0,
      fromGrooveProgress: this.grooveProgress,
      toGrooveProgress: trackGrooveProgress(targetTrack, runtime.data.tracks),
      targetTrack,
      trackReady: false,
      presentationCommitted: false,
    };
    this.controls.enabled = false;
    this.cueContactFired = false;
    this.playbackMode = "cueing";
    this.callbacks.onStatus(
      kind === "same-side"
        ? `Lifting the needle for ${targetTrack.title}`
        : kind === "flip-side"
          ? `Preparing side ${targetTrack.side ?? "A"}`
          : `Preparing LP ${targetTrack.discNumber ?? 1}`,
    );
    return kind;
  }

  continueTrackTransition() {
    if (!this.trackTransition) return false;
    this.trackTransition.trackReady = true;
    return true;
  }

  failTrackTransition() {
    if (!this.trackTransition) return false;
    this.trackTransition.trackReady = false;
    if (this.trackTransition.phase === "lower-tonearm") {
      this.trackTransition.phase = "waiting";
      this.trackTransition.progress = 0;
    }
    return true;
  }

  holdNeedleAfterPlaybackError() {
    if (this.cuePhase !== "playing") return false;
    this.playbackMode = "error";
    const selected =
      this.selectedIndex === null
        ? null
        : this.runtimeRecords[this.selectedIndex];
    this.controls.enabled =
      this.mode === "inspect" && !selected?.sleeveFlipping;
    return true;
  }

  private commitTrackPresentation(
    runtime: RuntimeRecord,
    selectedTrack: RecordTrack,
  ) {
    const nextSide = selectedTrack.side ?? "A";
    const nextDiscNumber = selectedTrack.discNumber ?? 1;
    const presentationChanged =
      runtime.activeSide !== nextSide ||
      runtime.activeDiscNumber !== nextDiscNumber;
    runtime.activeSide = nextSide;
    runtime.activeDiscNumber = nextDiscNumber;
    runtime.activeTrackId = selectedTrack.id;

    if (!presentationChanged || runtime.data.labelImage) return;

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
  }

  selectTrack(track: RecordTrack) {
    if (this.selectedIndex === null) return false;
    const runtime = this.runtimeRecords[this.selectedIndex];
    const selectedTrack = runtime.data.tracks.find(
      (candidate) => candidate.id === track.id,
    );
    if (!selectedTrack) return false;

    this.commitTrackPresentation(runtime, selectedTrack);
    return true;
  }

  setPlaybackProgress(progress: number) {
    if (this.selectedIndex === null) {
      this.targetGrooveProgress = clamp(progress, 0, 1);
      this.grooveProgress = this.targetGrooveProgress;
      return;
    }
    const runtime = this.runtimeRecords[this.selectedIndex];
    const activeTrack = runtime.data.tracks.find(
      (track) => track.id === runtime.activeTrackId,
    );
    this.targetGrooveProgress = activeTrack
      ? trackGrooveProgress(activeTrack, runtime.data.tracks, progress)
      : clamp(progress, 0, 1);
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
    if (this.selectedIndex !== null) {
      const selected = this.runtimeRecords[this.selectedIndex];
      if (selected.sleeveFace !== "front" || selected.sleeveFlipping) {
        this.pendingReturnAfterSleeveFlip = true;
        this.controls.enabled = false;
        this.beginSleeveFlip(selected, "front", "return");
        this.callbacks.onStatus("Turning the sleeve front before returning it");
        return;
      }
    }
    this.cameraResetProgress = 1;
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
    if (this.cuePhase === "playing") {
      this.cueProgress = 1;
    }
    this.beginCameraReset();
  }

  getDiagnostics() {
    const info = this.renderer.info;
    const sleeveState = this.getSleevePresentationState();
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
      artwork: this.runtimeRecords.map((record) => ({
        id: record.data.id,
        cover: record.surfaceTextureState.cover,
        back: record.surfaceTextureState.back,
      })),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      frameTime: this.frameTimeDiagnostics(),
      motionPhase: this.browseMotionPhase,
      cuePhase: this.cuePhase,
      vinylPresentation: vinylPresentationForCue(
        this.cuePhase,
        this.trackTransition !== null,
      ),
      cueProgress: this.cueProgress,
      trackTransitionKind: this.trackTransition?.kind ?? null,
      trackTransitionPhase: this.trackTransition?.phase ?? null,
      sleeveFace: sleeveState.face,
      sleeveFlipPhase: sleeveState.flipping
        ? `to-${this.currentSleeveRecord()?.sleeveFlipTarget ?? "front"}`
        : "idle",
      canFlipSleeve: sleeveState.canFlip,
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
    this.reducedMotionQuery.removeEventListener(
      "change",
      this.handleReducedMotionChange,
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
