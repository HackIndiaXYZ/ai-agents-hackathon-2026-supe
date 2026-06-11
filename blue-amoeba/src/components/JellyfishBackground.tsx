"use client";

import { useRef, Suspense, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import { shaderMaterial, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { motion } from 'framer-motion';

const JellyfishMaterial = shaderMaterial(
  {
    uTime: 0,
    uMouse: new THREE.Vector2(0, 0),
    uColorA: new THREE.Color("#0ea5e9"),  // Sky-500 blue
    uColorB: new THREE.Color("#1e3a8a"),  // Deep navy blue
    uColorC: new THREE.Color("#2563eb"),  // Mid royal blue — no near-white
    uIntensity: 1.5,
    uPulse: 0.0,
  },
  `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform float uIntensity;
    uniform float uPulse;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;

    // ... (noise functions omitted for brevity, keeping same logic but changing colors) ...
    // RE-INSERTING NOISE FUNCTIONS HERE TO ENSURE THEY EXIST IF SHADER RECOMPILES
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    
    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        
        // Intensified mouse interaction
        float mouseDist = distance(position.xy, uMouse * 3.5);
        float mouseInfluence = smoothstep(2.5, 0.0, mouseDist) * uIntensity;
        
        // More complex wave pattern
        float wave1 = snoise(position * 2.0 + uTime * 0.4) * 0.4;
        float wave2 = snoise(position * 3.5 - uTime * 0.3) * 0.2;
        float wave3 = snoise(position * 5.0 + uTime * 0.2) * 0.1;
        
        float displacement = wave1 + wave2 + wave3;
        displacement += mouseInfluence * 1.2; // Stronger reaction
        
        vDisplacement = displacement;

        vec3 newPosition = position + normal * displacement;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
  `,
  `
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    uniform float uTime;
    uniform float uIntensity;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;
    
    void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDirection)), 2.0); // Sharper fresnel
        
        // Cybernetic gradient
        float gradient = vPosition.y * 0.5 + 0.5;
        vec3 baseColor = mix(uColorA, uColorB, gradient + sin(uTime) * 0.2);
        
        // pulsing core — mix stays within blue range
        float pulse = sin(uTime * 2.0) * 0.5 + 0.5;
        vec3 coreColor = mix(baseColor, uColorC, pulse * 0.4);
        
        // Edge glow — deep blue only, tightly clamped
        vec3 glowColor = uColorA * (fresnel * 0.6 + clamp(vDisplacement, 0.0, 0.4) * 0.5);
        
        // Hard cap: no channel can approach white
        vec3 finalColor = clamp(coreColor + glowColor, 0.0, 0.55);
        
        // Low alpha — prevents additive over-brightness at edges
        float alpha = 0.45 + fresnel * 0.15;
        gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ JellyfishMaterial });

const useMemoMaterial = () => useMemo(() => new JellyfishMaterial(), []);

const JellyfishScene = ({ scale = 0.28 }: { scale?: number }) => {
    const materialRef = useRef<any>(null);
    const mouse = useRef(new THREE.Vector2(0, 0));
    const groupRef = useRef<THREE.Group>(null);
    const [clicked, setClicked] = useState(false);
    
    // Smooth rotation dampening
    const targetRotation = useRef(new THREE.Vector2(0, 0));
    const currentRotation = useRef(new THREE.Vector2(0, 0));
    
    // Cast to any to avoid TS errors with custom shader uniforms
    const material = useMemoMaterial() as any;

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            // Normalized coordinates -1 to 1
            mouse.current.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
            
            // Influence rotation based on mouse position
            targetRotation.current.x = mouse.current.y * 0.8; 
            targetRotation.current.y = mouse.current.x * 0.8;
        };
        const handleClick = () => {
            setClicked(true);
            setTimeout(() => setClicked(false), 800); // Longer effect
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('click', handleClick);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('click', handleClick);
        };
    }, []);


    useFrame((state) => {
        const { clock } = state;
        const time = clock.getElapsedTime();

        if (material) {
            material.uTime = time;
            // Smooth lerp for mouse interaction in shader
            material.uMouse.lerp(mouse.current, 0.08);
            
            // Pulse intensity on click
            const targetIntensity = clicked ? 1.8 : 1.2;
            material.uIntensity += (targetIntensity - material.uIntensity) * 0.1;
        }

        if (groupRef.current) {
            // Smooth rotation towards mouse
            currentRotation.current.x += (targetRotation.current.x - currentRotation.current.x) * 0.05;
            currentRotation.current.y += (targetRotation.current.y - currentRotation.current.y) * 0.05;
            
            // Combine mouse rotation with automatic idle animation
            groupRef.current.rotation.x = currentRotation.current.x + Math.sin(time * 0.5) * 0.1;
            groupRef.current.rotation.y = currentRotation.current.y + time * 0.1; // Continuous slow spin
            
            // Breathing scale animation
            const breath = Math.sin(time * 1.5) * 0.05 + 1;
            const clickScale = clicked ? 1.4 : 1.0;
            const targetScale = breath * clickScale;
            
            groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
        }
    });

    return (
        <group>
            {/* Main Jellyfish Group - Scaled dynamically based on prop */}
            <group ref={groupRef} scale={[scale, scale, scale]}>
                {/* Core Mesh */}
                <mesh>
                    <icosahedronGeometry args={[1.5, 64]} />
                    <primitive object={material} 
                        ref={materialRef} 
                        transparent
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        side={THREE.DoubleSide}
                        attach="material"
                    />
                </mesh>
                
                {/* Outer Wireframe Cage for "Tech" look */}
                <mesh scale={[1.1, 1.1, 1.1]}>
                    <icosahedronGeometry args={[1.5, 4]} />
                    <meshBasicMaterial 
                        color="#38bdf8" 
                        wireframe 
                        transparent 
                        opacity={0.12} 
                        blending={THREE.AdditiveBlending} 
                    />
                </mesh>
            </group>

            {/* 3D Background Elements */}
            <Sparkles count={120} scale={12} size={3} speed={0.3} opacity={0.4} color="#38bdf8" />
            <Sparkles count={80}  scale={10} size={2} speed={0.2} opacity={0.3} color="#1d4ed8" />
            <Sparkles count={60}  scale={18} size={1.5} speed={0.15} opacity={0.25} color="#7dd3fc" />
            
            {/* Dynamic Lighting - Switched purple to deep blue */}
            <pointLight position={[5,  5,  5]} intensity={2.0} color="#38bdf8" distance={20} />
            <pointLight position={[-5,-5,  5]} intensity={2.0} color="#2563eb" distance={20} />
            <ambientLight intensity={0.5} />
        </group>
    );
};

const FloatingParticles = () => {
    const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; delay: number }>>([]);
    const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

    useEffect(() => {
        const newParticles = Array.from({ length: 50 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: Math.random() * 3, // Smaller 2D particles
            delay: Math.random() * 5,
        }));
        setParticles(newParticles);
        const handleMouseMove = (e: MouseEvent) => {
            setMousePos({
                x: (e.clientX / window.innerWidth) * 100,
                y: (e.clientY / window.innerHeight) * 100,
            });
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
            {particles.map((particle: any) => {
                const distX = mousePos.x - particle.x;
                const distY = mousePos.y - particle.y;
                const distance = Math.sqrt(distX * distX + distY * distY);
                const influence = Math.max(0, 1 - distance / 20); // Smaller influence radius
                return (
                    <motion.div
                        key={particle.id}
                        className={`absolute rounded-full ${particle.id % 2 === 0 ? 'bg-sky-400/25' : 'bg-blue-500/20'}`}
                        style={{
                            left: `${particle.x}%`,
                            top: `${particle.y}%`,
                            width: `${particle.size}px`,
                            height: `${particle.size}px`,
                        }}
                        animate={{
                            y: [0, -100, 0],
                            x: [0, distX * influence, 0],
                            opacity: [0.1, 0.4, 0.1],
                        }}
                        transition={{
                            duration: 10 + Math.random() * 10,
                            repeat: Infinity,
                            delay: particle.delay,
                            ease: "linear",
                        }}
                    />
                );
            })}
        </div>
    );
};

export const JellyfishCanvas = ({ scale = 1, opacity = 1 }: { scale?: number; opacity?: number }) => (
    <Canvas 
        camera={{ position: [0, 0, 10], fov: 45 }} 
        dpr={[1, 2]}
        style={{ opacity: opacity, transition: 'opacity 1s ease-in-out' }} 
    > 
        <Suspense fallback={null}>
            <JellyfishScene scale={scale} />
        </Suspense>
        <fog attach="fog" args={['#020b18', 8, 25]} />
    </Canvas>
);

export const PageBackground = ({ showJellyfish = false, isHome = true }: { showJellyfish?: boolean; isHome?: boolean }) => (
    <>
        {/* Base background */}
        <div className="absolute inset-0 bg-[#020b18]" />
        {/* Radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(56,189,248,0.18),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_110%,rgba(29,78,216,0.1),transparent_70%)]" />
        {/* Subtle grid */}
        <div className={`absolute inset-0 bg-[linear-gradient(to_right,rgba(56,189,248,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(56,189,248,0.06)_1px,transparent_1px)] bg-[size:4rem_4rem] transition-opacity duration-700 ${isHome ? 'opacity-100' : 'opacity-50'}`} />

        <FloatingParticles />

        {/* Jellyfish Canvas — fills entire viewport, scale controls apparent size */}
        {showJellyfish && (
            <div className="absolute inset-0 z-0">
                <JellyfishCanvas
                    scale={isHome ? 0.3 : 0.14}
                    opacity={isHome ? 1 : 0.28}
                />
            </div>
        )}

        {/* Scanline sweep */}
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
            <div className="w-full h-[15%] bg-gradient-to-b from-transparent via-sky-500/5 to-transparent animate-scan" />
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#020b18] to-transparent pointer-events-none z-10" />
    </>
);

// ─── Jellyfish Logo SVG ──────────────────────────────────────
export const JellyfishLogo = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
    >
        <defs>
            <radialGradient id="jf-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#bae6fd" stopOpacity="0.9" />
                <stop offset="50%"  stopColor="#38bdf8" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.4" />
            </radialGradient>
            <radialGradient id="jf-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0"   />
            </radialGradient>
            <filter id="jf-blur"><feGaussianBlur stdDeviation="2" /></filter>
        </defs>
        {/* Outer glow */}
        <circle cx="20" cy="20" r="18" fill="url(#jf-glow)" filter="url(#jf-blur)" />
        {/* Main blob */}
        <path d="M20 4 C28 4 36 11 36 20 C36 29 29 36 20 36 C11 36 4 29 4 20 C4 11 12 4 20 4Z" fill="url(#jf-core)" opacity="0.85" />
        {/* Wireframe facet lines */}
        <line x1="20" y1="4"  x2="36" y2="20" stroke="#bae6fd" strokeOpacity="0.35" strokeWidth="0.7" />
        <line x1="20" y1="4"  x2="4"  y2="20" stroke="#7dd3fc" strokeOpacity="0.35" strokeWidth="0.7" />
        <line x1="4"  y1="20" x2="20" y2="36" stroke="#bae6fd" strokeOpacity="0.35" strokeWidth="0.7" />
        <line x1="36" y1="20" x2="20" y2="36" stroke="#7dd3fc" strokeOpacity="0.35" strokeWidth="0.7" />
        <line x1="4"  y1="20" x2="36" y2="20" stroke="#38bdf8" strokeOpacity="0.25" strokeWidth="0.7" />
        <line x1="20" y1="4"  x2="20" y2="36" stroke="#38bdf8" strokeOpacity="0.25" strokeWidth="0.7" />
        {/* Center highlight */}
        <circle cx="20" cy="20" r="3"   fill="#bae6fd" opacity="0.9" />
        <circle cx="20" cy="20" r="1.5" fill="#bae6fd"   opacity="0.8" />
        {/* Rim */}
        <circle cx="20" cy="20" r="16" stroke="url(#jf-core)" strokeWidth="0.8" strokeOpacity="0.5" fill="none" />
    </svg>
);

export default JellyfishCanvas;
