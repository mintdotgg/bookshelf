import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import {
  GLTFLoader,
  type GLTF,
} from "three/addons/loaders/GLTFLoader.js";
import type { LoadingManager } from "three";

const defaultDecoderPath =
  "https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/";

const dracoLoaders = new Map<string, DRACOLoader>();

function sharedDracoLoader(path: string) {
  let loader = dracoLoaders.get(path);
  if (!loader) {
    loader = new DRACOLoader().setDecoderPath(path);
    dracoLoaders.set(path, loader);
  }
  return loader;
}

export function createMintGltfLoader(options: {
  manager?: LoadingManager;
  decoderPath?: string;
} = {}) {
  const loader = new GLTFLoader(options.manager);
  return loader.setDRACOLoader(
    sharedDracoLoader(options.decoderPath ?? defaultDecoderPath),
  );
}

export async function loadMintGltf(
  url: string,
  options: {
    manager?: LoadingManager;
    decoderPath?: string;
  } = {},
): Promise<GLTF> {
  return createMintGltfLoader(options).loadAsync(url);
}

export function disposeMintGltfRuntime() {
  dracoLoaders.forEach((loader) => loader.dispose());
  dracoLoaders.clear();
}
