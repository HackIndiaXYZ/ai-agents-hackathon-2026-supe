# Blue Amoeba Project Setup Guide

## Project Overview

Your Blue Amoeba project is now fully set up with a complete React + TypeScript frontend featuring an interactive 3D jellyfish animation website. The project includes:

✅ **React 18.3** with TypeScript  
✅ **Vite** for fast development and building  
✅ **Tailwind CSS 4.0** with custom theme system  
✅ **Three.js** with React Three Fiber for 3D graphics  
✅ **Framer Motion** for smooth UI animations  
✅ **Lucide React** for icons  

## Project Structure

```
blue-amoeba/
├── src/
│   ├── App.tsx              # Main jellyfish ocean component
│   │   ├── JellyfishMaterial    # Custom GLSL shader material
│   │   ├── JellyfishScene       # 3D Three.js scene
│   │   ├── FloatingParticles    # Background particle effects
│   │   ├── Navigation           # Top navigation bar
│   │   ├── HeroContent          # Hero section with animations
│   │   └── Footer               # Footer component
│   ├── main.tsx             # React entry point
│   ├── index.css            # Global styles + Tailwind config
│   └── vite-env.d.ts        # TypeScript Vite types
│
├── index.html               # HTML entry point
├── vite.config.ts           # Vite build configuration
├── tsconfig.json            # TypeScript configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── postcss.config.js        # PostCSS configuration
├── package.json             # Project dependencies
├── README.md                # Project documentation
└── .gitignore               # Git ignore rules
```

## Installation & Setup

### Prerequisites

