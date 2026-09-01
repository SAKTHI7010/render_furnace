import * as THREE from 'three';

// ────────────────────────────────────────────────────────────────
//  SmartMelt Studio — Realistic Induction Furnace 3D Renderer
//  Features:
//   • Steel body with water-cooled panel segments
//   • Thick copper bus bars + power cable bundle
//   • Induction coil wound from square-section copper tube
//   • Refractory lining (inner visible cross-section)
//   • Animated molten steel + slag pool
//   • Levitating particle sparks from the melt surface
//   • Hydraulic tilt cradle with pivot arms
//   • Pouring spout with animated molten stream on tap
// ────────────────────────────────────────────────────────────────

const MOLTEN_HOT = new THREE.Color(0xffe060);
const MOLTEN_COLD = new THREE.Color(0xb02200);
const SLAG_COLOR  = new THREE.Color(0x887755);
const STEEL_DARK  = new THREE.Color(0x1e2830);

function lerp3(a, b, t) { return a.clone().lerp(b, t); }

// Simple spark particle system
class SparkSystem {
  constructor(scene) {
    this.sparks = [];
    this.mat = new THREE.PointsMaterial({
      color: 0xffee88, size: 0.028, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.positions = new Float32Array(120 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(this.geo, this.mat);
    scene.add(this.points);
    this.active = 0;
  }

  emit(x, y, z, count = 3) {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= 120) this.sparks.shift();
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y: y,
        z: z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 0.018,
        vy: Math.random() * 0.022 + 0.01,
        vz: (Math.random() - 0.5) * 0.018,
        life: 1.0
      });
    }
  }

  update(intensity = 0) {
    const n = Math.floor(intensity * 5);
    for (let i = 0; i < n; i++) this.emit(0, 0.1, 0, 1);
    this.sparks.forEach(s => {
      s.x += s.vx; s.y += s.vy; s.z += s.vz;
      s.vy -= 0.0008;
      s.life -= 0.035;
    });
    this.sparks = this.sparks.filter(s => s.life > 0);
    this.active = this.sparks.length;
    const pos = this.positions;
    for (let i = 0; i < 120; i++) {
      if (i < this.sparks.length) {
        pos[i * 3]     = this.sparks[i].x;
        pos[i * 3 + 1] = this.sparks[i].y;
        pos[i * 3 + 2] = this.sparks[i].z;
      } else {
        pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = -999;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mat.opacity = Math.min(0.95, 0.3 + intensity * 0.7);
  }
}

export class FurnaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this._meltedPct = 0;
    this._bathTemp  = 1000;
    this._slagKg    = 0;
    this._tapped    = false;
    this._init();
    this._animate();
  }

  _init() {
    const c = this.canvas;
    const W = c.clientWidth  || 340;
    const H = c.clientHeight || 340;

    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08090e);
    this.scene.fog = new THREE.FogExp2(0x08090e, 0.08);

    // Camera — slightly angled from front-right
    this.camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 80);
    this.camera.position.set(5.0, 3.5, 5.0);
    this.camera.lookAt(0, 0.2, 0);

    this._buildLights();
    this._buildScene();

    this.sparks = new SparkSystem(this.scene);
    this.rotY = 0;
    this._t   = 0;

    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(c);
  }

  _buildLights() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0x1a2233, 1.2));

    // Key light — top
    const key = new THREE.DirectionalLight(0xfff0d8, 1.2);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key);

    // Fill — cool blue left
    const fill = new THREE.DirectionalLight(0x3a6090, 0.5);
    fill.position.set(-5, 3, -2);
    s.add(fill);

    // Molten steel glow — point light inside furnace
    this.innerGlow = new THREE.PointLight(0xff6a00, 2.0, 5.0);
    this.innerGlow.position.set(0, -0.2, 0);
    s.add(this.innerGlow);

    // Spout pour glow
    this.pourGlow = new THREE.PointLight(0xff9900, 0.0, 3.0);
    this.pourGlow.position.set(1.5, -0.5, 0);
    s.add(this.pourGlow);
  }

  _mat(opts) {
    return new THREE.MeshStandardMaterial(opts);
  }

  _buildScene() {
    const s = this.scene;

    // ── Ground reflection plane ──────────────────────────────────
    const gndMat = this._mat({ color: 0x0d1117, roughness: 0.9, metalness: 0.3 });
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), gndMat);
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = -2.0;
    gnd.receiveShadow = true;
    s.add(gnd);

    // ── Cradle / tilt frame ──────────────────────────────────────
    this.cradleGroup = new THREE.Group();
    s.add(this.cradleGroup);

    // Cradle arms (two I-beam style rectangles)
    const armMat = this._mat({ color: 0x263040, roughness: 0.7, metalness: 0.6 });
    [-0.8, 0.8].forEach(z => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.14), armMat);
      arm.position.set(0.2, -1.55, z);
      arm.castShadow = true;
      this.cradleGroup.add(arm);
      // Upright
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), armMat);
      up.position.set(-1.2, -1.15, z);
      this.cradleGroup.add(up);
    });
    // Cross brace
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.8), armMat);
    brace.position.set(0.2, -1.55, 0);
    this.cradleGroup.add(brace);

    // ── Furnace pivot group (tilts when tapped) ──────────────────
    this.furnaceGroup = new THREE.Group();
    this.cradleGroup.add(this.furnaceGroup);

    this._buildFurnaceBody();
    this._buildCoilAndBusBars();
    this._buildMeltPool();
    this._buildSpout();
  }

  _buildFurnaceBody() {
    const g = this.furnaceGroup;

    // Outer steel shell — slightly tapered
    const shellMat = this._mat({ color: 0x263545, roughness: 0.55, metalness: 0.75 });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.08, 2.3, 64, 1, true), shellMat);
    shell.castShadow = true;
    g.add(shell);

    // Steel bottom plate
    const botMat = this._mat({ color: 0x1e2c38, roughness: 0.6, metalness: 0.8 });
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.12, 64), botMat);
    bot.position.y = -1.21;
    bot.castShadow = true;
    g.add(bot);

    // Top rim lip
    const rimMat = this._mat({ color: 0x1a2430, roughness: 0.5, metalness: 0.85 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 10, 64), rimMat);
    rim.position.y = 1.15;
    rim.castShadow = true;
    g.add(rim);

    // Refractory lining — visible inside ring at top open face
    const refMat = this._mat({ color: 0x7a5a40, roughness: 0.95, metalness: 0.0, side: THREE.BackSide });
    const ref = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.94, 2.28, 48, 1, true), refMat);
    g.add(ref);

    // Water panel weld seam bands (6 horizontal bands on shell)
    const weldMat = this._mat({ color: 0x344a5a, roughness: 0.5, metalness: 0.9 });
    for (let i = 0; i < 6; i++) {
      const y = -1.0 + i * 0.4;
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.055, 0.018, 4, 64), weldMat);
      band.position.y = y;
      g.add(band);
    }

    // Trunnion pins (pivot axle stubs left & right)
    const pinMat = this._mat({ color: 0x3a4e60, roughness: 0.4, metalness: 0.9 });
    [-1, 1].forEach(side => {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 20), pinMat);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(side * 1.35, 0, 0);
      g.add(pin);
    });
  }

  _buildCoilAndBusBars() {
    const g = this.furnaceGroup;

    // Square-tube coil (CylinderGeometry approximation around shell)
    const coilMat = this._mat({ color: 0xb87333, roughness: 0.25, metalness: 0.9,
      emissive: 0x2a0c00, emissiveIntensity: 0.3 });
    const turns = 12;
    for (let i = 0; i < turns; i++) {
      const y = -0.95 + (i / (turns - 1)) * 1.88;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.04, 8, 64), coilMat);
      coil.position.y = y;
      g.add(coil);
    }

    // Bus bars — two thick copper bars on the right side
    const busMat = this._mat({ color: 0xc88030, roughness: 0.2, metalness: 0.95 });
    [0.12, -0.12].forEach(z => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.06), busMat);
      bar.position.set(1.4, 0, z);
      g.add(bar);
    });

    // Power cable bundle — thick cylinder going downward from bus bar
    const cableMat = this._mat({ color: 0x222222, roughness: 0.9, metalness: 0.1 });
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.2, 12), cableMat);
    cable.position.set(1.5, -1.8, 0);
    cable.rotation.z = 0.18;
    g.add(cable);

    // Hydraulic cylinder (tilt actuator)
    const cylMat = this._mat({ color: 0x506070, roughness: 0.4, metalness: 0.8 });
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 16), cylMat);
    hyd.position.set(-0.7, -1.3, 0.7);
    hyd.rotation.z = -0.4;
    g.add(hyd);
    // piston rod
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 12), this._mat({ color: 0x8ab0c0, roughness: 0.2, metalness: 0.95 }));
    rod.position.set(-0.55, -0.8, 0.7);
    rod.rotation.z = -0.4;
    g.add(rod);
  }

  _buildMeltPool() {
    const g = this.furnaceGroup;

    // Molten steel surface
    const liqMat = this._mat({
      color: MOLTEN_COLD.clone(), emissive: MOLTEN_COLD.clone(),
      emissiveIntensity: 0.8, roughness: 0.05, metalness: 0.9
    });
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.04, 48), liqMat);
    this.liquid.position.y = -1.08;
    g.add(this.liquid);
    this.liqMat = liqMat;

    // Slag cap on top of liquid
    const slagMat = this._mat({ color: SLAG_COLOR, roughness: 0.85, metalness: 0.0 });
    this.slag = new THREE.Mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.04, 48), slagMat);
    this.slag.position.y = -1.04;
    g.add(this.slag);

    // Solid scrap pile
    const scrapMat = this._mat({ color: 0x4a5a68, roughness: 0.95, metalness: 0.6 });
    this.scrap = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.86, 1.4, 24), scrapMat);
    this.scrap.position.y = 0;
    g.add(this.scrap);

    // Scrap surface boulders (icosahedron chunks)
    this.chunkGroup = new THREE.Group();
    const chunkMat = this._mat({ color: 0x3c4c58, roughness: 0.97, metalness: 0.55 });
    for (let i = 0; i < 14; i++) {
      const r = 0.3 + Math.random() * 0.38;
      const a = Math.random() * Math.PI * 2;
      const chunk = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.1, 0),
        chunkMat
      );
      chunk.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.chunkGroup.add(chunk);
    }
    g.add(this.chunkGroup);
  }

  _buildSpout() {
    const g = this.furnaceGroup;
    const spoutMat = this._mat({ color: 0x1e2830, roughness: 0.7, metalness: 0.4 });

    // Main spout body — tapered nozzle pointing right-downward
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.6, 20), spoutMat);
    spout.position.set(1.06, -0.45, 0);
    spout.rotation.z = Math.PI / 2.1;
    g.add(spout);

    // Spout flange ring
    const flange = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 24), spoutMat);
    flange.position.set(0.95, -0.52, 0);
    flange.rotation.z = Math.PI / 2;
    g.add(flange);

    // Animated pour stream (thin cylinder from spout tip)
    const pourMat = this._mat({
      color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 2.0,
      roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.0
    });
    this.pourStream = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.9, 12), pourMat);
    this.pourStream.position.set(1.65, -1.1, 0);
    this.pourStream.rotation.z = 0.35;
    g.add(this.pourStream);
    this.pourMat = pourMat;
  }

  update(meltedPct = 0, bathTempC = 1000, slagKg = 0, undissolvedKg = 0, chargeT = 12, aimC = 1620) {
    this._meltedPct = Math.max(0, Math.min(100, meltedPct || 0));
    this._bathTemp  = bathTempC || 1000;
    this._slagKg    = slagKg || 0;
    const pct       = this._meltedPct / 100;
    const heatFrac  = Math.max(0, Math.min(1, (bathTempC - 700) / (aimC - 700)));

    // ── Liquid pool height ───────────────────────────────────────
    const liqH = Math.max(0.04, pct * 1.85);
    const liqY = -1.1 + liqH / 2;

    this.liquid.geometry.dispose();
    this.liquid.geometry = new THREE.CylinderGeometry(0.88, 0.88, liqH, 48);
    this.liquid.position.y = liqY;

    // Liquid colour: blood red → orange → bright gold
    const liqC = lerp3(MOLTEN_COLD, MOLTEN_HOT, heatFrac);
    this.liqMat.color.copy(liqC);
    this.liqMat.emissive.copy(liqC).multiplyScalar(0.5);
    this.liqMat.emissiveIntensity = 0.5 + heatFrac * 1.5;

    // ── Slag layer ───────────────────────────────────────────────
    const slagH = this._slagKg > 0 ? Math.min(0.2, 0.04 + this._slagKg / 9000) : 0.04;
    this.slag.geometry.dispose();
    this.slag.geometry = new THREE.CylinderGeometry(0.87, 0.87, slagH, 48);
    this.slag.position.y = liqY + liqH / 2 + slagH / 2;
    this.slag.visible = this._slagKg > 10;

    // ── Solid scrap pile ─────────────────────────────────────────
    const scrapH = Math.max(0, (1 - pct) * 1.6 + 0.04);
    this.scrap.geometry.dispose();
    this.scrap.geometry = new THREE.CylinderGeometry(0.68 * (1 - 0.35 * pct), 0.85, Math.max(0.01, scrapH), 24);
    this.scrap.position.y = liqY + liqH / 2 + scrapH / 2;
    this.scrap.visible = scrapH > 0.1;
    this.chunkGroup.position.y = this.scrap.position.y + scrapH / 2 - 0.05;
    this.chunkGroup.visible = scrapH > 0.15;

    // ── Lights ───────────────────────────────────────────────────
    this.innerGlow.intensity = 1.0 + heatFrac * 5.0;
    this.innerGlow.color.copy(liqC);
    this.innerGlow.position.y = liqY + liqH * 0.3;
    this.innerGlow.distance = 3.5 + pct * 2.0;

    // ── Sparks from melt surface ─────────────────────────────────
    const sparkIntensity = heatFrac * pct;
    this.sparks.points.position.copy(this.furnaceGroup.position);
    this.sparks.update(sparkIntensity);

    // ── Pour stream when fully tapped ────────────────────────────
    const tapped = meltedPct >= 99 && bathTempC >= aimC - 20;
    this.pourMat.opacity = tapped ? 0.85 : 0;
    this.pourGlow.intensity = tapped ? 3.5 : 0;
    if (tapped) {
      this.pourMat.emissiveIntensity = 1.5 + Math.sin(this._t * 6) * 0.5;
    }

    // ── Furnace tilt (subtle lean toward spout when near tap) ────
    const tiltAngle = pct > 0.9 ? (pct - 0.9) * 0.15 : 0;
    this.furnaceGroup.rotation.z = tiltAngle;
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._t += 0.016;

    // Slow gentle auto-rotation
    this.rotY += 0.004;
    this.cradleGroup.rotation.y = this.rotY;

    // Animate inner glow flicker
    if (this.innerGlow) {
      this.innerGlow.intensity *= 0.97;
      this.innerGlow.intensity += (1.2 + this._meltedPct / 100 * 3.5) * 0.03;
    }

    // Ripple the liquid surface slightly
    if (this.liquid && this._meltedPct > 5) {
      const ripple = Math.sin(this._t * 3.2) * 0.003;
      this.liquid.rotation.y += ripple;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (!W || !H) return;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H, false);
  }
}
