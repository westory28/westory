import * as THREE from "three";

export interface YutThrowState {
  throwKey: string | null;
  sticks: boolean[] | null;
  rolling: boolean;
}

const TAU = Math.PI * 2;
const DURATION = 2.25;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const layout = [
  { x: -1.25, z: -0.22, yaw: -0.22 },
  { x: -0.42, z: 0.34, yaw: 0.16 },
  { x: 0.43, z: -0.25, yaw: -0.14 },
  { x: 1.26, z: 0.28, yaw: 0.22 },
];

/** Testable final orientation: local flat-face normal (0,-1,0) becomes +Y. */
export function finalYutRotation(flat: boolean, index: number) {
  return new THREE.Euler(0, layout[index].yaw, flat ? Math.PI : 0, "YXZ");
}

function woodTexture(flat: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas texture unavailable");
  context.fillStyle = flat ? "#dfbe83" : "#b78956";
  context.fillRect(0, 0, 256, 1024);
  // Deterministic original wood grain. No fetched images or game assets.
  for (let line = 0; line < 120; line++) {
    const x = (line * 41.73) % 256;
    context.strokeStyle =
      line % 3 ? "rgba(61,31,10,.10)" : "rgba(255,233,177,.18)";
    context.lineWidth = line % 5 ? 0.7 : 2.1;
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 32; y <= 1024; y += 32)
      context.lineTo(x + Math.sin(y * 0.008 + line) * (2 + (line % 8)), y);
    context.stroke();
  }
  if (flat) {
    context.strokeStyle = "#392416";
    context.lineWidth = 16;
    context.lineCap = "round";
    for (const y of [235, 512, 789]) {
      context.beginPath();
      context.moveTo(75, y - 46);
      context.lineTo(181, y + 46);
      context.moveTo(181, y - 46);
      context.lineTo(75, y + 46);
      context.stroke();
    }
    context.strokeStyle = "rgba(62,34,16,.5)";
    context.lineWidth = 3;
    context.strokeRect(20, 42, 216, 940);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A real beveled half-cylinder; the flat face is at local negative Y. */
export function createYutGeometry() {
  const radius = 0.2,
    length = 1.72;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(radius, 0);
  shape.absarc(0, 0, radius, 0, Math.PI, false);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.018,
    bevelSegments: 3,
    curveSegments: 24,
    steps: 1,
  });
  geometry.translate(0, -radius / 2, -length / 2);
  return geometry;
}

export class YutThrowScene {
  private renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  private groups: THREE.Group[] = [];
  private trails: THREE.Line[] = [];
  private trailPoints: THREE.Vector3[][] = [];
  private dust: THREE.Points;
  private dustPositions = new Float32Array(96 * 3);
  private textures: THREE.Texture[] = [];
  private resizeObserver: ResizeObserver;
  private media = window.matchMedia("(prefers-reduced-motion: reduce)");
  private frame = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private running = false;
  private disposed = false;
  private rolling = false;
  private key: string | null = null;
  private ignoredKey: string | null = null;
  private result: boolean[] | null = null;
  private didComplete = false;
  private broken = false;
  private state: YutThrowState = {
    throwKey: null,
    sticks: null,
    rolling: false,
  };

