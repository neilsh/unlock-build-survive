/**
 * OWNER: package D (textures, geometry, audio). Contract below is fixed; internals are yours.
 * Must not fetch any external file: textures come from CanvasTexture, sounds from Web Audio.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuiltinMaterialType, MaterialType } from '../types/blueprint';
import type { MaterialDef } from '../types/materials';
import { getMaterialDef, isBuiltinMaterial } from '../types/materials';
import { intToHex } from '../utils/color';
import { mulberry32 } from '../utils/rng';
import { PAINTERS, TEXTURE_SIZE } from './blockPainters';
import { finishFace, rivet, speckle } from './textureKit';

const BLOCK_SIZE = 1.96;
const BLOCK_RADIUS = 0.22;
/** Rounded-edge segments; 2 looks the same as 4 at play zoom with ~3x fewer triangles (300 vs 972). */
const BLOCK_SEGMENTS = 2;
const STRUT_RADIUS = 0.15;
const BUMP_SCALE = 1.2;
/** A little metalness on the metal blocks; kept low because the scene has no environment map. */
const METALNESS: Partial<Record<BuiltinMaterialType, number>> = {
  steel: 0.3,
  titanium: 0.35,
  anchor: 0.25,
  magnet: 0.2,
  carbon: 0.15,
  diamond: 0.1,
};

const ROUGHNESS: Record<BuiltinMaterialType, number> = {
  wood: 0.7,
  stone: 0.9,
  bamboo: 0.5,
  foam: 0.85,
  door: 0.65,
  ladder: 0.75,
  rubber: 0.85,
  anchor: 0.45,
  pontoon: 0.55,
  steel: 0.35,
  carbon: 0.35,
  shield: 0.25,
  titanium: 0.25,
  laser: 0.3,
  magnet: 0.35,
  diamond: 0.15,
  beaver: 0.8,
  owl: 0.9,
  spider: 0.8,
};
const TEXTURE_SEEDS: Record<BuiltinMaterialType, number> = {
  wood: 11,
  stone: 23,
  bamboo: 37,
  foam: 53,
  door: 251,
  ladder: 263,
  rubber: 139,
  anchor: 71,
  pontoon: 157,
  steel: 89,
  carbon: 173,
  shield: 103,
  titanium: 191,
  laser: 127,
  magnet: 211,
  diamond: 233,
  beaver: 277,
  owl: 281,
  spider: 283,
};

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function paintCustomTexture(g: CanvasRenderingContext2D, def: MaterialDef) {
  const S = TEXTURE_SIZE;
  const rnd = mulberry32(hashString(def.id));
  g.fillStyle = intToHex(def.color);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)';
    g.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 14, 4 + rnd() * 14);
  }
  speckle(g, rnd, S, 400, '255,255,255', '15,23,42', 2, 0.2);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 8;
  g.strokeRect(8, 8, S - 16, S - 16);
  for (const [rx, ry] of [
    [24, 24],
    [S - 24, 24],
    [24, S - 24],
    [S - 24, S - 24],
  ])
    rivet(g, rx, ry, 5);
  if (def.special === 'shield') {
    g.strokeStyle = '#e0f2fe';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(S / 2, S / 2, 54, 0, Math.PI * 2);
    g.stroke();
  } else if (def.special === 'laser') {
    g.strokeStyle = '#fef08a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2, 28);
    g.lineTo(S / 2, S - 28);
    g.moveTo(28, S / 2);
    g.lineTo(S - 28, S / 2);
    g.stroke();
  } else if (def.anchorMultiplier && def.anchorMultiplier > 1) {
    g.fillStyle = '#fbbf24';
    g.fillRect(0, S - 32, S, 32);
  }
}

export class ProceduralAssets {
  private blockGeometry: THREE.BufferGeometry | null = null;
  private strutGeometry: THREE.BufferGeometry | null = null;
  private textures = new Map<MaterialType, THREE.CanvasTexture | null>();
  private customDefs = new Map<string, MaterialDef>();

  /** Registers active mod material definitions so custom blocks paint with their configured look. */
  setCustomMaterials(defs: ReadonlyMap<string, MaterialDef>): void {
    for (const [k, tex] of this.textures) {
      if (!isBuiltinMaterial(k)) {
        tex?.dispose();
        this.textures.delete(k);
      }
    }
    this.customDefs = new Map(defs);
  }

  /** Rounded toy-block geometry, 2x2x2 world units minus a small gap. Shared; do not dispose per mesh. */
  getBlockGeometry(): THREE.BufferGeometry {
    if (!this.blockGeometry)
      this.blockGeometry = new RoundedBoxGeometry(
        BLOCK_SIZE,
        BLOCK_SIZE,
        BLOCK_SIZE,
        BLOCK_SEGMENTS,
        BLOCK_RADIUS,
      );
    return this.blockGeometry;
  }

  /**
   * Strut geometry: radius ~0.15, length 1 along +Y, centred on the origin. Shared; callers scale
   * mesh.scale.y to the strut length and orient it between the two endpoints.
   */
  getStrutGeometry(): THREE.BufferGeometry {
    if (!this.strutGeometry)
      this.strutGeometry = new THREE.CylinderGeometry(STRUT_RADIUS, STRUT_RADIUS, 1, 12);
    return this.strutGeometry;
  }

  /**
   * A NEW material instance on every call; callers own and dispose it. Textures are shared and cached.
   * BuildController asks for one per material type and piece kind and draws every piece of that type
   * through it with instancing (per-piece X-ray tints are instance colours, see InstancedPieces).
   */
  createMaterial(type: MaterialType): THREE.MeshStandardMaterial {
    const map = this.getTexture(type);
    const def = getMaterialDef(type, this.customDefs);
    return new THREE.MeshStandardMaterial({
      // With a painted map the hue lives in the texture, so the tint is white. Without a DOM
      // (e.g. Node tests) fall back to the flat material colour.
      color: map ? 0xffffff : def.color,
      map,
      // The painted tile doubles as a height map (dark seams/grain read as grooves) at no extra
      // texture cost. Skipped without a DOM.
      bumpMap: map,
      bumpScale: map ? BUMP_SCALE : 0,
      roughness: isBuiltinMaterial(type) ? ROUGHNESS[type] : 0.45,
      metalness: isBuiltinMaterial(type) ? (METALNESS[type] ?? 0) : 0.1,
    });
  }

  private getTexture(type: MaterialType): THREE.CanvasTexture | null {
    if (!this.textures.has(type)) this.textures.set(type, this.paintTexture(type));
    return this.textures.get(type) ?? null;
  }

  private paintTexture(type: MaterialType): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const def = getMaterialDef(type, this.customDefs);
    if (isBuiltinMaterial(type)) {
      const rnd = mulberry32(TEXTURE_SEEDS[type]);
      PAINTERS[type](g, rnd, intToHex(def.color));
      finishFace(g, rnd, TEXTURE_SIZE, type === 'ladder' || type === 'door' ? 0.4 : 1);
    } else {
      paintCustomTexture(g, def);
      finishFace(g, mulberry32(hashString(def.id) ^ 0x9e37), TEXTURE_SIZE);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  dispose(): void {
    this.blockGeometry?.dispose();
    this.strutGeometry?.dispose();
    this.blockGeometry = null;
    this.strutGeometry = null;
    for (const tex of this.textures.values()) tex?.dispose();
    this.textures.clear();
  }
}