- **Node.js 16+** (Download from https://nodejs.org)
- **npm** or **yarn** (comes with Node.js)

### Steps to Get Started

1. **Navigate to the project directory**:
   ```bash
   cd blue-amoeba
   ```

2. **Install all dependencies**:
   ```bash
   npm install
   ```
   
   This installs:
   - React and React DOM
   - Vite and build tools
   - TypeScript
   - Tailwind CSS
   - Three.js and React Three Fiber
   - Framer Motion
   - And other dependencies

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   
   The server will start at `http://localhost:5173`  
   Your browser should open automatically!

4. **See your jellyfish in action**:
   - Move your mouse around to interact with the jellyfish
   - Click anywhere to trigger pulse animations
   - Enjoy the floating particles and smooth animations

## Available Commands

```bash
# Start development server with hot reload
npm run dev

# Build for production (creates optimized dist folder)
npm run build

# Preview the production build locally
npm run preview

# Run ESLint to check code quality (if configured)
npm run lint
```

## Understanding the Components

### JellyfishScene
The core 3D component that creates:
- Custom GLSL shader material with realistic water effects
- Mouse tracking and interaction
- Multiple light sources for 3D depth
- Perlin noise-based vertex displacement
- Click-triggered pulse animations

**Key Features:**
- Updates shader uniforms every frame based on mouse position
- Responsive to user clicks with intensity effects
- Smooth rotation following mouse movement
- Dynamic scaling on interaction

### FloatingParticles
Creates bioluminescent particle effects:
- 50 animated particles scattered across the viewport
- Particles are attracted to mouse cursor
- Smooth floating animations with opacity changes
- Uses Framer Motion for performant animations

### Navigation
Top navigation bar with:
- Branding and logo
- Navigation links (Explore, Gallery, About)
- "Dive In" call-to-action button
- Smooth fade-in animation on page load

### HeroContent
Main headline and action section:
- Character-by-character text animation
- Ripple effect on click
- Two primary buttons (Start Exploring, Watch Video)
- Responsive typography (scales with screen size)

### Footer
Multi-column footer with:
- Company information
- Explore, Learn, and Connect sections
- Privacy, Terms, and Cookies links
- Responsive grid layout

## Styling System

### Tailwind CSS Integration

The project uses **Tailwind CSS v4** with:

**Custom CSS Variables** (in `src/index.css`):
```css
--radius          /* Border radius base */
--background      /* Main background color */
--foreground      /* Text color */
--card            /* Card backgrounds */
--primary         /* Primary brand color */
--secondary       /* Secondary color */
--accent          /* Accent color */
--destructive     /* Error color */
--border          /* Border color */
--ring            /* Focus ring color */
```

**Theme Options:**
- Light mode (default) with bright whites and dark text
- Dark mode (`:root` and `.dark` class) with dark backgrounds
- Uses `oklch()` color space for better color harmony

**Tailwind Configuration** (`tailwind.config.js`):
- Extends colors using CSS variables
- Custom border radius scale (sm, md, lg, xl)
- Purges unused CSS in production
- Content scanning for `src/**/*.{js,ts,jsx,tsx}`

### Customizing Styles

To change the jellyfish colors:

1. Open `src/index.css`
2. Find the `:root` section (Light theme) or `.dark` section (Dark theme)
3. Modify the `--color-*` variables:

```css
:root {
  --primary: oklch(0.205 0 0);        /* Dark blue */
  --accent: oklch(0.97 0 0);          /* Light color */
  /* ... other variables ... */
}
```

4. Changes apply instantly during development!

## TypeScript Support

### Type Definitions

The project includes:
- `tsconfig.json` with strict mode enabled
- React 18 type definitions
- Three.js type definitions (@types/three)
- React Three Fiber types
- Framer Motion types

### Strict Mode Features
- No implicit `any` types
- Unused variable detection
- No unreachable code
- Proper null/undefined handling

Adding new components:
```tsx
import React, { FC } from 'react';

interface ComponentProps {
  title: string;
  onClick?: () => void;
}

const MyComponent: FC<ComponentProps> = ({ title, onClick }) => {
  return <div onClick={onClick}>{title}</div>;
};

export default MyComponent;
```

## Performance Tips

### Development
- Vite provides instant module replacement (HMR)
- Unoptimized builds run fast in dev mode
- No need to rebuild for small changes

### Production Build
1. **Minimize bundle size**:
   ```bash
   npm run build
   # Check dist folder size
   ```

2. **Key optimizations**:
   - Tailwind CSS purges unused styles (only includes CSS you use)
   - Vite tree-shakes unused code
   - Three.js models are streamed efficiently
   - Framer Motion only animates visible elements

### Tips
- Use lazy loading for heavy components with `React.lazy()`
- Optimize images before including them
- Monitor shader performance with browser DevTools

## Common Tasks

### Adding a New Component

1. **Create the component file**:
   ```tsx
   // src/components/MyComponent.tsx
   import React from 'react';

   export const MyComponent = () => {
     return <div className="p-4 rounded-lg bg-primary">Hello!</div>;
   };
   ```

2. **Import and use it**:
   ```tsx
   // In App.tsx or other files
   import { MyComponent } from './components/MyComponent';
   
   <MyComponent />
   ```

### Changing Shader Effects

Edit the `JellyfishMaterial` in `src/App.tsx`:

```tsx
const JellyfishMaterial = shaderMaterial(
  {
    // Uniforms (values you can change per frame)
    uTime: 0,
    uIntensity: 1.0,
    // ...
  },
  // Vertex shader (positions)
  `...glsl code...`,
  // Fragment shader (colors)
  `...glsl code...`
);
```

### Customizing Animation Speed

In `JellyfishScene`, modify the `useFrame` hook:

```tsx
useFrame((state) => {
  const { clock } = state;
  if (materialRef.current) {
    materialRef.current.uTime = clock.getElapsedTime() * 0.5; // Slower animation
    // ...
  }
});
```

### Adding Tailwind Classes

Use any Tailwind class in your JSX:

```tsx
<div className="flex items-center justify-center gap-4 p-8 bg-background text-foreground rounded-lg shadow-lg">
  <p className="text-lg font-semibold">Hello World</p>
</div>
```

## Troubleshooting

### Issue: Port 5173 already in use
```bash
# Kill the process using port 5173 or use different port:
npm run dev -- --port 3000
```

### Issue: Dependencies won't install
```bash
# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Tailwind classes not working
- Make sure you've saved the file
- Check that your HTML/JSX path is in `tailwind.config.js` content array
- Rebuild by running `npm run build`

### Issue: 3D Scene showing blank
- Check browser console for WebGL errors
- Ensure your GPU supports WebGL 2.0
- Try disabling hardware acceleration in browser

## Deployment

### Build Optimized Version

```bash
npm run build
```

This creates a `dist/` folder with:
- Minified and optimized JavaScript
- Processed CSS with only used classes
- Optimized image assets
- Sourcemaps for debugging

### Deploy to Hosting

**Vercel** (Recommended for Vite projects):
```bash
npm install -g vercel
vercel
```

**Netlify**:
1. Connect your GitHub repo
2. Build command: `npm run build`
3. Publish directory: `dist`

**GitHub Pages**:
```bash
npm run build
# Deploy dist folder to gh-pages branch
```

### Environment Variables

For production environment:
1. Create a `.env.local` file (not tracked by git)
2. Add your variables:
   ```
   VITE_API_URL=https://your-api.com
   ```
3. Access in code:
   ```tsx
   const apiUrl = import.meta.env.VITE_API_URL;
   ```

## Next Steps

1. **Explore the code**: Read through `src/App.tsx` to understand how components work together
2. **Customize colors**: Modify CSS variables in `src/index.css`
3. **Add features**: Create new components in `src/components/`
4. **Deploy**: Follow the deployment section above
5. **Share**: Show off your interactive jellyfish website!

## Learning Resources

- [React Documentation](https://react.dev)
- [Vite Guide](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Three.js](https://threejs.org)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/)
- [Framer Motion](https://www.framer.com/motion/)

## Questions or Issues?

Check the README.md for more information about the project structure and features!

Happy coding! 🎉
