// The landing page's 3D backdrop — a "corpus constellation" of ~4.5k particles.
// It reads as a globe of solved problems that holds together through the hero
// and disperses into a wide field as you scroll, while the hue drifts from
// AgentOverflow blue toward cyan and the camera pushes in. Rare gold particles
// are a nod to gold-tier learnings. Lazy-loaded from Landing so the three.js
// chunk never blocks first paint.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { MotionValue } from "framer-motion";

const PARTICLE_COUNT = 2000;
const TARGET_FPS = 30;

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
    // Smaller sprites than the original 300/-mv.z: additive point sprites are
    // pure overdraw, and overdraw is the dominant cost under software WebGL
    // (headless Lighthouse). Halving the radius roughly quarters the fill work.
    gl_PointSize = (0.8 + aSeed * 1.1) * (170.0 / -mv.z);
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

    // Exact brand palette: --primary #0087f8 (hero) → a brighter sky-blue
    // (deep scroll), with --accent #e78c08 gold sparks for the corpus's gold
    // tier. The primary has ~no red channel, so additive blending saturates it
    // toward bright cyan-blue, NOT white — that's what lets it glow safely.
    vec3 blue = vec3(0.02, 0.53, 0.97);
    vec3 sky  = vec3(0.22, 0.67, 1.00);
    vec3 gold = vec3(0.91, 0.55, 0.06);
    vec3 color = mix(blue, sky, uMorph);
    color = mix(color, gold, step(0.955, vSeed)); // ~4.5% gold-tier sparks, full strength

    // Fade as it disperses so the field recedes behind the text-heavy middle
    // sections instead of fighting the copy.
    float fade = clamp(1.6 - vDepth * 0.12, 0.3, 1.0);
    float disperseFade = 1.0 - uMorph * 0.5;
    gl_FragColor = vec4(color, alpha * 0.34 * fade * disperseFade);
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
      // Thick, loose shell: spreading particles across a wide radial band keeps
      // the silhouette from becoming a hard, dense limb that additive would pile up.
      const r = 2.0 + (rand() - 0.5) * 0.9;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.72; // oblate — a lens, not a ball
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
        // Additive for the glow that matches the terminal-glow aesthetic. Safe
        // from white-out because the brand blue has ~no red channel and a
        // loose, low-alpha shell keeps any single line-of-sight from saturating.
        blending={THREE.AdditiveBlending}
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
      <meshBasicMaterial color="#0a90ff" wireframe transparent opacity={0.14} />
    </mesh>
  );
}

// Cap the render loop at TARGET_FPS. With frameloop="demand" the Canvas only
// renders when invalidate() is called, so this ticker is the single throttle:
// ~30 renders/sec instead of the display's 60–144, roughly halving main-thread
// (and, under software WebGL, GPU-on-CPU) time — the difference between frames
// that clear the 50ms long-task bar and frames that pile up as blocking time.
function FrameThrottle() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / TARGET_FPS;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last >= interval) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [invalidate]);
  return null;
}

export default function CorpusScene({ progress }: { progress: MotionValue<number> }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 7.4], fov: 46 }}
      // dpr 1 (was up to 1.5): halves the pixel count the fragment shader fills.
      dpr={1}
      // Render on demand, throttled by FrameThrottle, instead of every vsync.
      frameloop="demand"
      gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
    >
      <FrameThrottle />
      <CorpusCloud progress={progress} />
      <CoreFrame progress={progress} />
    </Canvas>
  );
}