  constructor(
    private host: HTMLDivElement,
    private seen: Set<string>,
    private onComplete: () => void,
    private onFallback: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, host.clientWidth < 600 ? 1.5 : 2),
    );
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 6.2, 6.8);
    this.camera.lookAt(0, 0.75, 0);
    this.world.add(new THREE.HemisphereLight(0xfff1d6, 0x233849, 2.3));
    const key = new THREE.DirectionalLight(0xfff2dc, 3.4);
    key.position.set(-2, 8, 3);
    key.castShadow = true;
    const shadowSize = host.clientWidth < 600 ? 512 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 3;
    this.world.add(key);
    const rim = new THREE.DirectionalLight(0xc3e4ff, 2);
    rim.position.set(3, 4, -3);
    this.world.add(rim);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    this.world.add(floor);

    const grain = woodTexture(false),
      marked = woodTexture(true);
    this.textures.push(grain, marked);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      map: grain,
      color: 0xffffff,
      roughness: 0.57,
      metalness: 0,
    });
    const capMaterial = new THREE.MeshStandardMaterial({
      color: 0xcead7c,
      roughness: 0.72,
    });
    const flatMaterial = new THREE.MeshStandardMaterial({
      map: marked,
      roughness: 0.72,
      metalness: 0,
    });
    const bodyGeometry = createYutGeometry();
    const flatGeometry = new THREE.PlaneGeometry(0.375, 1.69);
    for (let index = 0; index < 4; index++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, [capMaterial, bodyMaterial]);
      body.castShadow = true;
      body.receiveShadow = true;
      const face = new THREE.Mesh(flatGeometry, flatMaterial);
      face.rotation.x = Math.PI / 2;
      // The bevel extends 0.018 below the flat face; keep its marking outside.
      face.position.y = -0.119;
      group.add(body, face);
      this.groups.push(group);
      this.world.add(group);
      const geometry = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 18 }, () => new THREE.Vector3()),
      );
      const trail = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0xeac182,
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      trail.frustumCulled = false;
      this.trails.push(trail);
      this.trailPoints.push([]);
      this.world.add(trail);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.dustPositions, 3),
    );
    const particleCanvas = document.createElement("canvas");
    particleCanvas.width = particleCanvas.height = 32;
    const particleContext = particleCanvas.getContext("2d")!;
    const light = particleContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    light.addColorStop(0, "rgba(255,238,188,1)");
    light.addColorStop(0.2, "rgba(232,183,101,.7)");
    light.addColorStop(1, "rgba(216,160,75,0)");
    particleContext.fillStyle = light;
    particleContext.fillRect(0, 0, 32, 32);
    const particleMap = new THREE.CanvasTexture(particleCanvas);
    this.textures.push(particleMap);
    this.dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        map: particleMap,
        color: 0xf5d89c,
        size: 0.065,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.world.add(this.dust);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    document.addEventListener("visibilitychange", this.visibility);
    this.media.addEventListener("change", this.motionChanged);
    this.resize();
  }

  update(state: YutThrowState) {
    if (this.disposed) return;
    this.state = state;
    const valid = Boolean(
      state.throwKey &&
      state.sticks?.length === 4 &&
      state.sticks.every((value) => typeof value === "boolean"),
    );
    if (state.rolling && !this.rolling) {
      this.ignoredKey =
        this.key ||
        (state.throwKey && this.seen.has(state.throwKey)
          ? state.throwKey
          : null);
      this.begin();
    }
    const fresh =
      valid &&
      state.throwKey !== this.key &&
      state.throwKey !== this.ignoredKey;
    this.rolling = state.rolling;
    if (fresh && state.throwKey && state.sticks) {
      if (!this.running || this.result) this.begin();
      this.key = state.throwKey;
      this.result = [...state.sticks];
      this.didComplete = false;
      if (this.seen.has(state.throwKey) || this.media.matches || this.broken) {
        if (this.seen.has(state.throwKey)) this.didComplete = true;
        this.elapsed = DURATION;
        this.pose();
        this.render();
        this.complete();
      } else this.schedule();
    } else if (!state.rolling && !this.result && this.running) {
      // A rejected command must release the visual wait without inventing a roll.
      this.running = false;
      this.cancelFrame();
      this.renderer.clear();
      this.complete();
    }
  }

  private begin() {
    this.key = null;
    this.result = null;
    this.elapsed = 0;
    this.didComplete = false;
    this.running = true;
    this.trailPoints.forEach((points) => points.splice(0));
    this.lastFrame = 0;
    if (this.media.matches) {
      this.pose();
      this.render();
    }
    this.schedule();
  }

  private complete() {
    this.running = false;
    this.cancelFrame();
    if (this.key) {
      this.seen.add(this.key);
      if (this.seen.size > 24)
        this.seen.delete(this.seen.values().next().value!);
    }
    if (!this.didComplete) {
      this.didComplete = true;
      this.onComplete();
    }
  }

  private schedule() {
    if (
      !this.disposed &&
      !this.broken &&
      !this.media.matches &&
      !document.hidden &&
      this.running &&
      !this.frame
    )
      this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed || document.hidden || !this.running) return;
    const dt = this.lastFrame
      ? Math.min((now - this.lastFrame) / 1000, 0.05)
      : 0;
    this.lastFrame = now;
    // Wait at the apex until the server result arrives. Never guess final faces.
    this.elapsed = this.result
      ? this.elapsed + dt
      : Math.min(0.66, this.elapsed + dt);
    this.pose();
    this.render();
    if (this.elapsed >= DURATION && this.result) this.complete();
    else if (!this.result && this.elapsed >= 0.66) this.lastFrame = 0;
    else this.schedule();
  };

  private pose() {
    const time = this.elapsed;
    for (let index = 0; index < 4; index++) {
      const stick = this.groups[index],
        end = layout[index];
      const progress = clamp((time - index * 0.035) / 1.43);
      const flat = this.result?.[index] || false;
      const targetRoll = flat ? Math.PI : 0;
      if (time >= 1.43 + index * 0.035) {
        const bounce = clamp((time - 1.43 - index * 0.035) / 0.68);
        const envelope = Math.pow(1 - bounce, 3);
        stick.position.set(
          end.x,
          0.122 + Math.abs(Math.sin(bounce * Math.PI * 2.7)) * 0.27 * envelope,
          end.z,
        );
        stick.rotation.set(
          Math.sin(bounce * TAU) * 0.14 * envelope,
          end.yaw,
          targetRoll + Math.sin(bounce * TAU * 1.4) * 0.22 * envelope,
          "YXZ",
        );
        stick.scale.setScalar(1);
      } else {
        const arc = Math.sin(Math.PI * progress);
        stick.position.set(
          (index - 1.5) * 0.13 * (1 - progress) +
            end.x * progress +
            Math.sin(progress * Math.PI) * (index - 1.5) * 0.16,
          0.122 + 4 * progress * (1 - progress) * (2.3 + index * 0.09),
          1.7 * (1 - progress) + end.z * progress + arc * 0.7,
        );
        stick.scale.setScalar(1 + arc * 0.12);
        const rotationProgress = smooth(progress);
        stick.rotation.set(
          TAU * (2 + (index % 2)) * rotationProgress,
          end.yaw + TAU * rotationProgress,
          TAU * (3 + (index % 2)) * rotationProgress +
            targetRoll * smooth((progress - 0.55) / 0.45),
          "YXZ",
        );
      }
      const points = this.trailPoints[index];
      points.unshift(stick.position.clone());
      if (points.length > 18) points.pop();
      const attr = this.trails[index].geometry.getAttribute("position");
      for (let n = 0; n < 18; n++) {
        const p = points[Math.min(n, points.length - 1)];
        attr.setXYZ(n, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      this.trails[index].visible =
        !this.media.matches && time > 0.12 && time < 1.55;
      (this.trails[index].material as THREE.LineBasicMaterial).opacity =
        0.26 * Math.sin(progress * Math.PI);
    }
    const dustTime = clamp((time - 1.45) / 0.8);
    this.dust.visible = !this.media.matches && dustTime > 0 && dustTime < 1;
    for (let n = 0; n < 96; n++) {
      const origin = layout[n % 4],
        angle = n * 2.399;
      const speed = 0.3 + ((n * 17) % 31) / 25;
      this.dustPositions[n * 3] = origin.x + Math.cos(angle) * dustTime * speed;
      this.dustPositions[n * 3 + 1] =
        0.025 + Math.sin(dustTime * Math.PI) * (0.05 + (n % 5) * 0.035);
      this.dustPositions[n * 3 + 2] =
        origin.z + Math.sin(angle) * dustTime * speed;
    }
    this.dust.geometry.getAttribute("position").needsUpdate = true;
    (this.dust.material as THREE.PointsMaterial).opacity =
      0.72 * Math.pow(1 - dustTime, 1.6);
  }

  private render() {
    if (!this.disposed && !this.broken && !document.hidden)
      this.renderer.render(this.world, this.camera);
  }

  private resize = () => {
    if (this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  };

  private cancelFrame() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrame = 0;
  }
  private visibility = () => {
    if (document.hidden) this.cancelFrame();
    else {
      this.render();
      this.schedule();
    }
  };
  private motionChanged = () => {
    if (this.media.matches && this.result) {
      this.elapsed = DURATION;
      this.pose();
      this.render();
      this.complete();
    }
  };
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.broken = true;
    this.cancelFrame();
    this.onFallback();
    if (this.result) this.complete();
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.media.removeEventListener("change", this.motionChanged);
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.world.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((material) => materials.add(material));
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((item) => item.dispose());
    materials.forEach((item) => item.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
