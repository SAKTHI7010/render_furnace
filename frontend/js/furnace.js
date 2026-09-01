import * as THREE from 'three';

export class FurnaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this._init();
    this._animate();
  }

  _init() {
    const c = this.canvas;
    const W = c.clientWidth  || 480;
    const H = c.clientHeight || 480;

    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: false });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c10);
    // Subtle grid floor
    const grid = new THREE.GridHelper(12, 24, 0x1a2230, 0x111820);
    grid.position.y = -2.0;
    this.scene.add(grid);

    // Camera — angled front view like the reference
    this.camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 60);
    this.camera.position.set(0, 1.2, 7.5);
    this.camera.lookAt(0, 0, 0);

    // ── Lighting ──────────────────────────────────────
    // Ambient base
    this.scene.add(new THREE.AmbientLight(0x102030, 1.5));

    // Main molten glow (inner point light — very bright orange)
    this.moltenLight = new THREE.PointLight(0xff7020, 8.0, 8.0);
    this.moltenLight.position.set(0, 0.3, 0);
    this.moltenLight.castShadow = true;
    this.scene.add(this.moltenLight);

    // Secondary warm rim light (top)
    this.rimLight = new THREE.PointLight(0xffaa40, 3.0, 10);
    this.rimLight.position.set(0, 3, 0);
    this.scene.add(this.rimLight);

    // Cool fill from front
    this.scene.add(new THREE.DirectionalLight(0x304060, 0.6)).position?.set(3, 4, 6);

    this._buildFurnace();

    this.rotY = 0;

    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(c);
  }

  _buildFurnace() {
    const scene = this.scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // ── Outer refractory shell ────────────────────────
    // Slightly flared at bottom like real furnace
    const shellMat = new THREE.MeshStandardMaterial({
      color:     0x1e1208,
      roughness: 0.85,
      metalness: 0.12,
    });
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.65, 3.2, 64, 1, true),
      shellMat
    );
    this.group.add(shell);

    // Bottom cap
    const botCap = new THREE.Mesh(new THREE.CircleGeometry(1.65, 64), shellMat);
    botCap.rotation.x = -Math.PI / 2;
    botCap.position.y = -1.6;
    this.group.add(botCap);

    // ── Induction coil rings ──────────────────────────
    // Thick copper rings — matches the reference image
    const coilMat = new THREE.MeshStandardMaterial({
      color:            0xb06820,
      roughness:        0.22,
      metalness:        0.92,
      emissive:         new THREE.Color(0x3a1500),
      emissiveIntensity: 0.3,
    });
    const TURNS  = 14;
    const COIL_R = 1.70;   // slightly outside shell
    const TUBE_R = 0.088;  // tube thickness
    for (let i = 0; i < TURNS; i++) {
      const y = -1.45 + (i / (TURNS - 1)) * 2.9;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(COIL_R, TUBE_R, 12, 64),
        coilMat
      );
      ring.position.y = y;
      this.group.add(ring);
    }

    // ── Inner refractory lining (visible at top opening) ──
    const liningMat = new THREE.MeshStandardMaterial({
      color: 0x5a3a22, roughness: 0.95, metalness: 0.0
    });
    const lining = new THREE.Mesh(
      new THREE.CylinderGeometry(1.38, 1.42, 3.1, 48, 1, true),
      liningMat
    );
    this.group.add(lining);

    // ── Liquid steel pool ─────────────────────────────
    this.liquidMat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(0xff6020),
      emissive:          new THREE.Color(0xff4000),
      emissiveIntensity: 2.0,
      roughness:         0.05,
      metalness:         0.85,
    });
    this.liquidMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.02, 64),
      this.liquidMat
    );
    this.liquidMesh.position.y = -1.58;
    this.group.add(this.liquidMesh);

    // ── Slag layer ────────────────────────────────────
    this.slagMat = new THREE.MeshStandardMaterial({
      color: 0x8c7040, roughness: 0.9, metalness: 0.0,
      emissive: new THREE.Color(0x3a2000), emissiveIntensity: 0.2,
    });
    this.slagMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.02, 48),
      this.slagMat
    );
    this.slagMesh.position.y = -1.56;
    this.group.add(this.slagMesh);

    // ── Solid scrap pile ──────────────────────────────
    this.scrapMat = new THREE.MeshStandardMaterial({
      color: 0x4a5a68, roughness: 0.96, metalness: 0.55
    });
    this.scrapMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.3, 0.2, 32),
      this.scrapMat
    );
    this.group.add(this.scrapMesh);

    // ── Top rim (thick steel collar) ─────────────────
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x2a1e10, roughness: 0.65, metalness: 0.45
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.12, 10, 64),
      rimMat
    );
    rim.position.y = 1.6;
    this.group.add(rim);

    // ── Tap spout ─────────────────────────────────────
    const spoutMat = new THREE.MeshStandardMaterial({
      color: 0x1a1008, roughness: 0.8, metalness: 0.3
    });
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.20, 0.6, 16),
      spoutMat
    );
    spout.rotation.z = Math.PI / 2.2;
    spout.position.set(1.7, -0.8, 0);
    this.group.add(spout);

    // ── Volumetric glow sphere (heat-responsive) ──────
    this.glowMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 24, 24),
      new THREE.MeshStandardMaterial({
        color:             new THREE.Color(0xff5000),
        emissive:          new THREE.Color(0xff5000),
        emissiveIntensity: 0.0,
        transparent:       true,
        opacity:           0.0,
        side:              THREE.BackSide,
        depthWrite:        false,
      })
    );
    this.glowMesh.position.y = -0.2;
    this.group.add(this.glowMesh);

    // ── Lens flare sprites (fake bloom dots) ──────────
    this._flares = [];
    for (let i = 0; i < 4; i++) {
      const geo  = new THREE.PlaneGeometry(0.22, 0.22);
      const mat  = new THREE.MeshBasicMaterial({
        color: 0xffd080, transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const fl = new THREE.Mesh(geo, mat);
      const ang = (i / 4) * Math.PI * 2;
      fl.position.set(Math.cos(ang) * 0.45, 1.62 + Math.sin(ang * 1.3) * 0.05, Math.sin(ang) * 0.45);
      fl.lookAt(this.camera.position);
      this.group.add(fl);
      this._flares.push(fl);
    }
  }

  update(meltedPct = 0, bathTempC = 1000, slagKg = 0, _undissolvedKg = 0, _chargeT = 12, aimC = 1620) {
    const pct      = Math.max(0, Math.min(100, meltedPct || 0)) / 100;
    const T        = bathTempC || 1000;
    const heatFrac = Math.max(0, Math.min(1, (T - 600) / (aimC - 600)));

    // ── Liquid height ─────────────────────────────────
    const liqH = Math.max(0.04, pct * 3.0);           // max ~3 units tall
    const liqY = -1.6 + liqH / 2;

    this.liquidMesh.geometry.dispose();
    this.liquidMesh.geometry = new THREE.CylinderGeometry(1.35, 1.35, liqH, 64);
    this.liquidMesh.position.y = liqY;

    // ── Slag ─────────────────────────────────────────
    const slagH = slagKg > 0 ? Math.min(0.2, 0.05 + slagKg / 6000) : 0.04;
    this.slagMesh.geometry.dispose();
    this.slagMesh.geometry = new THREE.CylinderGeometry(1.35, 1.35, slagH, 48);
    this.slagMesh.position.y = liqY + liqH / 2 + slagH / 2;

    // ── Scrap ─────────────────────────────────────────
    const scrapH = Math.max(0, (1 - pct) * 2.5 + 0.05);
    this.scrapMesh.geometry.dispose();
    this.scrapMesh.geometry = new THREE.CylinderGeometry(
      1.0 * (1 - 0.25 * pct), 1.3, scrapH, 32
    );
    this.scrapMesh.position.y = this.slagMesh.position.y + slagH / 2 + scrapH / 2;
    this.scrapMesh.visible = scrapH > 0.1;

    // ── Liquid colour: dark-red → orange → bright-yellow ──
    const liqHue = 0.04 - heatFrac * 0.038;  // red→warm-yellow
    const liqLit = 0.22 + heatFrac * 0.32;
    const liqCol = new THREE.Color().setHSL(liqHue, 1.0, liqLit);
    this.liquidMat.color.copy(liqCol);
    this.liquidMat.emissive.copy(liqCol);
    this.liquidMat.emissiveIntensity = 1.2 + heatFrac * 1.8;

    // ── Glow sphere ───────────────────────────────────
    const gi = heatFrac * 0.65;
    this.glowMesh.material.emissiveIntensity = gi;
    this.glowMesh.material.opacity           = gi * 0.22;
    this.glowMesh.position.y = liqY + 0.1;

    // ── Lens flares (bloom at top opening when very hot) ──
    const flareOpacity = Math.max(0, (heatFrac - 0.55) * 2.2);
    this._flares.forEach((fl, i) => {
      fl.material.opacity = flareOpacity * (0.6 + 0.4 * Math.sin(Date.now() / 700 + i));
    });

    // ── Point light ───────────────────────────────────
    this.moltenLight.intensity = 3.0 + heatFrac * 9.0;
    this.moltenLight.color.setHSL(liqHue, 1.0, 0.58);
    this.moltenLight.position.y = liqY + liqH * 0.3;

    this.rimLight.intensity = heatFrac * 4.0;
    this.rimLight.color.setHSL(liqHue + 0.01, 1.0, 0.6);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    // Slow auto-rotation
    this.rotY += 0.0035;
    this.group.rotation.y = this.rotY;
    // Keep flares facing camera
    this._flares?.forEach(fl => fl.lookAt(this.camera.position));
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
