import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DriftPoint } from "@/lib/oily/types";

export interface OilSpill3DProps {
  points: DriftPoint[];
  step: number;
  spillAreaKm2: number;
  /** 0..1 severity intensity — drives slick darkness/size. */
  intensity?: number;
  /**
   * Optional normalized silhouette (roughly [-1, 1] domain, closed loop) extracted
   * from an uploaded SAR/optical image. When provided, the 3D slick mesh is shaped
   * to match it instead of using a plain circle.
   */
  shapePoints?: [number, number][] | null;
}

const PLANE = 60; // world units across the water plane
const WATER_SEG = 120;
const OIL_SEG = 64;

/** Sum-of-sines Gerstner-ish wave height at a world (x, z) and time. */
function waveHeight(x: number, z: number, t: number) {
  return (
    Math.sin(x * 0.18 + t * 0.9) * 0.55 +
    Math.sin(z * 0.13 - t * 0.7) * 0.6 +
    Math.sin((x + z) * 0.09 + t * 1.3) * 0.35 +
    Math.cos(x * 0.05 - z * 0.07 + t * 0.4) * 0.4
  );
}

/** Unit-scale (~radius 1) flat geometry for the slick footprint: a custom silhouette when supplied, otherwise a circle. */
function buildUnitGeometry(shapePoints?: [number, number][] | null): THREE.BufferGeometry {
  if (shapePoints && shapePoints.length >= 8) {
    const shape = new THREE.Shape();
    shape.moveTo(shapePoints[0]![0], shapePoints[0]![1]);
    for (let i = 1; i < shapePoints.length; i++) shape.lineTo(shapePoints[i]![0], shapePoints[i]![1]);
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }
  return new THREE.CircleGeometry(1, OIL_SEG, 0, Math.PI * 2);
}

export default function OilSpill3D({
  points,
  step,
  spillAreaKm2,
  intensity = 0.6,
  shapePoints = null,
}: OilSpill3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Live values the animation loop reads without re-creating the scene.
  const stateRef = useRef({ points, step, spillAreaKm2, intensity });
  stateRef.current = { points, step, spillAreaKm2, intensity };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 460;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a2740);
    scene.fog = new THREE.Fog(0x0a2740, 45, 110);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500);
    camera.position.set(0, 22, 34);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return; // WebGL unavailable
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 14;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI * 0.49; // stay above the horizon
    controls.target.set(0, 1, 0);

    // Lighting — a low sun for water glint.
    scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x0a1a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    sun.position.set(-30, 26, 18);
    scene.add(sun);

    // Water plane (kept in local XY, tilted flat via mesh rotation).
    const waterGeo = new THREE.PlaneGeometry(PLANE, PLANE, WATER_SEG, WATER_SEG);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1668a8,
      roughness: 0.22,
      metalness: 0.65,
      flatShading: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    scene.add(water);
    const waterPos = waterGeo.attributes["position"] as THREE.BufferAttribute;
    const waterBase = Float32Array.from(waterPos.array); // local x,y baseline

    // Oil slick — a silhouette (SAR-derived, or a plain disc) that hugs the wave
    // surface, plus a translucent sheen halo. Built once from a shared unit shape
    // so oil and sheen always have matching vertex counts.
    const unitGeo = buildUnitGeometry(shapePoints);
    const oilGeo = unitGeo.clone();
    const sheenGeo = unitGeo.clone();
    unitGeo.dispose();

    const oilMat = new THREE.MeshStandardMaterial({
      color: 0x090a0f,
      roughness: 0.08,
      metalness: 0.95,
      emissive: 0x241634,
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
    });
    const oil = new THREE.Mesh(oilGeo, oilMat);
    oil.rotation.x = -Math.PI / 2;
    scene.add(oil);
    const oilPos = oilGeo.attributes["position"] as THREE.BufferAttribute;
    const oilBase = Float32Array.from(oilPos.array);

    const sheenMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a6a,
      roughness: 0.05,
      metalness: 1,
      transparent: true,
      opacity: 0.32,
      emissive: 0x123a4a,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    });
    const sheen = new THREE.Mesh(sheenGeo, sheenMat);
    sheen.rotation.x = -Math.PI / 2;
    scene.add(sheen);
    const sheenPos = sheenGeo.attributes["position"] as THREE.BufferAttribute;

    // Precompute drift offsets (world x,z) per forecast point, normalised to the plane.
    function driftOffsets() {
      const pts = stateRef.current.points;
      if (pts.length === 0) return [{ x: 0, z: 0 }];
      const p0 = pts[0]!;
      const raw = pts.map((p) => ({ dx: p.lon - p0.lon, dz: p0.lat - p.lat }));
      const max = Math.max(0.0001, ...raw.map((r) => Math.hypot(r.dx, r.dz)));
      const span = PLANE * 0.32; // keep the slick well inside the plane
      return raw.map((r) => ({ x: (r.dx / max) * span, z: (r.dz / max) * span }));
    }

    let clock = new THREE.Clock();
    let raf = 0;
    let disposed = false;

    function frame() {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      const { step: s, spillAreaKm2: area, intensity: inten, points: pts } = stateRef.current;

      // Animate water surface.
      for (let i = 0; i < waterPos.count; i++) {
        const x = waterBase[i * 3]!;
        const y = waterBase[i * 3 + 1]!;
        waterPos.setZ(i, waveHeight(x, y, t));
      }
      waterPos.needsUpdate = true;
      waterGeo.computeVertexNormals();

      // Slick geometry: radius grows with area + lead-time step.
      const offs = driftOffsets();
      const idx = Math.max(0, Math.min(offs.length - 1, s));
      const off = offs[idx]!;
      const baseR = Math.max(2.2, Math.sqrt(Math.max(1, area)) * 1.1);
      const radius = baseR * (1 + idx * 0.16);

      // Oil silhouette — sample the same wave field so it sits on the water.
      for (let i = 0; i < oilPos.count; i++) {
        const lx = oilBase[i * 3]! * radius;
        const ly = oilBase[i * 3 + 1]! * radius;
        oilPos.setX(i, lx);
        oilPos.setY(i, ly);
        oilPos.setZ(i, waveHeight(off.x + lx, -off.z + ly, t) + 0.08);
      }
      oilPos.needsUpdate = true;
      oilGeo.computeVertexNormals();
      oil.position.set(off.x, 0, off.z);
      oilMat.emissiveIntensity = 0.3 + inten * 0.5;

      // Sheen halo — a touch larger, same silhouette, drifting with the slick.
      const sr = radius * 1.5;
      for (let i = 0; i < oilPos.count; i++) {
        const lx = oilBase[i * 3]! * sr;
        const ly = oilBase[i * 3 + 1]! * sr;
        sheenPos.setX(i, lx);
        sheenPos.setY(i, ly);
        sheenPos.setZ(i, waveHeight(off.x + lx, -off.z + ly, t * 1.2) + 0.04);
      }
      sheenPos.needsUpdate = true;
      sheen.position.set(off.x, 0, off.z);
      const hue = (t * 0.03) % 1;
      sheenMat.color.setHSL(hue, 0.6, 0.4);

      // Fade the future path of the slick with faint markers.
      void pts;

      controls.update();
      renderer.render(scene, camera);
    }
    frame();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || width;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      oilGeo.dispose();
      oilMat.dispose();
      sheenGeo.dispose();
      sheenMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapePoints]);

  return <div ref={mountRef} className="size-full" />;
}
