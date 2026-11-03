import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Capsule, ContactShadows } from '@react-three/drei';
import { Component, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { Group } from 'three';
import { BubbleLevel } from './Gauges';
import { watchContextLoss } from '../../lib/runtimeRecovery';
function Model({ pitch, roll }: { pitch: number; roll: number }) {
  const group = useRef<Group>(null);
  const initial = useRef(true);
  const invalidate = useThree((state) => state.invalidate);
  const reduced = useReducedMotion();
  const targetX = (pitch * Math.PI) / 180;
  const targetZ = (roll * Math.PI) / 180 - 0.3;
  useEffect(() => invalidate(), [targetX, targetZ, invalidate, reduced]);
  useFrame((_state, delta) => {
    if (!group.current) return;
    const rotation = group.current.rotation;
    if (initial.current) {
      rotation.x = targetX;
      rotation.z = targetZ;
      initial.current = false;
      return;
    }
    const dx = Math.atan2(Math.sin(targetX - rotation.x), Math.cos(targetX - rotation.x));
    const dz = Math.atan2(Math.sin(targetZ - rotation.z), Math.cos(targetZ - rotation.z));
    const weight = reduced ? 1 : 1 - Math.exp(-24 * Math.min(delta, 0.1));
    rotation.x += dx * weight;
    rotation.z += dz * weight;
    if (!reduced && (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001)) invalidate();
  });
  return (
    <group ref={group}>
      <Capsule args={[0.49, 1.55, 12, 32]}>
        <meshStandardMaterial color="#ccd9dd" metalness={0.7} roughness={0.24} />
      </Capsule>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.505, 0.505, 0.23, 48]} />
        <meshStandardMaterial color="#46c9b0" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.65, 0]}>
        <torusGeometry args={[0.498, 0.017, 8, 48]} />
        <meshStandardMaterial color="#0c2630" />
      </mesh>
      <mesh position={[0, -0.7, 0.481]}>
        <boxGeometry args={[0.24, 0.35, 0.03]} />
        <meshStandardMaterial color="#192b37" />
      </mesh>
      <mesh position={[0, 0.25, 0.485]}>
        <boxGeometry args={[0.1, 0.1, 0.025]} />
        <meshStandardMaterial color="#5ef5c7" emissive="#43cbaa" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}
class Boundary extends Component<
  { children: ReactNode; pitch?: number; roll?: number },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <BubbleLevel pitch={this.props.pitch} roll={this.props.roll} />
    ) : (
      this.props.children
    );
  }
}
const Orientation = memo(function Orientation({ pitch, roll }: { pitch?: number; roll?: number }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => (canvas ? watchContextLoss(canvas, () => setLost(true)) : undefined), [canvas]);
  if (lost)
    return (
      <div className="orientation-fallback">
        <BubbleLevel pitch={pitch} roll={roll} />
        <button
          className="button secondary small"
          onClick={() => {
            setCanvas(null);
            setLost(false);
          }}
        >
          Restore 3D view
        </button>
      </div>
    );
  return (
    <Boundary pitch={pitch} roll={roll}>
      <div
        className="orientation-scene"
        role="img"
        aria-label={`Capsule orientation, pitch ${pitch ?? 'awaiting'} degrees and roll ${roll ?? 'awaiting'} degrees`}
      >
        <div className="scene-grid" />
        <Canvas
          onCreated={({ gl }) => setCanvas(gl.domElement)}
          frameloop="demand"
          camera={{ position: [0, 1, 5.4], fov: 35 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          fallback={<BubbleLevel pitch={pitch} roll={roll} />}
        >
          <ambientLight intensity={1.8} />
          <directionalLight position={[3, 4, 4]} intensity={4} />
          <directionalLight position={[-3, 2, -3]} color="#39b4cc" intensity={3} />
          <Model pitch={pitch ?? 0} roll={roll ?? 0} />
          <ContactShadows
            frames={1}
            resolution={128}
            position={[0, -1.6, 0]}
            opacity={0.4}
            scale={6}
            blur={3}
            far={3}
          />
        </Canvas>
        <div className="orientation-caption">
          {pitch === undefined ? 'ILLUSTRATIVE · AWAITING TELEMETRY' : 'MPU6050 · LIVE ORIENTATION'}
        </div>
      </div>
    </Boundary>
  );
});
export default Orientation;
