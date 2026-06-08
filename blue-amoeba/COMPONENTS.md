# Component Architecture & Analysis

## Project Component Hierarchy

```
App (Main Export)
└── JellyfishOceanWebsite (Root Container)
    ├── FloatingParticles (Background Layer)
    │   └── motion.div (Multiple animated particles × 50)
    ├── Navigation (Fixed Header)
    │   ├── Branding (Waves Icon + Title)
    │   ├── Links (Hidden on mobile)
    │   └── CTA Button (Dive In)
    ├── Hero Section (Full-height container)
    │   ├── Canvas + JellyfishScene (3D Layer)
    │   │   ├── JellyfishMaterial (Custom Shader)
    │   │   ├── Icosahedron Mesh
    │   │   ├── Point Lights × 3
    │   │   ├── Ambient Light
    │   │   └── Fog
    │   └── HeroContent (Text Overlay)
    │       ├── Ripple Effects (On click)
    │       ├── Animated Headline
    │       ├── Subtitle
    │       └── CTA Buttons × 2
    └── Footer (Bottom section)
        ├── Company Info
        ├── Links Grid × 3 columns
        └── Copyright & Legal
```

## Component Breakdown

### 1. JellyfishOceanWebsite (Root Component)

**Purpose**: Orchestrates the entire page layout and visual layers

**Sub-components**:
- Background gradient (CSS)
- Radial gradient overlay
- FloatingParticles layer
- Navigation
- Hero section with Canvas
- Footer

**Key Features**:
- Multi-layered composition
- Gradient backgrounds in dark ocean colors
- Responsive layout structure

### 2. JellyfishScene (Canvas Component)

**Purpose**: Renders 3D jellyfish using custom shaders

**Dependencies**:
- THREE.js
- React Three Fiber (Canvas)
- React Three Drei (shaderMaterial)

**What it does**:
```tsx
const JellyfishScene = () => {
  // Manages:
  // 1. Mouse tracking via window events
  // 2. Click detection for animation triggers
  // 3. Shader uniform updates every frame
  // 4. Rotation & scaling based on interaction
  // 5. Material state and lighting
}
```

**State Management**:
```tsx
const materialRef = useRef<any>(null);      // Shader material reference
const mouse = useRef(new THREE.Vector2());  // Current mouse position
const groupRef = useRef<THREE.Group>(null); // Mesh group for rotation
const [clicked, setClicked] = useState();   // Click state
const targetRotation = useRef();            // Target rotation values
const currentRotation = useRef();           // Current rotation values
```

**Frame Updates** (useFrame hook):
- Updates shader time uniform (animation)
- Lerps mouse position to shader
- Updates intensity based on click state
- Smoothly interpolates rotation
- Adjusts scale with bounce effect

### 3. JellyfishMaterial (Custom Shader)

**Vertex Shader**:
```glsl
// Inputs:
- position          (vertex position)
- normal            (vertex normal)
- uTime             (elapsed time for animation)
- uMouse            (normalized mouse position)
- uIntensity        (interaction strength)

// Processing:
1. Generate 3D Perlin noise at multiple scales
2. Create wave patterns with time-based offset
3. Add tentacle-like movement at bottom
4. Add pulse effect synchronized with time
5. Apply mouse influence (distance-based)
6. Displace vertex position along normal

// Outputs:
- vNormal           (transformed normal)
- vPosition         (displaced position)
- vDisplacement     (amount of displacement)
```

**Fragment Shader**:
```glsl
// Inputs:
- vNormal           (normal from vertex shader)
- vPosition         (position from vertex shader)
- vDisplacement     (displacement amount)
- uColorA, B, C     (blue color palette)
- uTime             (for animated glow)

// Processing:
1. Calculate Fresnel effect (rim lighting)
2. Create vertical gradient color blend
3. Add animated glow based on sin(time)
4. Mix base color with cyan highlight
5. Add emission/edge highlight
6. Calculate alpha (transparency)

// Outputs:
- gl_FragColor      (final color with alpha)
```

### 4. FloatingParticles

**Purpose**: Creates interactive background particle effects

**Features**:
- 50 particles with random positions/sizes
- Mouse-proximity detection
- Gravity-like floating animation
- Responsive to mouse movement

**Animation Properties**:
```tsx
animate={{
  y: [0, -120, 0],              // Vertical float
  x: [0, distX * influence, 0], // Horizontal drift toward mouse
  opacity: [0.3, 0.9, 0.3],     // Fade in/out
  scale: [1, 1.5 + influence, 1] // Grow when near mouse
}}
transition={{
  duration: 8 + Math.random() * 4,  // 8-12 second duration
  repeat: Infinity,                  // Loop indefinitely
  delay: particle.delay,             // Staggered start
  ease: "easeInOut"                  // Smooth easing
}}
```

### 5. Navigation

**Purpose**: Fixed header with branding and navigation

**Components**:
- Logo + Title (with Waves icon)
- Navigation links (Explore, Gallery, About)
- CTA button (Dive In)

**Animation**:
```tsx
initial={{ opacity: 0, y: -20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 1, delay: 0.5 }}
```

