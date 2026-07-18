// The landing page's 3D backdrop — a "corpus constellation" of ~4.5k particles.
// It reads as a globe of solved problems that holds together through the hero
// and disperses into a wide field as you scroll, while the hue drifts from
// AgentOverflow blue toward cyan and the camera pushes in. Rare gold particles
// are a nod to gold-tier learnings. Lazy-loaded from Landing so the three.js
// chunk never blocks first paint.
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { MotionValue } from "framer-motion";

const PARTICLE_COUNT = 2600;

// Hermite ease, clamped — same curve GLSL's smoothstep uses.
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const VERT = /* glsl */ `
  attribute vec3 aScattered;
  attribute float aSeed;
  uniform float uTime;
  uniform float uMorph;      // 0 = tight corpus globe, 1 = dispersed field
  varying float vSeed;
  varying float vDepth;

  void main() {
    vSeed = aSeed;
    // Blend the ordered globe into the scattered cloud, with a per-particle
    // breathing wobble so the shape is never dead-still.
    vec3 base = mix(position, aScattered, uMorph);
    float wobble = sin(uTime * 0.6 + aSeed * 6.2831) * 0.05;
    vec3 pos = base + normalize(base) * wobble;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.9 + aSeed * 1.3) * (300.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  uniform float uMorph;
  varying float vSeed;
  varying float vDepth;

  void main() {
    // Soft round sprite
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.08, d);

    // AgentOverflow blue (hero) → cyan (deep scroll); rare gold sparks are the
    // "gold tier" of the corpus. Colors kept deep and alpha low: this material
    // blends additively, so overlapping particles SUM — bright colors at high
    // alpha clip to a white blob wherever the globe is dense.
    vec3 blue = vec3(0.24, 0.36, 0.92);
    vec3 cyan = vec3(0.16, 0.62, 0.74);
    vec3 gold = vec3(0.95, 0.68, 0.22);
    vec3 color = mix(blue, cyan, uMorph);
    color = mix(color, gold, step(0.96, vSeed) * 0.9); // ~4% gold-tier sparks

    // Fade as it disperses: a bright orb in the hero that recedes into a faint,
    // sparse backdrop behind the text-heavy sections, so it never fights copy.
    float fade = clamp(1.6 - vDepth * 0.12, 0.25, 1.0);
    float disperseFade = 1.0 - uMorph * 0.6;
    gl_FragColor = vec4(color, alpha * 0.55 * fade * disperseFade);
  }
`;

function CorpusCloud({ progress }: { progress: MotionValue<number> }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const points = useRef<THREE.Points>(null);

  const { positions, scattered, seeds } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const scattered = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);
    // Deterministic pseudo-random so the scene is identical every load.
    let s = 1337;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Fibonacci sphere with radial noise — an even, organic shell.
      const t = i / PARTICLE_COUNT;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 1.85 + (rand() - 0.5) * 0.45;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.85; // slightly oblate
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // Dispersed target: a wide, sparse field the globe dissolves into — wide
      // enough that the particles never crowd the copy behind them.
      scattered[i * 3] = (rand() - 0.5) * 15;
      scattered[i * 3 + 1] = (rand() - 0.5) * 10;
      scattered[i * 3 + 2] = (rand() - 0.5) * 8 - 1.5;

      seeds[i] = rand();
    }
    return { positions, scattered, seeds };
  }, []);

  useFrame(({ clock, camera }) => {
    const p = progress.get();
    if (material.current) {
      material.current.uniforms.uTime.value = clock.elapsedTime;
      // Three acts, all smoothstep-eased so no segment starts or ends with a
      // visible kink: the globe holds through the hero, disperses across the
      // middle sections, hangs as a field, then fully re-gathers for the
      // closing CTA — the journey ends where it began.
      const disperse = smoothstep(0.12, 0.55, p);
      const regather = smoothstep(0.74, 0.98, p);
      material.current.uniforms.uMorph.value = disperse * (1 - regather);
    }
    if (points.current) {
      points.current.rotation.y = clock.elapsedTime * 0.04 + p * Math.PI * 1.2;
      points.current.rotation.x = Math.sin(p * Math.PI) * 0.18;
    }
    // Dive in through the dispersal, pull back out as it re-gathers — so the
    // closing orb sits whole and distant, not shoved into the viewer's face.
    camera.position.z = 7.4 - Math.sin(p * Math.PI) * 1.7;
    camera.position.y = Math.sin(p * Math.PI) * -0.6;
    camera.lookAt(0, 0, 0);
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScattered" args={[scattered, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        // Normal (not additive) blending: additive SUMS overlapping particles,
        // so a dense sphere limb clips to white. Normal compositing keeps the
        // blue true no matter how many particles stack.
        blending={THREE.NormalBlending}
        uniforms={{ uTime: { value: 0 }, uMorph: { value: 0 } }}
      />
    </points>
  );
}

// Faint wireframe core inside the cloud — gives the globe a structural spine.
function CoreFrame({ progress }: { progress: MotionValue<number> }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const p = progress.get();
    const disperse = smoothstep(0.12, 0.55, p);
    const regather = smoothstep(0.74, 0.98, p);
    const m = disperse * (1 - regather);
    mesh.current.rotation.y = -clock.elapsedTime * 0.06;
    mesh.current.rotation.z = p * Math.PI * 0.5;
    mesh.current.scale.setScalar(1 - m * 0.4);
    // Brightest when the globe is whole (hero + closing), fades while dispersed.
    (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.09 * (1 - m * 0.85);
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.4, 1]} />
      <meshBasicMaterial color="#5b82ff" wireframe transparent opacity={0.1} />
    </mesh>
  );
}

export default function CorpusScene({ progress }: { progress: MotionValue<number> }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 7.4], fov: 46 }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
    >
      <CorpusCloud progress={progress} />
      <CoreFrame progress={progress} />
    </Canvas>
  );
}
