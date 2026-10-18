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

let atlasPromise: Promise<HTMLImageElement> | undefined;
function loadWoodAtlas() {
  return (atlasPromise ||= new Promise((resolve, reject) => {
    const atlas = new Image();
    atlas.onload = () => resolve(atlas);
    atlas.onerror = reject;
    atlas.src = `${import.meta.env.BASE_URL}assets/weplay/yut/materials.webp`;
  }));
}

function woodTextures(
  flat: boolean,
  endGrain = false,
  atlas?: HTMLImageElement,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = endGrain ? 256 : 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas texture unavailable");
  const height = canvas.height;
  const grain = context.createImageData(256, height);
  // A fixed seed keeps the carved cypress surface reproducible on every client.
  let seed = flat ? 173 : endGrain ? 811 : 431;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 256; x++) {
      const wavyX = x + Math.sin(y * 0.011) * 4 + Math.sin(y * 0.027) * 1.6;
      const ring = endGrain
        ? Math.sin(Math.hypot(x - 116, (y - 310) * 1.3) * 0.2)
        : Math.sin(wavyX * 0.58) * 0.55 + Math.sin(wavyX * 0.17) * 0.45;
      const pore = random();
      const variation =
        ring * 15 + (random() - 0.5) * 16 - (pore < 0.025 ? 30 : 0);
      const offset = (y * 256 + x) * 4;
      const base = flat
        ? [190, 151, 95]
        : endGrain
          ? [166, 125, 74]
          : [160, 117, 65];
      grain.data[offset] = base[0] + variation;
      grain.data[offset + 1] = base[1] + variation * 0.8;
      grain.data[offset + 2] = base[2] + variation * 0.58;
      grain.data[offset + 3] = 255;
    }
  }
  context.putImageData(grain, 0, 0);
  if (atlas && !endGrain) {
    // Use the original painted wood quadrant; retain cut end-grain and engraved marks.
    context.filter = flat
      ? "saturate(.52) brightness(1.26)"
      : "saturate(.62) brightness(1.08)";
    context.drawImage(
      atlas,
      0,
      0,
      atlas.width / 2,
      atlas.height / 2,
      0,
      0,
      256,
      height,
    );
    context.filter = "none";
  }
  // Long fibres, weather checks and pale chipped edges give the wood a hand-worked finish.
  for (let line = 0; line < 240 && !endGrain; line++) {
    const x = random() * 256;
    const start = random() * height;
    context.strokeStyle =
      line % 4
        ? `rgba(66,39,17,${0.12 + random() * 0.22})`
        : "rgba(240,214,162,.29)";
    context.lineWidth = line % 7 ? 0.6 : 1.6;
    context.beginPath();
    context.moveTo(x, start);
    for (
      let y = start;
      y <= Math.min(height, start + 90 + random() * 360);
      y += 12
    )
      context.lineTo(x + Math.sin(y * 0.014 + line) * (1 + (line % 4)), y);
    context.stroke();
  }
  for (let chip = 0; chip < 48; chip++) {
    const x = chip % 2 ? random() * 11 : 245 + random() * 11;
    context.fillStyle = "rgba(235,205,153,.35)";
    context.fillRect(x, random() * height, 1 + random() * 3, 2 + random() * 12);
  }
  if (flat) {
    context.strokeStyle = "#48301c";
    context.lineWidth = 13;
    context.lineCap = "square";
    for (const y of [235, 512, 789]) {
      context.shadowColor = "#f1cd89";
      context.shadowOffsetX = 2;
      context.shadowOffsetY = 3;
      context.beginPath();
      context.moveTo(75, y - 46);
      context.lineTo(181, y + 46);
      context.moveTo(181, y - 46);
      context.lineTo(75, y + 46);
      context.stroke();
    }
    context.shadowOffsetX = context.shadowOffsetY = 0;
    context.strokeStyle = "rgba(70,41,18,.5)";
    context.lineWidth = 2;
    context.strokeRect(17, 34, 222, 956);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const reliefCanvas = document.createElement("canvas");
  reliefCanvas.width = 256;
  reliefCanvas.height = height;
  const reliefContext = reliefCanvas.getContext("2d")!;
  reliefContext.drawImage(canvas, 0, 0);
  const relief = reliefContext.getImageData(0, 0, 256, height);
  for (let i = 0; i < relief.data.length; i += 4) {
    const value = Math.min(
      255,
      relief.data[i] * 0.65 + relief.data[i + 1] * 0.35,
    );
    relief.data[i] = relief.data[i + 1] = relief.data[i + 2] = value;
  }
  reliefContext.putImageData(relief, 0, 0);
  const bump = new THREE.CanvasTexture(reliefCanvas);
  bump.anisotropy = 4;
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = 256;
  roughCanvas.height = height;
  for (let i = 0; i < relief.data.length; i += 4)
    relief.data[i] =
      relief.data[i + 1] =
      relief.data[i + 2] =
        220 + relief.data[i] * 0.12;
  roughCanvas.getContext("2d")!.putImageData(relief, 0, 0);
  const roughness = new THREE.CanvasTexture(roughCanvas);
  return { color: texture, bump, roughness };
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
  // ExtrudeGeometry's world-space UVs cut off the grain; wrap fibres along Z instead.
  const points = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal"),
    uv = geometry.getAttribute("uv");
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i),
      y = points.getY(i),
      z = points.getZ(i);
    if (Math.abs(normals.getZ(i)) > 0.75)
      uv.setXY(i, (x + 0.218) / 0.436, (y + 0.118) / 0.236);
    else
      uv.setXY(
        i,
        normals.getY(i) < -0.5
          ? (x + 0.218) / 0.436
          : Math.atan2(y + 0.1, x) / Math.PI,
        (z + 0.878) / 1.756,
      );
  }
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
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 6.2, 6.8);
    this.camera.lookAt(0, 0.75, 0);
    this.world.add(new THREE.HemisphereLight(0xfff1d6, 0x3c352b, 1.65));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.8);
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
    const rim = new THREE.DirectionalLight(0xd8dfc2, 1.1);
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

    const grain = woodTextures(false),
      marked = woodTextures(true),
      endGrain = woodTextures(false, true);
    for (const material of [grain, marked, endGrain])
      this.textures.push(material.color, material.bump, material.roughness);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      map: grain.color,
      bumpMap: grain.bump,
      bumpScale: 0.028,
      roughnessMap: grain.roughness,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });
    const capMaterial = new THREE.MeshStandardMaterial({
      map: endGrain.color,
      bumpMap: endGrain.bump,
      bumpScale: 0.018,
      roughnessMap: endGrain.roughness,
      roughness: 0.96,
    });
    const flatMaterial = new THREE.MeshStandardMaterial({
      map: marked.color,
      bumpMap: marked.bump,
      bumpScale: 0.024,
      roughnessMap: marked.roughness,
      roughness: 0.94,
      metalness: 0,
    });
    void loadWoodAtlas()
      .then((atlas) => {
        if (this.disposed) return;
        for (const [material, flat] of [
          [bodyMaterial, false],
          [flatMaterial, true],
        ] as const) {
          const painted = woodTextures(flat, false, atlas);
          this.textures.push(painted.color, painted.bump, painted.roughness);
          material.map = painted.color;
          material.bumpMap = painted.bump;
          material.roughnessMap = painted.roughness;
          material.needsUpdate = true;
        }
        this.render();
      })
      .catch(() => {
        /* Locally synthesized grain remains usable if the asset cannot load. */
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
      if (this.broken) return;
      if (this.seen.has(state.throwKey)) {
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
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.broken = true;
    this.cancelFrame();
    this.onFallback();
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
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