**Responsive**:
- Navigation links hidden on mobile (`hidden md:flex`)
- Full-width on desktop

### 6. HeroContent

**Purpose**: Animated hero section with headline and CTAs

**Sub-elements**:
1. **Headline Animation**:
   - Character-by-character animation
   - Each char animated with staggered delay
   - Slides up into view

2. **Ripple Effect**:
   - Creates expanding circles on click
   - Uses portal pattern for visual feedback
   - Multiple ripples stack

3. **CTA Buttons**:
   - Primary button (gradient background)
   - Secondary button (transparent)
   - Hover and tap animations
   - Icon integration (Lucide React)

### 7. Footer

**Purpose**: Multi-column information footer

**Sections**:
- Company info with tagline
- Explore (Gallery, Species, Locations)
- Learn (About, Conservation, Research)
- Connect (Contact, Newsletter, Social)
- Legal links (Privacy, Terms, Cookies)

**Styling**:
- Gradient background (fade from transparent)
- Dark theme with blue accent border
- Responsive grid (1 column on mobile, 4 on desktop)

## Data Flow & State Management

### Global Interactions

1. **Mouse Movement** → Canvas listens to `mousemove`
2. **Mouse Position** → Updates shader uniforms via ref
3. **Particles** → Calculated distance to mouse
4. **Click** → Triggers pulse animation

### Animation Lifecycle

```
User Action
    ↓
React Event Handler (onClick/onMouseMove)
    ↓
State Update (setClicked/setState)
    ↓
Component Re-render
    ↓
useFrame Update (Every frame)
    ↓
Shader Uniform Update
    ↓
Three.js Render
    ↓
Screen Update
```

## Styling System

### Tailwind Classes Used

**Layout**:
- `flex`, `grid`, `absolute`, `fixed`, `relative`
- `w-*`, `h-*`, `max-w-*`, `gap-*`, `p-*`, `pt-*`, `pb-*`

**Typography**:
- `text-*`, `font-bold`, `font-semibold`, `tracking-tighter`
- `text-white`, `text-blue-200`, `text-blue-400`

**Effects**:
- `rounded-full`, `shadow-lg`, `backdrop-blur-sm`, `overflow-hidden`
- `border`, `border-*`, `outline-ring`

**Responsive**:
- `hidden md:flex` (hide on mobile, show on desktop)
- `text-6xl md:text-8xl lg:text-9xl` (responsive text size)
- `flex-col sm:flex-row` (stack on mobile, row on desktop)

**Colors**:
- `bg-gradient-to-b/r/t` (gradient backgrounds)
- `from-*/via-*/to-*` (gradient color stops)
- CSS variables for theme colors

## Performance Considerations

### Rendering Optimization

1. **Three.js**:
   - Shader runs on GPU (most expensive shader calculation offloaded)
   - Single icosahedron mesh (simple geometry: 10,202 vertices)
   - Deferred rendering for lights

2. **React**:
   - `useRef` for non-state values (material, mouse, rotation)
   - `useFrame` runs 60fps, not React render cycle
   - Memoized particle positions in initial render

3. **CSS**:
   - Framer Motion uses RequestAnimationFrame (hardware accelerated)
   - Particles stay in DOM, just transform
   - Tailwind purges unused CSS in production

### Bundle Size (Estimated)

```
three.js              ~300KB (gzipped)
react-three-fiber    ~50KB
framer-motion        ~60KB
tailwind css          ~20KB (with purge)
lucide-react         ~15KB
react 18             ~45KB
-----------
Total                ~490KB
```

## Extension Points

### Add New Features

**Example 1: Custom Particle System**
```tsx
const CustomParticles = () => {
  // Create your own particle logic
  //Render with Canvas or CSS
};
```

**Example 2: Shader Variation**
```tsx
// Create new shader material with different effects
const CustomMaterial = shaderMaterial({ ... }, vertexShader, fragmentShader);
```

**Example 3: Navigation Links**
```tsx
// Add actual routing with React Router
import { Link } from 'react-router-dom';

<Link to="/explore">Explore</Link>
```

## Key Files and Their Purposes

| File | Purpose |
|------|---------|
| `App.tsx` | All components and logic in one file (can be split) |
| `index.css` | Global styles + Tailwind config + theme variables |
| `main.tsx` | React root mounting |
| `tailwind.config.js` | Tailwind theme extensions |
| `vite.config.ts` | Build and dev server configuration |
| `tsconfig.json` | TypeScript compiler options |

## Component Reusability

### Current Architecture
All components are tightly integrated into App.tsx. To make them reusable:

1. **Extract components to separate files**:
   ```
   src/
   ├── components/
   │   ├── JellyfishScene.tsx
   │   ├── FloatingParticles.tsx
   │   ├── Navigation.tsx
   │   ├── HeroContent.tsx
   │   └── Footer.tsx
   ├── App.tsx
   └── index.css
   ```

2. **Add prop interfaces**:
   ```tsx
   interface JellyfishSceneProps {
     onMaterialReady?: (material: any) => void;
     intensity?: number;
   }
   ```

3. **Export for reuse**:
   ```tsx
   export { JellyfishScene, FloatingParticles, Navigation };
   ```

This makes components composable and testable!
