import * as THREE from 'three';

export class FurnaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this._init();
    this._animate();
  }

  _init() {
    const c = this.canvas;
    const W = c.clientWidth || 320;
    const H = c.clientHeight || 320;

    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e12);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    this.camera.position.set(3.5, 2.8, 3.5);
    this.camera.lookAt(0, 0.3, 0);

    // Lights
    const amb = new THREE.AmbientLight(0x223344, 0.8);
    this.scene.add(amb);
    this.pointLight = new THREE.PointLight(0xff6a34, 3.0, 6);
    this.pointLight.position.set(0, 0.5, 0);
    this.scene.add(this.pointLight);
    const dirLight = new THREE.DirectionalLight(0xffd166, 0.6);
    dirLight.position.set(4, 6, 4);
    this.scene.add(dirLight);

    this._buildFurnace();

    // Rotation state
    this.rotY = 0;

    // Resize observer
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(c);
  }

  _buildFurnace() {
    const scene = this.scene;

    // ── Outer shell (refractory casing) ──
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.9, metalness: 0.1 });
    const shellGeo = new THREE.CylinderGeometry(1.0, 1.05, 2.2, 48, 1, true);
    this.shell = new THREE.Mesh(shellGeo, shellMat);
    scene.add(this.shell);

    // Bottom cap
    const botGeo = new THREE.CircleGeometry(1.05, 48);
    const bot    = new THREE.Mesh(botGeo, shellMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.y = -1.1;
    scene.add(bot);

    // ── Copper induction coil ──
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xc8802f, roughness: 0.3, metalness: 0.85, emissive: 0x3a1800, emissiveIntensity: 0.4 });
    const turns = 9;
    for (let i = 0; i < turns; i++) {
      const y      = -0.95 + (i / (turns - 1)) * 1.9;
      const coilGeo = new THREE.TorusGeometry(1.08, 0.045, 8, 48);
      const coil    = new THREE.Mesh(coilGeo, coilMat);
      coil.position.y = y;
      scene.add(coil);
    }

    // ── Liquid steel pool ──
    const liquidMat = new THREE.MeshStandardMaterial({
      color: 0xff6a34, emissive: 0xff3300, emissiveIntensity: 1.2,
      roughness: 0.15, metalness: 0.7
    });
    this.liquidGeo  = new THREE.CylinderGeometry(0.88, 0.88, 0.01, 48);
    this.liquid     = new THREE.Mesh(this.liquidGeo, liquidMat);
    this.liquid.position.y = -1.05;
    scene.add(this.liquid);

    // ── Slag layer ──
    const slagMat = new THREE.MeshStandardMaterial({ color: 0x7d6b48, roughness: 0.8, metalness: 0.0 });
    this.slagGeo  = new THREE.CylinderGeometry(0.88, 0.88, 0.01, 48);
    this.slag     = new THREE.Mesh(this.slagGeo, slagMat);
    this.slag.position.y = -1.04;
    scene.add(this.slag);

    // ── Solid scrap pile ──
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x546572, roughness: 0.95, metalness: 0.5 });
    this.scrapGeo  = new THREE.CylinderGeometry(0.78, 0.85, 0.1, 48);
    this.scrap     = new THREE.Mesh(this.scrapGeo, scrapMat);
    scene.add(this.scrap);

    // ── Glow sphere (simulates liquid heat glow through walls) ──
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.0,
      transparent: true, opacity: 0.0
    });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 16), glowMat);
    this.glow.position.y = -0.3;
    scene.add(this.glow);

    // ── Top rim ──
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.7, metalness: 0.3 });
    const rim    = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 48), rimMat);
    rim.position.y = 1.1;
    scene.add(rim);

    // ── Tap spout ──
    const spoutMat = new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.8, metalness: 0.2 });
    const spout    = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.5, 16), spoutMat);
    spout.rotation.z = Math.PI / 2.2;
    spout.position.set(1.1, -0.55, 0);
    scene.add(spout);

    // Group everything for rotation
    this.group = new THREE.Group();
    [this.shell, bot, this.liquid, this.slag, this.scrap, this.glow, rim, spout].forEach(m => {
      scene.remove(m); this.group.add(m);
    });
    for (let i = 0; i < turns; i++) {
      const c = scene.children.find(ch => ch.geometry?.type === 'TorusGeometry' && ch !== rim);
      if (c) { scene.remove(c); this.group.add(c); }
    }
    // Re-add all torus coils from scene
    const toRemove = [];
    scene.children.forEach(ch => {
      if (ch.isMesh && ch.geometry?.type === 'TorusGeometry') toRemove.push(ch);
    });
    toRemove.forEach(m => { scene.remove(m); this.group.add(m); });

    scene.add(this.group);
  }

  update(meltedPct = 0, bathTempC = 1000, slagKg = 0, undissolvedKg = 0, chargeT = 12, aimC = 1620) {
    const pct = Math.max(0, Math.min(100, meltedPct || 0)) / 100;
    const T   = bathTempC || 1000;

    // Liquid height: 0 at -1.1, max 1.8 at full melt
    const liqH   = Math.max(0.02, pct * 1.75);
    const liqY   = -1.1 + liqH / 2;

    // Rebuild liquid cylinder height
    this.group.remove(this.liquid);
    this.liquidGeo = new THREE.CylinderGeometry(0.88, 0.88, liqH, 48);
    this.liquid.geometry.dispose();
    this.liquid.geometry = this.liquidGeo;
    this.liquid.position.y = liqY;
    this.group.add(this.liquid);

    // Slag sits on top of liquid
    const slagH = slagKg > 0 ? Math.min(0.15, 0.05 + slagKg / 8000) : 0.04;
    this.slag.geometry.dispose();
    this.slag.geometry = new THREE.CylinderGeometry(0.88, 0.88, slagH, 48);
    this.slag.position.y = liqY + liqH / 2 + slagH / 2;

    // Scrap pile above slag (disappears as melt progresses)
    const scrapH = Math.max(0, (1 - pct) * 1.4 + 0.05);
    this.scrap.geometry.dispose();
    this.scrap.geometry = new THREE.CylinderGeometry(0.78 * (1 - 0.3 * pct), 0.85, scrapH, 48);
    this.scrap.position.y = this.slag.position.y + slagH / 2 + scrapH / 2;
    this.scrap.visible = scrapH > 0.08;

    // Glow intensity by temperature
    const heatFrac = Math.max(0, Math.min(1, (T - 800) / (aimC - 800)));
    const gi       = heatFrac * 0.6;
    this.glow.material.emissiveIntensity = gi;
    this.glow.material.opacity           = gi * 0.18;
    this.glow.position.y                 = liqY;
    this.pointLight.intensity = 1.5 + heatFrac * 3.0;
    this.pointLight.color.setHSL(0.04 - heatFrac * 0.04, 1.0, 0.55);
    this.pointLight.position.y = liqY + liqH * 0.4;

    // Liquid colour: dark red → orange → bright yellow at aim
    const liqColor = new THREE.Color().setHSL(0.04 - heatFrac * 0.035, 1.0, 0.28 + heatFrac * 0.25);
    this.liquid.material.color.copy(liqColor);
    this.liquid.material.emissive.copy(liqColor).multiplyScalar(0.6);
    this.liquid.material.emissiveIntensity = 0.5 + heatFrac * 0.9;
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.rotY += 0.006;
    if (this.group) this.group.rotation.y = this.rotY;
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
