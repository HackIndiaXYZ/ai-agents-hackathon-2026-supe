# Blue Amoeba - Jellyfish Ocean Website

A stunning, interactive 3D jellyfish animation website built with React, Three.js, Tailwind CSS, and Framer Motion.

## Features

- **3D Jellyfish Animation**: Interactive 3D jellyfish with custom shader materials and realistic lighting
- **Responsive Design**: Fully responsive layout that works on all device sizes
- **Smooth Animations**: Framer Motion animations for UI elements and particle effects
- **Interactive Effects**: Mouse-tracking jellyfish that responds to user interaction
- **Floating Particles**: Bioluminescent particle effects that respond to mouse movement
- **Modern Styling**: Tailwind CSS with Tailwind v4 features and custom theme variables
- **TypeScript Support**: Fully typed with TypeScript for better development experience

## Tech Stack

- **React 18.3+**: UI library
- **Vite**: Fast build tool and dev server
- **TypeScript**: Type safety
- **Tailwind CSS 4.0**: Utility-first CSS framework
- **Three.js**: 3D graphics library
- **React Three Fiber**: React renderer for Three.js
- **React Three Drei**: Useful helpers for React Three Fiber
- **Framer Motion**: Motion library for smooth animations
- **Lucide React**: Icon library

## Installation

1. **Clone the repository**:
   ```bash
   cd blue-amoeba
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Preview production build**:
   ```bash
   npm run preview
   ```

## Project Structure

```
blue-amoeba/
├── src/
│   ├── App.tsx              # Main application component
│   ├── main.tsx             # React entry point
│   ├── index.css            # Global styles and Tailwind configuration
│   └── vite-env.d.ts        # Vite environment type definitions
├── index.html               # HTML entry point
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── postcss.config.js        # PostCSS configuration
├── package.json             # Project dependencies
└── README.md                # This file
```

## Component Architecture

### Main Components

- **JellyfishOceanWebsite**: Root component that orchestrates all sub-components
- **JellyfishScene**: Three.js canvas component with custom shader material and animations
- **FloatingParticles**: Background particle effect that responds to mouse movement
- **Navigation**: Top navigation bar with branding and links
- **HeroContent**: Hero section with animated headline and call-to-action buttons
- **Footer**: Footer with links and information

### Key Features

#### Custom Shader Material
The jellyfish uses a custom GLSL shader material that includes:
- Perlin noise-based vertex displacement
- Multiple wave layers for organic movement
- Fresnel effect for realistic lighting
- Mouse-reactive distortion
- Smooth animation interpolation

#### Interactive Behavior
- Mouse tracking updates shader uniforms in real-time
- Click detection triggers extra animation effects
- Particle effects attracted to mouse cursor
- Smooth rotation and scaling based on mouse position

## Styling System

The project uses Tailwind CSS v4 with custom theme variables defined in `src/index.css`:

### Color Variables
```css
--background    /* Main background color */
--foreground    /* Main text color */
--card          /* Card backgrounds */
--primary       /* Primary brand color */
--secondary     /* Secondary color */
--accent        /* Accent color */
--destructive   /* Error/danger color */
--border        /* Border color */
--ring          /* Focus ring color */
--chart-1/2/3/4/5  /* Chart colors */
```

### Tailwind Configuration

The `tailwind.config.js` includes:
- Extended color palette using CSS variables
- Custom border radius scale
- Support for dark mode via CSS class selector
- All generated classes include CSS variable fallbacks

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance Optimization

- Lazy loading with Suspense for Three.js scene
- Efficient particle rendering using CSS animations
- Optimized shader uniforms using ref-based updates
- Minimal re-renders through proper React hooks usage
- Tailwind CSS purging unused styles in production

## Development

### Hot Module Replacement
The Vite config enables HMR for instant updates during development.

### Type Checking
TypeScript is configured with strict mode for maximum type safety.

### ESLint Configuration
You can add ESLint configuration for code quality:
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Customization

### Changing Colors
Edit the CSS variables in `src/index.css` to customize the jellyfish colors and theme.

### Adjusting Animation Speed
Modify the `useFrame` hook in `App.tsx` to change animation timings and intensities.

### Customizing Particles
Adjust the particle count and animation parameters in the `FloatingParticles` component.

### Modifying Shader
Update the vertex and fragment shader strings in `JellyfishMaterial` for different visual effects.

## License

MIT License - Feel free to use this project for personal and commercial purposes.

## Credits

Created with the help of modern web technologies and best practices for interactive 3D web experiences.
