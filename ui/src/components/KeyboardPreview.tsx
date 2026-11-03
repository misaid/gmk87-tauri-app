import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, RoundedBox, useTexture } from "@react-three/drei";
import { Matrix4, type InstancedMesh } from "three";
import { keyboardLayout, underglowColor, webglAvailable } from "./keyboard";
import { useAppStore } from "@/store";

const KEY_SIZE = 0.19;
const KEY_HEIGHT = 0.05;

/**
 * All keycaps share one geometry and material. Drawing them as one instanced
 * mesh keeps the preview at a single draw call instead of ~85.
 */
function Keys() {
  const keys = useMemo(keyboardLayout, []);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const matrix = new Matrix4();
    keys.forEach((key, index) => {
      matrix.makeTranslation(key.position[0], key.position[1], key.position[2]);
      instances.setMatrixAt(index, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
  }, [keys]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, keys.length]} castShadow>
      <boxGeometry args={[KEY_SIZE, KEY_HEIGHT, KEY_SIZE]} />
      <meshStandardMaterial color="#2a2c31" />
    </instancedMesh>
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
  return (
    <mesh position={[0, 0.075, -0.62]}>
      <planeGeometry args={[1.4, 0.79]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function BlankDisplay() {
  return (
    <mesh position={[0, 0.075, -0.62]}>
      <planeGeometry args={[1.4, 0.79]} />
      <meshBasicMaterial color="#0b0c10" />
    </mesh>
  );
}

function Keyboard({ url, tint }: { url: string | null; tint: string }) {
  return (
    <group rotation={[-Math.PI / 7, 0, 0]}>
      <RoundedBox args={[3.5, 0.14, 2.0]} radius={0.05} position={[0, -0.05, 0.2]}>
        <meshStandardMaterial color="#1b1c20" metalness={0.4} roughness={0.6} />
      </RoundedBox>
      <Keys />
      <Suspense fallback={<BlankDisplay />}>
        {url ? <TexturedDisplay url={url} /> : <BlankDisplay />}
      </Suspense>
      <pointLight position={[0, -0.4, 0.6]} color={tint} intensity={6} distance={3} />
      <pointLight position={[0, -0.4, -0.6]} color={tint} intensity={6} distance={3} />
    </group>
  );
}

export function KeyboardPreview() {
  const state = useAppStore((s) => s.state);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const tint = state ? underglowColor(state) : "#8b5cf6";

  if (!webglAvailable()) {
    return (
      <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900 text-xs text-white/40">
        Keyboard preview needs WebGL
      </div>
    );
  }

  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900">
      <Canvas camera={{ position: [0, 1.6, 2.6], fov: 42 }} dpr={[1, 1.5]} frameloop="demand">
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 4, 3]} intensity={0.8} />
        <Keyboard url={previewUrl} tint={tint} />
        <OrbitControls enablePan={false} minDistance={2} maxDistance={5} />
        <InvalidateOnChange value={`${previewUrl ?? ""}|${tint}`} />
      </Canvas>
      <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-white/40">
        Preview · drag to orbit
      </span>
    </div>
  );
}
