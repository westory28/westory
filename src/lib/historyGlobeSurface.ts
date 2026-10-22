import type { GlobeView } from "./historyGlobeMath";

export const GLOBE_SURFACE_WIDTH = 2048;
export const GLOBE_SURFACE_HEIGHT = 1024;

/** A bounded moving basemap. The settled map and all hit testing remain D3. */
export function createGlobeSurface(onContextChange: () => void) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < GLOBE_SURFACE_WIDTH) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  let source: HTMLCanvasElement | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let ready = false;
  let disposed = false;
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  const release = () => {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    program = buffer = texture = null;
    ready = false;
  };
  const upload = () => {
    if (!source || !texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    ready = true;
  };
  const initialize = () => {
    const compile = (kind: number, code: string) => {
      const shader = gl.createShader(kind);
      if (!shader) return null;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      gl.deleteShader(shader);
      return null;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      `
      attribute vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `,
    );
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      uniform sampler2D surface;
      uniform vec2 viewport;
      uniform vec2 origin;
      uniform float radius;
      uniform vec3 facing;
      uniform vec3 east;
      uniform vec3 north;
      void main() {
        vec2 point = (vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y) - origin) / radius;
        float distanceSquared = dot(point, point);
        if (distanceSquared > 1.0) discard;
        vec3 world = facing * sqrt(max(0.0, 1.0 - distanceSquared)) + east * point.x - north * point.y;
        vec2 uv = vec2(atan(world.y, world.x) / 6.28318530718 + 0.5,
                       0.5 - asin(clamp(world.z, -1.0, 1.0)) / 3.14159265359);
        gl_FragColor = texture2D(surface, uv);
      }
    `,
    );
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return;
    }
    program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      release();
      return;
    }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) {
      release();
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uniforms = Object.fromEntries(
      ["viewport", "origin", "radius", "facing", "east", "north"].map(
        (name) => [name, gl.getUniformLocation(program!, name)],
      ),
    );
    upload();
  };
  const lost = (event: Event) => {
    event.preventDefault();
    ready = false;
    onContextChange();
  };
  const restored = () => {
    if (disposed) return;
    initialize();
    onContextChange();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  initialize();
  return {
    isReady() {
      return ready && !disposed && !gl.isContextLost();
    },
    invalidate() {
      ready = false;
      source = null;
    },
    updateTexture(next: HTMLCanvasElement) {
      source = next;
      if (!disposed && !gl.isContextLost()) upload();
    },
    render(
      width: number,
      height: number,
      camera: GlobeView,
      origin: { x: number; y: number },
    ) {
      if (!ready || disposed || gl.isContextLost()) return null;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const longitude = (camera.longitude * Math.PI) / 180;
      const latitude = (camera.latitude * Math.PI) / 180;
      const roll = (camera.roll * Math.PI) / 180;
      const cosine = Math.cos(latitude),
        sine = Math.sin(latitude);
      const c = Math.cos(longitude),
        s = Math.sin(longitude);
      const cr = Math.cos(roll),
        sr = Math.sin(roll);
      gl.uniform2f(uniforms.viewport, width, height);
      gl.uniform2f(uniforms.origin, origin.x * width, origin.y * height);
      gl.uniform1f(
        uniforms.radius,
        Math.min(width, height) * 0.44 * camera.zoom,
      );
      gl.uniform3f(uniforms.facing, cosine * c, cosine * s, sine);
      gl.uniform3f(
        uniforms.east,
        -s * cr + sine * c * sr,
        c * cr + sine * s * sr,
        -cosine * sr,
      );
      gl.uniform3f(
        uniforms.north,
        -s * sr - sine * c * cr,
        c * sr - sine * s * cr,
        cosine * cr,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return canvas;
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      source = null;
      release();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

export type GlobeSurface = NonNullable<ReturnType<typeof createGlobeSurface>>;
