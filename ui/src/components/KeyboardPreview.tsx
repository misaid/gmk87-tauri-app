import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Cylinder, OrbitControls, RoundedBox, useTexture } from "@react-three/drei";
import { CanvasTexture, Matrix4, Quaternion, SRGBColorSpace, Vector3, type InstancedMesh } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BOARD_TILT,
  displayLayout,
  fieldSize,
  keyboardLayout,
  knobLayout,
  labeledKeys,
  legendY,
  plateLayout,
  toWorld,
  underglowColor,
  webglAvailable,
} from "./keyboard";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

// A unit cube with rounded edges, shared by every keycap instance: real
// keycaps aren't sharp-edged blocks, and the bevel reads even at this scale.
const keycapGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);

/**
 * All keycaps share one geometry and material; each instance is scaled to
 * its own key size. Drawing them as one instanced mesh keeps the preview at
 * a single draw call instead of ~98.
 */
function Keys() {
  const keys = useMemo(keyboardLayout, []);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    keys.forEach((key, index) => {
      position.set(key.position[0], key.position[1], key.position[2]);
      scale.set(key.size[0], key.size[1], key.size[2]);
      matrix.compose(position, rotation, scale);
      instances.setMatrixAt(index, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
  }, [keys]);

  return (
    <instancedMesh ref={mesh} args={[keycapGeometry, undefined, keys.length]} castShadow>
      <meshStandardMaterial color="#eef0f3" roughness={0.55} />
    </instancedMesh>
  );
}

const LEGEND_CANVAS_WIDTH = 1600;

/** Bakes every key's legend into one texture, so the label layer stays a single draw call. */
function buildLegendTexture(): CanvasTexture {
  const [fieldWidth, fieldDepth] = fieldSize();
  const canvas = document.createElement("canvas");
  canvas.width = LEGEND_CANVAS_WIDTH;
  canvas.height = Math.round((LEGEND_CANVAS_WIDTH * fieldDepth) / fieldWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) return new CanvasTexture(canvas);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a2d33";

  for (const key of labeledKeys()) {
    if (!key.label) continue;
    const cellPxW = (key.size[0] / fieldWidth) * canvas.width;
    const cellPxH = (key.size[2] / fieldDepth) * canvas.height;
    const px = ((key.position[0] / fieldWidth) + 0.5) * canvas.width;
    const py = ((key.position[2] / fieldDepth) + 0.5) * canvas.height;

    let fontSize = Math.min(cellPxH * 0.46, key.label.length > 1 ? cellPxW * 0.26 : cellPxW * 0.46);
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    while (fontSize > 8 && ctx.measureText(key.label).width > cellPxW * 0.82) {
      fontSize -= 1;
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    }
    ctx.fillText(key.label, px, py + fontSize * 0.04);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A flat, transparent overlay sitting just above the keycap tops with every legend baked in. */
function KeyLegends() {
  const texture = useMemo(buildLegendTexture, []);
  const [fieldWidth, fieldDepth] = useMemo(fieldSize, []);
  return (
    <mesh position={[0, legendY(), 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[fieldWidth, fieldDepth]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

/** Demand rendering only repaints when React state or the texture changes. */
function InvalidateOnChange({ value }: { value: string }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, value]);
  return null;
}

function TexturedDisplay({ url }: { url: string }) {
  const texture = useTexture(url);
  const { position, size } = useMemo(displayLayout, []);
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function BlankDisplay() {
  const { position, size } = useMemo(displayLayout, []);
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial color="#0b0c10" />
    </mesh>
  );
}

function Knob() {
  const { position, radius, height } = useMemo(knobLayout, []);
  return (
    <Cylinder args={[radius, radius, height, 24]} position={position} castShadow>
      <meshStandardMaterial color="#111317" metalness={0.6} roughness={0.35} />
    </Cylinder>
  );
}

function Keyboard({ url, tint }: { url: string | null; tint: string }) {
  const plate = useMemo(plateLayout, []);
  return (
    <group rotation={[BOARD_TILT, 0, 0]}>
      <RoundedBox args={[plate.size[0], plate.height, plate.size[1]]} radius={0.06} position={plate.position}>
        <meshStandardMaterial color="#1b1c20" metalness={0.4} roughness={0.6} />
      </RoundedBox>
      <Keys />
      <KeyLegends />
      <Knob />
      <Suspense fallback={<BlankDisplay />}>
        {url ? <TexturedDisplay url={url} /> : <BlankDisplay />}
      </Suspense>
      <pointLight position={[0, -0.4, 0.75]} color={tint} intensity={6} distance={3.5} />
      <pointLight position={[0, -0.4, -0.75]} color={tint} intensity={6} distance={3.5} />
    </group>
  );
}

const DEFAULT_CAMERA: [number, number, number] = [0, 2.75, 4.3];
const DEFAULT_TARGET: [number, number, number] = [0, -0.22, 0];

/** Frames the display + knob tightly, for screens where that's what's being edited. */
function zoomFraming(): { camera: [number, number, number]; target: [number, number, number] } {
  const display = displayLayout().position;
  const knob = knobLayout().position;
  // Weighted toward the display (what's being edited on this screen), with
  // just enough pull toward the knob to keep it in frame alongside it.
  const knobWeight = 0.3;
  const localTarget: [number, number, number] = [
    display[0] + (knob[0] - display[0]) * knobWeight,
    display[1] + (knob[1] - display[1]) * knobWeight,
    display[2] + (knob[2] - display[2]) * knobWeight,
  ];
  const target = toWorld(localTarget);

  const [dx, dy, dz] = DEFAULT_CAMERA;
  const [tx, ty, tz] = DEFAULT_TARGET;
  const dirLength = Math.hypot(dx - tx, dy - ty, dz - tz);
  const dir: [number, number, number] = [
    (dx - tx) / dirLength,
    (dy - ty) / dirLength,
    (dz - tz) / dirLength,
  ];
  const zoomDistance = 1.6;
  const camera: [number, number, number] = [
    target[0] + dir[0] * zoomDistance,
    target[1] + dir[1] * zoomDistance,
    target[2] + dir[2] * zoomDistance,
  ];
  return { camera, target };
}

/** Imperatively snaps the camera and OrbitControls target when `zoomed` changes. */
function CameraRig({
  zoomed,
  controlsRef,
}: {
  zoomed: boolean;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const { camera, invalidate } = useThree();
  const zoom = useMemo(zoomFraming, []);

  useEffect(() => {
    const [px, py, pz] = zoomed ? zoom.camera : DEFAULT_CAMERA;
    camera.position.set(px, py, pz);
    const controls = controlsRef.current;
    if (controls) {
      const [tx, ty, tz] = zoomed ? zoom.target : DEFAULT_TARGET;
      controls.target.set(tx, ty, tz);
      controls.update();
    }
    invalidate();
  }, [zoomed, camera, invalidate, controlsRef, zoom]);

  return null;
}

export function KeyboardPreview({ zoomed = false, className }: { zoomed?: boolean; className?: string }) {
  const state = useAppStore((s) => s.state);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const tint = state ? underglowColor(state) : "#8b5cf6";
  const controlsRef = useRef<OrbitControlsImpl>(null);

  if (!webglAvailable()) {
    return (
      <div
        className={cn(
          "flex h-[320px] w-full items-center justify-center rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900 text-xs text-white/40",
          className,
        )}
      >
        Keyboard preview needs WebGL
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-[320px] w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900",
        className,
      )}
    >
      <Canvas camera={{ position: DEFAULT_CAMERA, fov: 46 }} dpr={[1, 1.5]} frameloop="demand">
        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <Keyboard url={previewUrl} tint={tint} />
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          target={DEFAULT_TARGET}
          minDistance={zoomed ? 0.8 : 3.5}
          maxDistance={zoomed ? 2.5 : 9}
        />
        <CameraRig zoomed={zoomed} controlsRef={controlsRef} />
        <InvalidateOnChange value={`${previewUrl ?? ""}|${tint}|${zoomed}`} />
      </Canvas>
      <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-white/40">
        Preview · drag to orbit
      </span>
    </div>
  );
}
