// =====================================================================
// Pecifics — Three.js Jellyfish (exact replica of the website version)
// Requires three.min.js loaded before this script.
// =====================================================================
(function () {
    'use strict';

    const canvas = document.getElementById('jellyfishBg');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    if (typeof THREE === 'undefined') { console.error('[Jellyfish] three.min.js not loaded'); return; }

    // ─── Renderer ─────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(canvas.clientWidth || 240, canvas.clientHeight || 240, false);

    // ─── Scene / Camera ───────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 11);

    // ─── Shader (identical to website) ────────────────────────────
    const VERT = `
        uniform float uTime;
        uniform vec2  uMouse;
        uniform float uIntensity;
        varying vec3  vNormal;
        varying vec3  vPosition;
        varying float vDisplacement;

        vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
        vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
        vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
        vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
        float snoise(vec3 v){
            const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
            vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
            vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
            vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
            vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
            i=mod289v3(i);
            vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
            float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
            vec4 j=p-49.*floor(p*ns.z*ns.z);
            vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
            vec4 xv=x_*ns.x+ns.yyyy;vec4 yv=y_*ns.x+ns.yyyy;
            vec4 h=1.-abs(xv)-abs(yv);
            vec4 b0=vec4(xv.xy,yv.xy);vec4 b1=vec4(xv.zw,yv.zw);
            vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;
            vec4 sh=-step(h,vec4(0.));
            vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
            vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
            vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
            vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
            p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
            vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
            return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
        }
        void main(){
            vNormal=normalize(normalMatrix*normal);
            vPosition=position;
            float mouseDist=distance(position.xy,uMouse*3.5);
            float mouseInfluence=smoothstep(2.5,0.0,mouseDist)*uIntensity;
            float wave1=snoise(position*2.0+uTime*0.4)*0.4;
            float wave2=snoise(position*3.5-uTime*0.3)*0.2;
            float wave3=snoise(position*5.0+uTime*0.2)*0.1;
            float disp=wave1+wave2+wave3+mouseInfluence*1.2;
            vDisplacement=disp;
            vec3 newPos=position+normal*disp;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(newPos,1.0);
        }
    `;
    const FRAG = `
        uniform vec3  uColorA;
        uniform vec3  uColorB;
        uniform vec3  uColorC;
        uniform float uTime;
        varying vec3  vNormal;
        varying vec3  vPosition;
        varying float vDisplacement;
        void main(){
            vec3 viewDir=normalize(cameraPosition-vPosition);
            float fresnel=pow(1.0-abs(dot(vNormal,viewDir)),2.0);
            float gradient=vPosition.y*0.5+0.5;
            vec3 baseColor=mix(uColorA,uColorB,gradient+sin(uTime)*0.2);
            float pulse=sin(uTime*2.0)*0.5+0.5;
            vec3 coreColor=mix(baseColor,uColorC,pulse*0.4);
            vec3 glowColor=uColorA*(fresnel*0.6+clamp(vDisplacement,0.0,0.4)*0.5);
            vec3 finalColor=clamp(coreColor+glowColor,0.0,0.55);
            float alpha=0.45+fresnel*0.15;
            gl_FragColor=vec4(finalColor,alpha);
        }
    `;

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:      { value: 0 },
            uMouse:     { value: new THREE.Vector2(0, 0) },
            uIntensity: { value: 1.2 },
            uColorA:    { value: new THREE.Color('#0ea5e9') },
            uColorB:    { value: new THREE.Color('#1e3a8a') },
            uColorC:    { value: new THREE.Color('#2563eb') },
        },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });

    // ─── Geometry ─────────────────────────────────────────────────
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 64), mat));
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 4),
        new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    cage.scale.setScalar(1.1);
    group.add(cage);
    scene.add(group);

    // ─── Sparkles ─────────────────────────────────────────────────
    function sparkles(count, spread, size, color, opacity) {
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    }
    scene.add(sparkles(120, 12, 0.06, '#38bdf8', 0.4));
    scene.add(sparkles(80,  10, 0.04, '#1d4ed8', 0.3));
    scene.add(sparkles(60,  18, 0.04, '#7dd3fc', 0.25));

    // ─── Lights ───────────────────────────────────────────────────
    const pl1 = new THREE.PointLight('#38bdf8', 2.0, 20); pl1.position.set( 5,  5,  5); scene.add(pl1);
    const pl2 = new THREE.PointLight('#2563eb', 2.0, 20); pl2.position.set(-5, -5,  5); scene.add(pl2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // ─── Mouse / Click ────────────────────────────────────────────
    const targetMouse = new THREE.Vector2();
    const targetRot   = new THREE.Vector2();
    const currentRot  = new THREE.Vector2();
    let   targetIntensity = 1.2, clickTimer = null;

    window.addEventListener('mousemove', e => {
        targetMouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
        targetMouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
        targetRot.set(targetMouse.y * 0.8, targetMouse.x * 0.8);
    });
    window.addEventListener('click', () => {
        targetIntensity = 1.8;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { targetIntensity = 1.2; }, 800);
    });

    // ─── Resize ───────────────────────────────────────────────────
    function resize() {
        const w = canvas.clientWidth  || 240;
        const h = canvas.clientHeight || 240;
        if (renderer.domElement.width  !== w * (window.devicePixelRatio||1) ||
            renderer.domElement.height !== h * (window.devicePixelRatio||1)) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // ─── Animation loop ───────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = null;

    function animate() {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();

        mat.uniforms.uMouse.value.lerp(targetMouse, 0.08);
        mat.uniforms.uTime.value = t;
        mat.uniforms.uIntensity.value += (targetIntensity - mat.uniforms.uIntensity.value) * 0.1;

        currentRot.x += (targetRot.x - currentRot.x) * 0.05;
        currentRot.y += (targetRot.y - currentRot.y) * 0.05;

        group.rotation.x = currentRot.x + Math.sin(t * 0.5) * 0.1;
        group.rotation.y = currentRot.y + t * 0.1;

        const s = (1 + Math.sin(t * 1.5) * 0.05) * (targetIntensity > 1.2 ? 1.1 : 1.0);
        group.scale.lerp(new THREE.Vector3(s, s, s), 0.1);

        resize();
        renderer.render(scene, camera);
    }

    const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { if (!raf) animate(); }
        else { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    }, { threshold: 0.1 });
    observer.observe(canvas);

    window.addEventListener('beforeunload', () => {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect(); observer.disconnect(); renderer.dispose();
    });
})();
