import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ProjectileKind } from '../../types/blueprint';
import { intToHex } from '../../utils/color';

export interface Projectile {
  kind: ProjectileKind;
  body: RigidBody;
  mesh: THREE.Mesh;
  radius: number;
  speed: number;
  horizSpeed: number;
  hp: number;
  landed: boolean;
  destroyed: boolean;
}

function createEmojiBallTexture(emoji: string, bgHex: string): THREE.CanvasTexture | null {
  // Canvas emoji textures are browser-only; headless physics (Node) falls back to a flat colour.
  // oxlint-disable-next-line no-restricted-globals
  const doc = typeof document === 'undefined' ? null : document;
  if (!doc) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '72px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.fillText(emoji, 64, 64);
  ctx.fillText(emoji, 192, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeProjectileMat(
  emoji: string,
  bgHex: string,
  fallbackColor: number,
  opts: {
    roughness?: number;
    metalness?: number;
    emissive?: number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const map = createEmojiBallTexture(emoji, bgHex);
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : fallbackColor,
    map,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

export function createProjectileMaterials(
  customColor: number,
): Record<ProjectileKind, THREE.MeshStandardMaterial> {
  const customHex = intToHex(customColor);
  return {
    hail: makeProjectileMat('🧊', '#dff3ff', 0xdff3ff, {
      roughness: 0.25,
      transparent: true,
      opacity: 0.92,
    }),
    snowball: makeProjectileMat('❄️', '#e8f6ff', 0xf8fcff, { roughness: 0.8 }),
    fireball: makeProjectileMat('🔥', '#ff6a00', 0xff6a00, {
      emissive: 0xff3d00,
      emissiveIntensity: 0.25,
      roughness: 0.4,
    }),
    raider: makeProjectileMat('💣', '#37474f', 0x37474f, { roughness: 0.45, metalness: 0.3 }),
    meteor: makeProjectileMat('☄️', '#4e342e', 0x4e342e, {
      emissive: 0xff5722,
      emissiveIntensity: 0.2,
      roughness: 0.7,
    }),
    custom: makeProjectileMat('💥', customHex, customColor, {
      emissive: customColor,
      emissiveIntensity: 0.2,
      roughness: 0.45,
    }),
  };
}
