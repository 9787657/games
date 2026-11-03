const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (current, target, speed, dt) => lerp(current, target, 1 - Math.exp(-speed * dt));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (value) => value - Math.floor(value);
const hash = (value) => fract(Math.sin(value * 127.1 + 311.7) * 43758.5453);

const canvas = document.querySelector("#game-canvas");
const hud = document.querySelector("#hud");
const startScreen = document.querySelector("#start-screen");
const finishScreen = document.querySelector("#finish-screen");
const errorScreen = document.querySelector("#error-screen");
const errorMessage = document.querySelector("#error-message");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const soundButton = document.querySelector("#sound-toggle");
const countdown = document.querySelector("#countdown");
const countdownValue = document.querySelector("#countdown-value");
const toast = document.querySelector("#toast");
const raceTime = document.querySelector("#race-time");
const checkpointLabel = document.querySelector("#checkpoint-label");
const raceProgress = document.querySelector("#race-progress");
const windArrow = document.querySelector("#wind-arrow");
const windLabel = document.querySelector("#wind-label");
const windSpeed = document.querySelector("#wind-speed");
const bearingArrow = document.querySelector("#bearing-arrow");
const bearingWidget = document.querySelector("#bearing-widget");
const targetDistance = document.querySelector("#target-distance");
const speedDial = document.querySelector("#speed-dial");
const speedValue = document.querySelector("#speed-value");
const efficiencyFill = document.querySelector("#efficiency-fill");
const efficiencyValue = document.querySelector("#efficiency-value");
const trimIndicator = document.querySelector("#trim-indicator");
const bestTimeLabel = document.querySelector("#best-time");
const finishTime = document.querySelector("#finish-time");
const finishRecord = document.querySelector("#finish-record");
const minimap = document.querySelector("#minimap");
const minimapContext = minimap.getContext("2d");

const gl = canvas.getContext("webgl2", {
  antialias: true,
  alpha: false,
  depth: true,
  powerPreference: "high-performance",
});

if (!gl) {
  errorScreen.classList.remove("is-hidden");
  errorMessage.textContent = "当前浏览器或显卡不支持 WebGL 2.0。请开启硬件加速后重试。";
  throw new Error("WebGL 2 is unavailable");
}

function fail(message) {
  errorScreen.classList.remove("is-hidden");
  errorMessage.textContent = message;
  throw new Error(message);
}

function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function identity4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function translation4(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotationX4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationZ4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function scale4(x, y, z) {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

function compose4(position, rotation, scale) {
  let matrix = translation4(position[0], position[1], position[2]);
  matrix = multiply4(matrix, rotationY4(rotation[1]));
  matrix = multiply4(matrix, rotationX4(rotation[0]));
  matrix = multiply4(matrix, rotationZ4(rotation[2]));
  return multiply4(matrix, scale4(scale[0], scale[1], scale[2]));
}

function perspective4(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const rangeInverse = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInverse, -1,
    0, 0, 2 * near * far * rangeInverse, 0,
  ]);
}

function lookAt4(eye, target, up = [0, 1, 0]) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let zLength = Math.hypot(zx, zy, zz) || 1;
  zx /= zLength;
  zy /= zLength;
  zz /= zLength;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xLength = Math.hypot(xx, xy, xz) || 1;
  xx /= xLength;
  xy /= xLength;
  xz /= xLength;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function normalMatrix3(matrix) {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const determinant = a00 * b01 + a01 * b11 + a02 * b21;
  const inverseDet = determinant ? 1 / determinant : 1;

  const i00 = b01 * inverseDet;
  const i01 = (-a22 * a01 + a02 * a21) * inverseDet;
  const i02 = (a12 * a01 - a02 * a11) * inverseDet;
  const i10 = b11 * inverseDet;
  const i11 = (a22 * a00 - a02 * a20) * inverseDet;
  const i12 = (-a12 * a00 + a02 * a10) * inverseDet;
  const i20 = b21 * inverseDet;
  const i21 = (-a21 * a00 + a01 * a20) * inverseDet;
  const i22 = (a11 * a00 - a01 * a10) * inverseDet;

  return new Float32Array([
    i00, i10, i20,
    i01, i11, i21,
    i02, i12, i22,
  ]);
}

function color(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function compileShader(type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    fail(`${label}着色器编译失败：${info}`);
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource, label) {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource, `${label} 顶点`);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${label} 片段`);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    fail(`${label}着色器链接失败：${gl.getProgramInfoLog(program)}`);
  }
  program.uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    const name = info.name.replace(/\[0\]$/, "");
    program.uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return program;
}

const sceneProgram = createProgram(
  `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec3 aNormal;
  layout(location = 2) in vec3 aColor;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;
  uniform mat3 uNormalMatrix;
  out vec3 vWorldPosition;
  out vec3 vNormal;
  out vec3 vColor;
  void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vColor = aColor;
    gl_Position = uProjection * uView * world;
  }`,
  `#version 300 es
  precision highp float;
  in vec3 vWorldPosition;
  in vec3 vNormal;
  in vec3 vColor;
  uniform vec3 uCameraPosition;
  uniform vec3 uLightDirection;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uAlpha;
  out vec4 outColor;
  void main() {
    vec3 normal = normalize(vNormal);
    if (!gl_FrontFacing) normal *= -1.0;
    vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
    float diffuse = max(dot(normal, normalize(uLightDirection)), 0.0);
    float hemisphere = 0.48 + 0.37 * normal.y;
    float specular = pow(max(dot(normal, normalize(uLightDirection + viewDirection)), 0.0), 48.0);
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
    vec3 lit = vColor * (hemisphere * 0.68 + diffuse * 0.66);
    lit += vec3(1.0, 0.91, 0.72) * specular * 0.17;
    lit += vec3(0.23, 0.48, 0.5) * rim * 0.08;
    float distanceToCamera = distance(uCameraPosition, vWorldPosition);
    float fog = smoothstep(uFogNear, uFogFar, distanceToCamera);
    lit = mix(lit, uFogColor, fog * 0.9);
    outColor = vec4(lit, uAlpha);
  }`,
  "场景"
);

const waterProgram = createProgram(
  `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPosition;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform vec2 uCenter;
  uniform float uTime;
  out vec3 vWorldPosition;
  out vec3 vNormal;
  out float vWave;

  float waveHeight(vec2 p) {
    float h = sin(p.x * 0.115 + uTime * 0.82) * 0.34;
    h += sin(p.y * 0.086 - uTime * 0.64) * 0.28;
    h += sin((p.x + p.y) * 0.061 + uTime * 0.48) * 0.17;
    h += sin((p.x - p.y) * 0.17 - uTime * 0.92) * 0.075;
    return h;
  }

  void main() {
    vec2 p = aPosition.xz + uCenter;
    float height = waveHeight(p);
    float epsilon = 0.42;
    float dx = waveHeight(p + vec2(epsilon, 0.0)) - waveHeight(p - vec2(epsilon, 0.0));
    float dz = waveHeight(p + vec2(0.0, epsilon)) - waveHeight(p - vec2(0.0, epsilon));
    vNormal = normalize(vec3(-dx, epsilon * 2.0, -dz));
    vWorldPosition = vec3(p.x, height, p.y);
    vWave = height;
    gl_Position = uProjection * uView * vec4(vWorldPosition, 1.0);
  }`,
  `#version 300 es
  precision highp float;
  in vec3 vWorldPosition;
  in vec3 vNormal;
  in float vWave;
  uniform vec3 uCameraPosition;
  uniform vec3 uSunDirection;
  uniform vec3 uFogColor;
  uniform float uTime;
  uniform float uFogNear;
  uniform float uFogFar;
  out vec4 outColor;

  float random(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
    float facing = max(dot(normal, viewDirection), 0.0);
    float fresnel = pow(1.0 - facing, 3.0);
    vec3 deep = vec3(0.018, 0.23, 0.31);
    vec3 shallow = vec3(0.055, 0.51, 0.57);
    vec3 skyTint = vec3(0.44, 0.75, 0.81);
    vec3 water = mix(deep, shallow, smoothstep(-0.55, 0.6, vWave) * 0.52);
    water = mix(water, skyTint, fresnel * 0.73);

    vec3 halfVector = normalize(normalize(uSunDirection) + viewDirection);
    float sunGlint = pow(max(dot(normal, halfVector), 0.0), 210.0);
    sunGlint *= 0.8 + random(floor(vWorldPosition.xz * 6.0) + uTime) * 0.45;
    water += vec3(1.0, 0.9, 0.68) * sunGlint * 1.45;

    float crest = smoothstep(0.44, 0.7, vWave);
    float fleck = random(floor(vWorldPosition.xz * 8.0));
    float foam = crest * smoothstep(0.76, 0.96, fleck + sin(vWorldPosition.x * 1.8 + uTime) * 0.1);
    water = mix(water, vec3(0.76, 0.91, 0.91), foam * 0.24);

    float distanceToCamera = distance(uCameraPosition, vWorldPosition);
    float fog = smoothstep(uFogNear, uFogFar, distanceToCamera);
    water = mix(water, uFogColor, fog * 0.94);
    outColor = vec4(water, 1.0);
  }`,
  "海面"
);

const skyProgram = createProgram(
  `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPosition;
  out vec2 vUv;
  void main() {
    vUv = aPosition.xy * 0.5 + 0.5;
    gl_Position = vec4(aPosition.xy, 0.999, 1.0);
  }`,
  `#version 300 es
  precision highp float;
  in vec2 vUv;
  uniform vec2 uSunUv;
  uniform float uAspect;
  uniform float uYaw;
  uniform float uTime;
  out vec4 outColor;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * amplitude;
      p = p * 2.03 + vec2(19.1, 7.3);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float height = clamp(vUv.y, 0.0, 1.0);
    vec3 horizon = vec3(0.57, 0.79, 0.79);
    vec3 middle = vec3(0.24, 0.61, 0.74);
    vec3 zenith = vec3(0.055, 0.31, 0.53);
    vec3 sky = mix(horizon, middle, smoothstep(0.0, 0.43, height));
    sky = mix(sky, zenith, smoothstep(0.34, 1.0, height));
    sky += vec3(0.10, 0.055, 0.005) * (1.0 - smoothstep(0.0, 0.25, height));

    vec2 cloudUv = vec2(
      (vUv.x + uYaw * 0.075) * uAspect * 2.25 + uTime * 0.0025,
      vUv.y * 4.16 - uTime * 0.0011
    );
    float cloudNoise = fbm(cloudUv + noise(cloudUv * 0.52) * 0.35);
    float cloudMask = smoothstep(0.53, 0.69, cloudNoise);
    cloudMask *= smoothstep(0.16, 0.37, height) * (1.0 - smoothstep(0.44, 0.97, height));
    cloudMask *= 0.48 + smoothstep(0.48, 0.8, noise(cloudUv * 2.3 + 8.0)) * 0.52;
    vec3 cloudColor = mix(vec3(0.65, 0.78, 0.8), vec3(1.0, 0.96, 0.87), 0.45 + height * 0.35);
    sky = mix(sky, cloudColor, cloudMask * 0.69);

    vec2 sunDelta = (vUv - uSunUv) * vec2(uAspect, 1.0);
    float sunDistance = length(sunDelta);
    float sunDisc = 1.0 - smoothstep(0.011, 0.027, sunDistance);
    float sunHalo = exp(-sunDistance * 8.5) * 0.5 + exp(-sunDistance * 28.0) * 0.55;
    sky += vec3(1.0, 0.81, 0.53) * (sunDisc * 0.8 + sunHalo * 0.48);

    float horizonGlow = exp(-pow((height - 0.03) * 9.0, 2.0));
    sky += vec3(0.18, 0.13, 0.07) * horizonGlow * 0.32;
    outColor = vec4(sky, 1.0);
  }`,
  "天空"
);

const effectProgram = createProgram(
  `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec2 aUv;
  layout(location = 2) in float aAlpha;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;
  out vec2 vUv;
  out float vAlpha;
  void main() {
    vUv = aUv;
    vAlpha = aAlpha;
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  }`,
  `#version 300 es
  precision highp float;
  in vec2 vUv;
  in float vAlpha;
  uniform vec3 uColor;
  uniform float uTime;
  out vec4 outColor;
  void main() {
    float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
    float lace = sin(vUv.x * 31.0 + vUv.y * 18.0 + uTime * 2.2) * 0.5 + 0.5;
    lace *= sin(vUv.y * 43.0 - uTime * 1.7) * 0.5 + 0.5;
    float breakup = smoothstep(0.12, 0.8, 0.38 + lace * 0.56);
    float alpha = vAlpha * edge * breakup;
    if (alpha < 0.008) discard;
    outColor = vec4(uColor, alpha);
  }`,
  "透明特效"
);

class Mesh {
  constructor(positions, indices, colors, useUint32 = false) {
    this.count = indices.length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const normals = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      const ax = positions[ia];
      const ay = positions[ia + 1];
      const az = positions[ia + 2];
      const abx = positions[ib] - ax;
      const aby = positions[ib + 1] - ay;
      const abz = positions[ib + 2] - az;
      const acx = positions[ic] - ax;
      const acy = positions[ic + 1] - ay;
      const acz = positions[ic + 2] - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      for (const index of [ia, ib, ic]) {
        normals[index] += nx;
        normals[index + 1] += ny;
        normals[index + 2] += nz;
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, useUint32 ? new Uint32Array(indices) : new Uint16Array(indices), gl.STATIC_DRAW);
    this.indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindVertexArray(null);
  }

  draw() {
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }
}

function makeMesh(positions, indices, colorValue) {
  const colors = new Array(positions.length).fill(0);
  if (Array.isArray(colorValue[0])) {
    for (let index = 0; index < positions.length / 3; index += 1) {
      colors[index * 3] = colorValue[index][0];
      colors[index * 3 + 1] = colorValue[index][1];
      colors[index * 3 + 2] = colorValue[index][2];
    }
  } else {
    for (let index = 0; index < positions.length / 3; index += 1) {
      colors[index * 3] = colorValue[0];
      colors[index * 3 + 1] = colorValue[1];
      colors[index * 3 + 2] = colorValue[2];
    }
  }
  return new Mesh(positions, indices, colors);
}

function makeBox(width, height, depth, colorValue) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const positions = [
    -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z,
    -x, -y, z, x, -y, z, x, y, z, -x, y, z,
    -x, -y, -z, -x, y, -z, -x, y, z, -x, -y, z,
    x, -y, -z, x, -y, z, x, y, z, x, y, -z,
    -x, -y, -z, -x, -y, z, x, -y, z, x, -y, -z,
    -x, y, -z, x, y, -z, x, y, z, -x, y, z,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    8, 9, 10, 8, 10, 11, 12, 14, 13, 12, 15, 14,
    16, 17, 18, 16, 18, 19, 20, 22, 21, 20, 23, 22,
  ];
  return makeMesh(positions, indices, colorValue);
}

function makeCylinder(topRadius, bottomRadius, height, segments, colorValue) {
  const positions = [];
  const indices = [];
  const half = height / 2;
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    positions.push(c * bottomRadius, -half, s * bottomRadius);
    positions.push(c * topRadius, half, s * topRadius);
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const a = index * 2;
    const b = next * 2;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (topRadius > 0.0001) {
    const centerTop = positions.length / 3;
    positions.push(0, half, 0);
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      indices.push(centerTop, index * 2 + 1, next * 2 + 1);
    }
  }
  if (bottomRadius > 0.0001) {
    const centerBottom = positions.length / 3;
    positions.push(0, -half, 0);
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      indices.push(centerBottom, next * 2, index * 2);
    }
  }
  return makeMesh(positions, indices, colorValue);
}

function makeSphere(radius, segments, stacks, lowerColor, upperColor = lowerColor) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (let stack = 0; stack <= stacks; stack += 1) {
    const v = stack / stacks;
    const phi = v * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const theta = u * TAU;
      positions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
      colors.push(mixColor(lowerColor, upperColor, 1 - v));
    }
  }
  for (let stack = 0; stack < stacks; stack += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = stack * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return makeMesh(positions, indices, colors);
}

function makeTorus(majorRadius, minorRadius, majorSegments, minorSegments, colorValue) {
  const positions = [];
  const indices = [];
  for (let major = 0; major <= majorSegments; major += 1) {
    const u = (major / majorSegments) * TAU;
    for (let minor = 0; minor <= minorSegments; minor += 1) {
      const v = (minor / minorSegments) * TAU;
      positions.push(
        (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u),
        (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u),
        minorRadius * Math.sin(v)
      );
    }
  }
  for (let major = 0; major < majorSegments; major += 1) {
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const a = major * (minorSegments + 1) + minor;
      const b = a + minorSegments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return makeMesh(positions, indices, colorValue);
}

function makeTube(start, end, radius, segments, colorValue) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  const direction = [dx / length, dy / length, dz / length];
  let helper = Math.abs(direction[1]) > 0.88 ? [1, 0, 0] : [0, 1, 0];
  let ux = helper[1] * direction[2] - helper[2] * direction[1];
  let uy = helper[2] * direction[0] - helper[0] * direction[2];
  let uz = helper[0] * direction[1] - helper[1] * direction[0];
  const uLength = Math.hypot(ux, uy, uz) || 1;
  ux /= uLength;
  uy /= uLength;
  uz /= uLength;
  const vx = direction[1] * uz - direction[2] * uy;
  const vy = direction[2] * ux - direction[0] * uz;
  const vz = direction[0] * uy - direction[1] * ux;

  const positions = [];
  const indices = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    const c = Math.cos(angle) * radius;
    const s = Math.sin(angle) * radius;
    positions.push(start[0] + ux * c + vx * s, start[1] + uy * c + vy * s, start[2] + uz * c + vz * s);
    positions.push(end[0] + ux * c + vx * s, end[1] + uy * c + vy * s, end[2] + uz * c + vz * s);
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(index * 2, next * 2, index * 2 + 1, next * 2, next * 2 + 1, index * 2 + 1);
  }
  return makeMesh(positions, indices, colorValue);
}

class Node {
  constructor(name, mesh = null, parent = null, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    this.name = name;
    this.mesh = mesh;
    this.parent = parent;
    this.position = [...position];
    this.rotation = [...rotation];
    this.scale = [...scale];
    this.children = [];
    this.worldMatrix = identity4();
    this.localMatrix = identity4();
    this.visible = true;
    if (parent) parent.children.push(this);
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  update(parentMatrix = identity4()) {
    this.localMatrix = compose4(this.position, this.rotation, this.scale);
    this.worldMatrix = multiply4(parentMatrix, this.localMatrix);
    for (const child of this.children) child.update(this.worldMatrix);
  }
}

function sceneNode(name, mesh, parent, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new Node(name, mesh, parent, position, rotation, scale);
}

function createWaterGrid(size, segments) {
  const positions = [];
  const indices = [];
  const half = size / 2;
  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      positions.push(
        -half + (xIndex / segments) * size,
        0,
        -half + (zIndex / segments) * size
      );
    }
  }
  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = zIndex * (segments + 1) + xIndex;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

function createFullscreenQuad() {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

class EffectMesh {
  constructor(vertices = null, dynamic = false) {
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.dynamic = dynamic;
    this.count = 0;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    if (vertices) this.upload(vertices);
  }

  upload(vertices) {
    this.count = vertices.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  }

  draw() {
    if (!this.count) return;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

const water = createWaterGrid(430, 176);
const skyQuad = createFullscreenQuad();
const identityMatrix = identity4();

const COLORS = {
  ivory: color("#f0eee2"),
  warmWhite: color("#fbf5e5"),
  sail: color("#f4edda"),
  sailShadow: color("#d9dbc9"),
  coral: color("#e46f53"),
  teal: color("#168d8c"),
  tealDark: color("#0b5264"),
  navy: color("#0b3043"),
  brass: color("#b88c50"),
  wood: color("#8a5a38"),
  woodLight: color("#b68455"),
  woodDark: color("#5d3d2b"),
  deck: color("#a6754b"),
  deckLight: color("#bd8d5e"),
  window: color("#173f4a"),
  dark: color("#102d34"),
  leaf: color("#2c6c4c"),
  leafLight: color("#548b58"),
  leafDark: color("#1a4e3b"),
  sand: color("#d5c18e"),
  rock: color("#716d5d"),
  foam: color("#e8f7f3"),
};

function createHull() {
  const sections = [
    { z: -3.45, width: 0.62, deck: 0.23 },
    { z: -2.75, width: 0.88, deck: 0.18 },
    { z: -1.3, width: 0.99, deck: 0.15 },
    { z: 0.35, width: 0.94, deck: 0.15 },
    { z: 1.85, width: 0.76, deck: 0.2 },
    { z: 2.92, width: 0.48, deck: 0.31 },
    { z: 3.76, width: 0.045, deck: 0.48 },
  ];
  const profile = [
    { x: 1, y: 0, tone: 0 },
    { x: 0.985, y: -0.2, tone: 1 },
    { x: 0.72, y: -0.55, tone: 2 },
    { x: 0, y: -0.78, tone: 3 },
    { x: -0.72, y: -0.55, tone: 2 },
    { x: -0.985, y: -0.2, tone: 1 },
    { x: -1, y: 0, tone: 0 },
  ];
  const toneColors = [
    COLORS.ivory,
    COLORS.teal,
    COLORS.tealDark,
    COLORS.navy,
  ];
  const positions = [];
  const colors = [];
  const indices = [];
  for (const section of sections) {
    for (const point of profile) {
      positions.push(point.x * section.width, section.deck + point.y, section.z);
      const tint = mixColor(toneColors[point.tone], COLORS.navy, point.tone === 0 ? Math.max(0, -section.z) * 0.02 : 0);
      colors.push(tint);
    }
  }
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    for (let pointIndex = 0; pointIndex < profile.length - 1; pointIndex += 1) {
      const a = sectionIndex * profile.length + pointIndex;
      const b = a + profile.length;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const sternCenter = positions.length / 3;
  positions.push(0, -0.18, sections[0].z - 0.025);
  colors.push(COLORS.ivory);
  for (let pointIndex = 0; pointIndex < profile.length - 1; pointIndex += 1) {
    indices.push(sternCenter, pointIndex + 1, pointIndex);
  }
  return makeMesh(positions, indices, colors);
}

function createDeck() {
  const sections = [
    { z: -3.42, width: 0.53, deck: 0.245 },
    { z: -2.72, width: 0.77, deck: 0.195 },
    { z: -1.28, width: 0.87, deck: 0.165 },
    { z: 0.35, width: 0.82, deck: 0.165 },
    { z: 1.83, width: 0.65, deck: 0.215 },
    { z: 2.88, width: 0.4, deck: 0.325 },
    { z: 3.66, width: 0.035, deck: 0.49 },
  ];
  const rows = 7;
  const positions = [];
  const colors = [];
  const indices = [];
  for (const section of sections) {
    for (let row = 0; row < rows; row += 1) {
      const across = row / (rows - 1) * 2 - 1;
      positions.push(across * section.width, section.deck, section.z);
      colors.push(row % 2 === 0 ? COLORS.deckLight : COLORS.deck);
    }
  }
  for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const a = sectionIndex * rows + row;
      const b = a + rows;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return makeMesh(positions, indices, colors);
}

function createSail(points, bulge, subdivisions, stripeColor = null) {
  const [top, luffFoot, clew] = points;
  const positions = [];
  const colors = [];
  const indices = [];
  const rowStart = [];
  let cursor = 0;
  for (let i = 0; i <= subdivisions; i += 1) {
    rowStart[i] = cursor;
    cursor += subdivisions - i + 1;
  }
  const pointAt = (i, j) => {
    const u = i / subdivisions;
    const v = j / subdivisions;
    const xBase = top[0] * (1 - u - v) + luffFoot[0] * u + clew[0] * v;
    const y = top[1] * (1 - u - v) + luffFoot[1] * u + clew[1] * v;
    const z = top[2] * (1 - u - v) + luffFoot[2] * u + clew[2] * v;
    const camber = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return [xBase + bulge * camber, y, z];
  };
  for (let i = 0; i <= subdivisions; i += 1) {
    for (let j = 0; j <= subdivisions - i; j += 1) {
      const point = pointAt(i, j);
      positions.push(...point);
      const stripeBand = stripeColor && point[1] > 2.18 && point[1] < 2.54;
      const upperBand = stripeColor && point[1] > 3.88 && point[1] < 4.08;
      colors.push(stripeBand ? stripeColor : upperBand ? COLORS.teal : COLORS.sail);
    }
  }
  const indexAt = (i, j) => rowStart[i] + j;
  for (let i = 0; i < subdivisions; i += 1) {
    for (let j = 0; j < subdivisions - i; j += 1) {
      const a = indexAt(i, j);
      const b = indexAt(i + 1, j);
      const c = indexAt(i, j + 1);
      indices.push(a, b, c);
      if (j < subdivisions - i - 1) {
        const d = indexAt(i + 1, j + 1);
        indices.push(b, d, c);
      }
    }
  }
  return makeMesh(positions, indices, colors);
}

function createFlag() {
  const positions = [0, 0, 0, 0, 0.28, 0, 0.9, 0.12, 0.02];
  const indices = [0, 1, 2];
  return makeMesh(positions, indices, [COLORS.coral, COLORS.coral, COLORS.ivory]);
}

function createBoat() {
  const root = new Node("sailboat-root");
  sceneNode("hull", createHull(), root);
  sceneNode("deck", createDeck(), root);
  sceneNode("rub-rail-port", makeTube([-0.72, 0.24, -3.38], [-0.03, 0.5, 3.68], 0.035, 7, COLORS.brass), root);
  sceneNode("rub-rail-starboard", makeTube([0.72, 0.24, -3.38], [0.03, 0.5, 3.68], 0.035, 7, COLORS.brass), root);
  sceneNode("transom-trim", makeBox(1.25, 0.06, 0.05, COLORS.brass), root, [0, 0.28, -3.42]);

  sceneNode("cabin-body", makeBox(1.28, 0.62, 1.96, COLORS.ivory), root, [0, 0.49, -1.28]);
  sceneNode("cabin-roof", makeBox(1.41, 0.1, 2.07, COLORS.warmWhite), root, [0, 0.85, -1.28]);
  sceneNode("cabin-trim", makeBox(1.34, 0.035, 2.02, COLORS.teal), root, [0, 0.38, -1.28]);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 2; index += 1) {
      sceneNode("cabin-window", makeBox(0.035, 0.26, 0.55, COLORS.window), root, [
        side * 0.655,
        0.55,
        -1.52 + index * 0.61,
      ]);
    }
  }
  sceneNode("windshield", makeBox(1.02, 0.24, 0.035, COLORS.window), root, [0, 0.58, -0.29]);
  sceneNode("companionway", makeBox(0.6, 0.045, 0.82, COLORS.woodDark), root, [0, 0.19, 0.03]);
  sceneNode("fore-hatch", makeBox(0.54, 0.07, 0.74, COLORS.warmWhite), root, [0, 0.3, 1.6]);

  const winch = makeCylinder(0.12, 0.12, 0.11, 12, COLORS.brass);
  for (const side of [-1, 1]) {
    sceneNode("winch", winch, root, [side * 0.58, 0.29, -2.12]);
  }

  sceneNode("mast", makeCylinder(0.055, 0.085, 6.48, 12, COLORS.brass), root, [0, 3.45, 0.25]);
  sceneNode("mast-foot", makeCylinder(0.16, 0.22, 0.22, 12, COLORS.woodDark), root, [0, 0.34, 0.25]);
  sceneNode("masthead", makeSphere(0.105, 10, 6, COLORS.brass), root, [0, 6.69, 0.25]);

  sceneNode("forestay", makeTube([0, 6.57, 0.25], [0, 0.62, 3.64], 0.012, 5, COLORS.brass), root);
  sceneNode("backstay", makeTube([0, 6.56, 0.25], [0, 0.47, -3.34], 0.012, 5, COLORS.brass), root);
  sceneNode("shroud-port", makeTube([0, 6.25, 0.25], [-0.75, 0.22, -0.1], 0.011, 5, COLORS.brass), root);
  sceneNode("shroud-starboard", makeTube([0, 6.25, 0.25], [0.75, 0.22, -0.1], 0.011, 5, COLORS.brass), root);

  const mainSailGroup = new Node("main-sail-group", null, root, [0, 0, 0.25]);
  sceneNode("boom", makeTube([0, 1.34, 0], [0, 1.34, -3.42], 0.062, 8, COLORS.brass), mainSailGroup);
  sceneNode("main-sail", createSail(
    [[0, 6.5, 0], [0, 1.37, 0], [0, 1.43, -3.34]],
    0.48,
    13,
    COLORS.coral
  ), mainSailGroup);
  sceneNode("main-sheet", makeTube([0, 1.32, -3.15], [0, 0.37, -1.55], 0.009, 4, COLORS.brass), mainSailGroup);

  const jibGroup = new Node("jib-group", null, root);
  sceneNode("jib-sail", createSail(
    [[0, 6.32, 0.3], [0, 0.82, 3.54], [0, 1.08, 1.03]],
    0.33,
    11,
    null
  ), jibGroup);
  sceneNode("jib-sheet-port", makeTube([0, 1.06, 1.08], [-0.44, 0.28, 0.18], 0.009, 4, COLORS.brass), jibGroup);
  sceneNode("jib-sheet-starboard", makeTube([0, 1.06, 1.08], [0.44, 0.28, 0.18], 0.009, 4, COLORS.brass), jibGroup);

  const flagPivot = new Node("flag-pivot", null, root, [0, 6.68, 0.25]);
  sceneNode("flag", createFlag(), flagPivot);

  const wheelGroup = new Node("wheel-group", null, root, [0, 1.1, -2.15]);
  sceneNode("wheel", makeTorus(0.42, 0.028, 24, 6, COLORS.woodLight), wheelGroup);
  for (let spoke = 0; spoke < 3; spoke += 1) {
    const angle = spoke / 3 * Math.PI;
    sceneNode("wheel-spoke", makeBox(0.035, 0.77, 0.035, COLORS.woodLight), wheelGroup, [0, 0, 0], [0, 0, angle]);
  }
  sceneNode("wheel-column", makeTube([0, -0.7, 0], [0, 0, 0], 0.04, 7, COLORS.brass), wheelGroup);

  sceneNode("rudder", makeBox(0.08, 0.75, 0.58, COLORS.tealDark), root, [0, -0.33, -3.47]);

  return {
    root,
    mainSailGroup,
    jibGroup,
    flagPivot,
    wheelGroup,
  };
}

function createTerrain(radius, height, seed, ringCount = 13, segments = 36) {
  const heightAt = (radial, angle) => {
    if (radial < 0.015) return height * 0.98;
    const ridge = 0.76 + Math.sin(angle * 3.3 + seed) * 0.1 + Math.sin(angle * 7.1 - seed * 1.7) * 0.055;
    const shoulders = Math.sin(angle * 2.1 + seed * 0.9 + radial * 5.0) * 0.06;
    return Math.max(
      0,
      height * Math.pow(1 - radial, 1.34) * (ridge + shoulders) - radial * 0.08
    );
  };
  const positions = [];
  const colors = [];
  const indices = [];
  for (let ring = 0; ring <= ringCount; ring += 1) {
    const radial = ring / ringCount;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const wobble = 1 + Math.sin(angle * 4.1 + seed) * 0.065 + Math.sin(angle * 9.5 - seed) * 0.028;
      const r = radius * radial * wobble;
      const y = heightAt(radial, angle);
      positions.push(Math.cos(angle) * r, y, Math.sin(angle) * r);
      const beach = smoothstep(1.0, 3.3, y);
      const vegetation = smoothstep(2.1, height * 0.75, y);
      const tone = smoothstep(0.25, 0.85, hash(segment * 7.2 + ring * 4.7 + seed));
      const ground = mixColor(mixColor(COLORS.sand, COLORS.leafLight, beach), COLORS.leafDark, vegetation * 0.62);
      colors.push(mixColor(ground, COLORS.leaf, tone * 0.23));
    }
  }
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { mesh: makeMesh(positions, indices, colors), heightAt };
}

function createShore(radius, seed) {
  const positions = [];
  const colors = [];
  const indices = [];
  const inner = 0.92;
  const outer = 1.08;
  const segments = 48;
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * TAU;
    const wobble = 1 + Math.sin(angle * 4.1 + seed) * 0.065 + Math.sin(angle * 9.5 - seed) * 0.028;
    positions.push(Math.cos(angle) * radius * inner * wobble, 0.08, Math.sin(angle) * radius * inner * wobble);
    positions.push(Math.cos(angle) * radius * outer * wobble, 0.015, Math.sin(angle) * radius * outer * wobble);
    colors.push(COLORS.sand, color("#9ec8b8"));
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(index * 2, next * 2, index * 2 + 1, next * 2, next * 2 + 1, index * 2 + 1);
  }
  return makeMesh(positions, indices, colors);
}

const treeMeshes = {
  trunk: makeCylinder(0.08, 0.14, 1.1, 7, COLORS.woodDark),
  lower: makeCylinder(0, 0.72, 1.35, 8, COLORS.leafDark),
  upper: makeCylinder(0, 0.56, 1.25, 8, COLORS.leaf),
  crown: makeCylinder(0, 0.38, 1.08, 8, COLORS.leafLight),
  rock: makeSphere(1, 8, 5, COLORS.rock, COLORS.sand),
};

function addIsland(sceneRoot, definition, index) {
  const { mesh, heightAt } = createTerrain(definition.radius, definition.height, definition.seed);
  const islandGroup = new Node(`island-${index}`, null, sceneRoot, [definition.x, 0, definition.z]);
  sceneNode("terrain", mesh, islandGroup);
  sceneNode("shore", createShore(definition.radius, definition.seed), islandGroup);

  const treeCount = Math.round(definition.radius * 0.34);
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const angle = hash(treeIndex * 8.3 + index * 17.1) * TAU;
    const radial = 0.22 + hash(treeIndex * 2.9 + index * 3.3) * 0.55;
    const localRadius = definition.radius * radial;
    const x = Math.cos(angle) * localRadius;
    const z = Math.sin(angle) * localRadius;
    const y = heightAt(radial, angle);
    if (y < 1.7) continue;
    const heightScale = 0.75 + hash(treeIndex * 4.1 + definition.seed) * 0.55;
    const tree = new Node(`tree-${treeIndex}`, null, islandGroup, [x, y, z], [0, hash(treeIndex + index) * TAU, 0], [heightScale, heightScale, heightScale]);
    sceneNode("trunk", treeMeshes.trunk, tree, [0, 0.42, 0]);
    sceneNode("lower", treeMeshes.lower, tree, [0, 1.2, 0]);
    sceneNode("upper", treeMeshes.upper, tree, [0, 1.75, 0]);
    sceneNode("crown", treeMeshes.crown, tree, [0, 2.24, 0]);
  }

  for (let rockIndex = 0; rockIndex < 5; rockIndex += 1) {
    const angle = hash(rockIndex * 9.1 + index * 5.2) * TAU;
    const radial = 0.58 + hash(rockIndex * 11.2 + index) * 0.28;
    const localRadius = definition.radius * radial;
    const x = Math.cos(angle) * localRadius;
    const z = Math.sin(angle) * localRadius;
    const y = heightAt(radial, angle);
    sceneNode(
      "shore-rock",
      treeMeshes.rock,
      islandGroup,
      [x, y + 0.18, z],
      [0, angle, hash(rockIndex) * 0.3],
      [0.55 + hash(rockIndex * 2) * 0.55, 0.38 + hash(rockIndex * 3) * 0.3, 0.52 + hash(rockIndex * 4) * 0.48]
    );
  }

  return islandGroup;
}

const worldRoot = new Node("world");
const islandDefinitions = [
  { x: -66, z: 76, radius: 21, height: 8.2, seed: 2.1 },
  { x: 70, z: 77, radius: 17, height: 6.4, seed: 5.7 },
  { x: 79, z: 157, radius: 29, height: 11.2, seed: 8.3 },
  { x: -62, z: 177, radius: 27, height: 9.4, seed: 12.4 },
  { x: 2, z: 238, radius: 44, height: 16.5, seed: 18.7 },
  { x: -103, z: 125, radius: 16, height: 5.7, seed: 23.2 },
  { x: 118, z: 225, radius: 27, height: 8.2, seed: 29.4 },
];

const islands = islandDefinitions.map((definition, index) => {
  const group = addIsland(worldRoot, definition, index);
  return { ...definition, group };
});

function addLighthouse(island) {
  const angle = 2.7;
  const radial = 0.27;
  const x = island.x + Math.cos(angle) * island.radius * radial;
  const z = island.z + Math.sin(angle) * island.radius * radial;
  const ground = island.height * Math.pow(1 - radial, 1.34) * 0.82;
  const group = new Node("lighthouse", null, worldRoot, [x, ground, z]);
  const bands = 5;
  for (let index = 0; index < bands; index += 1) {
    const radius = 1.06 - index * 0.07;
    sceneNode(
      "lighthouse-band",
      makeCylinder(radius - 0.07, radius, 1.22, 14, index % 2 === 0 ? COLORS.warmWhite : COLORS.coral),
      group,
      [0, 0.65 + index * 1.16, 0]
    );
  }
  sceneNode("lighthouse-gallery", makeCylinder(1.3, 1.3, 0.13, 18, COLORS.dark), group, [0, 6.2, 0]);
  sceneNode("lighthouse-railing", makeTorus(1.22, 0.055, 26, 6, COLORS.brass), group, [0, 6.55, 0], [Math.PI / 2, 0, 0]);
  sceneNode("lantern-glass", makeCylinder(0.76, 0.87, 1.26, 12, color("#e9c96e")), group, [0, 6.95, 0]);
  sceneNode("lantern-top", makeCylinder(0.02, 1.05, 0.56, 12, COLORS.navy), group, [0, 7.87, 0]);
  sceneNode("lantern-finial", makeSphere(0.1, 8, 5, COLORS.brass), group, [0, 8.16, 0]);
  return group;
}

addLighthouse(islands[2]);

const coursePoints = [
  { x: 15, z: 45 },
  { x: 35, z: 94 },
  { x: 15, z: 146 },
  { x: -29, z: 158 },
  { x: -48, z: 91 },
  { x: -22, z: 27 },
];
const finishPoint = { x: 0, z: 1 };
const gateData = coursePoints.map((point, index) => {
  const previous = index === 0 ? { x: 0, z: -2 } : coursePoints[index - 1];
  const dx = point.x - previous.x;
  const dz = point.z - previous.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    ...point,
    index,
    directionX: dx / length,
    directionZ: dz / length,
    sideX: -dz / length,
    sideZ: dx / length,
  };
});

function createBuoy(colorValue) {
  const root = new Node("buoy", null, worldRoot);
  sceneNode("buoy-float", makeCylinder(0.48, 0.72, 0.55, 12, COLORS.ivory), root, [0, 0.25, 0]);
  sceneNode("buoy-stripe", makeCylinder(0.48, 0.56, 0.18, 12, colorValue), root, [0, 0.42, 0]);
  sceneNode("buoy-body", makeSphere(0.46, 12, 7, colorValue), root, [0, 0.72, 0], [0, 0, 0], [1, 1.26, 1]);
  sceneNode("buoy-collar", makeCylinder(0.16, 0.24, 0.19, 10, COLORS.brass), root, [0, 1.12, 0]);
  sceneNode("buoy-pole", makeCylinder(0.035, 0.045, 1.22, 7, COLORS.brass), root, [0, 1.72, 0]);
  const flagPositions = [0, 0, 0, 0.72, 0.34, 0, 0, 0.52, 0];
  sceneNode("buoy-pennant", makeMesh(flagPositions, [0, 1, 2], [colorValue, COLORS.warmWhite, colorValue]), root, [0, 2.16, 0]);
  return root;
}

const buoyRoots = [];
for (const gate of gateData) {
  const colorA = gate.index % 2 === 0 ? COLORS.coral : color("#eab84d");
  const colorB = gate.index % 2 === 0 ? color("#eab84d") : COLORS.coral;
  for (const side of [-1, 1]) {
    const buoy = createBuoy(side < 0 ? colorA : colorB);
    buoy.position[0] = gate.x + gate.sideX * side * 8.8;
    buoy.position[2] = gate.z + gate.sideZ * side * 8.8;
    buoyRoots.push({
      node: buoy,
      gateIndex: gate.index,
      phase: hash(gate.index * 5.3 + side * 2.1) * TAU,
    });
  }
}

const finishBuoys = [];
for (const side of [-1, 1]) {
  const buoy = createBuoy(COLORS.warmWhite);
  buoy.position[0] = side * 12;
  buoy.position[2] = finishPoint.z;
  finishBuoys.push(buoy);
}

function createRingEffect(radius, width, segments = 80) {
  const vertices = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) / segments * TAU;
    const angle = index / segments * TAU;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const cb = Math.cos(next);
    const sb = Math.sin(next);
    const r0 = radius - width * 0.5;
    const r1 = radius + width * 0.5;
    vertices.push(
      ca * r0, 0, sa * r0, 0, angle, 0.8,
      ca * r1, 0, sa * r1, 1, angle, 0.8,
      cb * r0, 0, sb * r0, 0, next, 0.8,
      cb * r0, 0, sb * r0, 0, next, 0.8,
      ca * r1, 0, sa * r1, 1, angle, 0.8,
      cb * r1, 0, sb * r1, 1, next, 0.8
    );
  }
  return new EffectMesh(vertices);
}

const gateRing = createRingEffect(8.2, 1.05);
const gateRingNode = new Node("course-ring", null, worldRoot);
gateRingNode.position = [coursePoints[0].x, 0.1, coursePoints[0].z];

const birdGeometry = (() => {
  const positions = [
    -0.8, 0, 0, 0, 0.16, 0, -0.25, 0.05, 0,
    0.25, 0.05, 0, 0, 0.16, 0, 0.8, 0, 0,
  ];
  return makeMesh(positions, [0, 1, 2, 3, 4, 5], COLORS.dark);
})();
const birds = [];
for (let index = 0; index < 9; index += 1) {
  const node = sceneNode("bird", birdGeometry, worldRoot, [
    (hash(index * 3.8) - 0.5) * 150,
    17 + hash(index * 8.2) * 18,
    30 + hash(index * 2.6) * 150,
  ], [0, hash(index * 9.1) * TAU, 0], [1, 1, 1]);
  birds.push({
    node,
    centerX: node.position[0],
    centerZ: node.position[2],
    radius: 10 + hash(index * 2.3) * 18,
    speed: 0.055 + hash(index * 1.9) * 0.075,
    phase: hash(index * 5.1) * TAU,
  });
}

const boat = createBoat();
boat.root.position = [0, 0, -2];
boat.root.update();
worldRoot.update();

class WakeTrail {
  constructor() {
    this.mesh = new EffectMesh(null, true);
    this.points = [];
    this.timer = 0;
  }

  reset() {
    this.points.length = 0;
    this.timer = 0;
    this.mesh.count = 0;
  }

  update(dt, position, forward, side, speed) {
    this.timer += dt;
    if (this.timer > 0.035 && speed > 0.4) {
      this.timer = 0;
      this.points.unshift({
        x: position[0] - forward[0] * 3.1,
        z: position[2] - forward[2] * 3.1,
        width: 0.17 + speed * 0.045,
        alpha: clamp(speed / 10, 0.25, 1),
        phase: simulationTime,
      });
      if (this.points.length > 54) this.points.pop();
    }
    const vertices = [];
    for (let index = 0; index < this.points.length - 1; index += 1) {
      const point = this.points[index];
      const next = this.points[index + 1];
      const age = index / Math.max(1, this.points.length);
      const spread = point.width * (1.8 + age * 4.6);
      const sideX = index > 0 ? point.z - next.z : side[0];
      const sideZ = index > 0 ? next.x - point.x : side[1];
      const sideLength = Math.hypot(sideX, sideZ) || 1;
      const sx = sideX / sideLength;
      const sz = sideZ / sideLength;
      const nextAge = (index + 1) / Math.max(1, this.points.length);
      const nextSpread = next.width * (1.8 + nextAge * 4.6);
      const a0 = waveHeight(point.x - sx * spread, point.z - sz * spread, simulationTime) + 0.045;
      const a1 = waveHeight(point.x + sx * spread, point.z + sz * spread, simulationTime) + 0.045;
      const b0 = waveHeight(next.x - sx * nextSpread, next.z - sz * nextSpread, simulationTime) + 0.045;
      const b1 = waveHeight(next.x + sx * nextSpread, next.z + sz * nextSpread, simulationTime) + 0.045;
      const alphaA = point.alpha * (1 - age) * 0.48;
      const alphaB = next.alpha * (1 - nextAge) * 0.48;
      const v0 = age * 4;
      const v1 = nextAge * 4;
      vertices.push(
        point.x - sx * spread, a0, point.z - sz * spread, 0, v0, alphaA,
        point.x + sx * spread, a1, point.z + sz * spread, 1, v0, alphaA,
        next.x - sx * nextSpread, b0, next.z - sz * nextSpread, 0, v1, alphaB,
        next.x - sx * nextSpread, b0, next.z - sz * nextSpread, 0, v1, alphaB,
        point.x + sx * spread, a1, point.z + sz * spread, 1, v0, alphaA,
        next.x + sx * nextSpread, b1, next.z + sz * nextSpread, 1, v1, alphaB
      );
    }
    if (vertices.length) this.mesh.upload(vertices);
  }
}

const wake = new WakeTrail();

function waveHeight(x, z, time) {
  return (
    Math.sin(x * 0.115 + time * 0.82) * 0.34 +
    Math.sin(z * 0.086 - time * 0.64) * 0.28 +
    Math.sin((x + z) * 0.061 + time * 0.48) * 0.17 +
    Math.sin((x - z) * 0.17 - time * 0.92) * 0.075
  );
}

let simulationTime = 0;
let viewportWidth = window.innerWidth;
let viewportHeight = window.innerHeight;
let pixelRatio = 1;

let storedBest = Number.NaN;
try {
  storedBest = Number(localStorage.getItem("azure-run-best"));
} catch {
  storedBest = Number.NaN;
}

const state = {
  mode: "attract",
  position: [0, 0, -2],
  yaw: 0,
  rudder: 0,
  speed: 0,
  sail: 0.7,
  nextGate: 0,
  elapsed: 0,
  countdown: 3.05,
  goDisplay: 0,
  windAngle: 0.9,
  cameraMode: 0,
  soundEnabled: false,
  bestTime: Number.isFinite(storedBest) && storedBest > 0 ? storedBest : Infinity,
  lastCountdownLabel: "",
  collisionCooldown: 0,
  trailToastShown: false,
  soundChosen: false,
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--.--";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  const whole = Math.floor(remaining);
  const hundredths = Math.floor((remaining - whole) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

bestTimeLabel.textContent = formatTime(state.bestTime);

let toastTimer = 0;
let finishRevealTimer = 0;
function showToast(message, duration = 2.1) {
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = duration;
}

function restartCountdownAnimation(value) {
  countdownValue.textContent = value;
  countdownValue.style.animation = "none";
  void countdownValue.offsetWidth;
  countdownValue.style.animation = "";
}

function getTarget() {
  return state.nextGate < coursePoints.length ? coursePoints[state.nextGate] : finishPoint;
}

function resetRace() {
  state.position = [0, waveHeight(0, -2, simulationTime), -2];
  state.yaw = 0;
  state.speed = 0;
  state.rudder = 0;
  state.sail = 0.7;
  state.nextGate = 0;
  state.elapsed = 0;
  state.collisionCooldown = 0;
  state.goDisplay = 0;
  state.countdown = 3.05;
  state.lastCountdownLabel = "";
  state.trailToastShown = false;
  gateRingNode.position = [coursePoints[0].x, 0.1, coursePoints[0].z];
  wake.reset();
  updateCheckpointUi();
}

function startRace() {
  window.clearTimeout(finishRevealTimer);
  finishRevealTimer = 0;
  resetRace();
  startScreen.classList.add("is-hidden");
  finishScreen.classList.add("is-hidden");
  hud.classList.remove("is-hidden");
  countdown.classList.remove("is-hidden");
  restartCountdownAnimation("3");
  state.lastCountdownLabel = "3";
  state.mode = "countdown";
  if (!state.soundChosen) setSound(true);
  if (state.soundEnabled) audio.ensure();
}

class OceanAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.filter = null;
    this.oceanGain = null;
    this.windGain = null;
    this.started = false;
    this.muted = true;
  }

  ensure() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);

      const bufferLength = this.context.sampleRate * 4;
      const buffer = this.context.createBuffer(1, bufferLength, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let smoothed = 0;
      for (let index = 0; index < bufferLength; index += 1) {
        const white = Math.random() * 2 - 1;
        smoothed = smoothed * 0.985 + white * 0.015;
        const swell = Math.sin(index / this.context.sampleRate * TAU * 0.13) * 0.18;
        data[index] = (smoothed * 2.5 + white * 0.1) * (0.72 + swell);
      }

      const oceanSource = this.context.createBufferSource();
      oceanSource.buffer = buffer;
      oceanSource.loop = true;
      this.filter = this.context.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 760;
      this.filter.Q.value = 0.35;
      this.oceanGain = this.context.createGain();
      this.oceanGain.gain.value = 0.34;
      const windFilter = this.context.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.55;
      this.windGain = this.context.createGain();
      this.windGain.gain.value = 0.08;
      oceanSource.connect(this.filter).connect(this.oceanGain).connect(this.master);
      oceanSource.connect(windFilter).connect(this.windGain).connect(this.master);
      oceanSource.start();
      this.started = true;
    }
    if (this.context.state === "suspended") this.context.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) {
      this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
      return;
    }
    this.ensure();
    this.master?.gain.setTargetAtTime(0.75, this.context.currentTime, 0.4);
  }

  setSpeed(ratio) {
    if (!this.context) return;
    this.filter.frequency.setTargetAtTime(540 + ratio * 1050, this.context.currentTime, 0.1);
    this.oceanGain.gain.setTargetAtTime(0.3 + ratio * 0.18, this.context.currentTime, 0.1);
    this.windGain.gain.setTargetAtTime(0.055 + ratio * 0.13, this.context.currentTime, 0.12);
  }

  chime(finish = false) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const frequencies = finish ? [392, 493.88, 587.33, 783.99] : [659.25, 880];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.08);
      gain.gain.linearRampToValueAtTime(finish ? 0.09 : 0.045, now + index * 0.08 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5 + index * 0.14);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now + index * 0.08);
      oscillator.stop(now + 1.9 + index * 0.14);
    });
  }
}

const audio = new OceanAudio();

function setSound(enabled) {
  state.soundEnabled = enabled;
  soundButton.setAttribute("aria-pressed", String(enabled));
  audio.setMuted(!enabled);
}

soundButton.addEventListener("click", () => {
  state.soundChosen = true;
  setSound(!state.soundEnabled);
});
startButton.addEventListener("click", startRace);
restartButton.addEventListener("click", startRace);

const input = {
  left: false,
  right: false,
  trimIn: false,
  trimOut: false,
};

const keyMap = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "trimIn",
  ArrowUp: "trimIn",
  KeyS: "trimOut",
  ArrowDown: "trimOut",
};

window.addEventListener("keydown", (event) => {
  if (keyMap[event.code]) {
    input[keyMap[event.code]] = true;
    event.preventDefault();
  }
  if (event.repeat) return;
  if (event.code === "KeyM") {
    state.soundChosen = true;
    setSound(!state.soundEnabled);
  }
  if (event.code === "KeyC") {
    state.cameraMode = (state.cameraMode + 1) % 2;
    showToast(state.cameraMode === 0 ? "近景追逐镜头" : "远景航行镜头", 1.25);
  }
  if (event.code === "KeyR" && (state.mode === "race" || state.mode === "finish")) {
    startRace();
  }
});

window.addEventListener("keyup", (event) => {
  if (keyMap[event.code]) {
    input[keyMap[event.code]] = false;
    event.preventDefault();
  }
});

window.addEventListener("blur", () => {
  input.left = false;
  input.right = false;
  input.trimIn = false;
  input.trimOut = false;
});

document.querySelectorAll("[data-control]").forEach((button) => {
  const control = button.dataset.control;
  const property = control === "left" || control === "right"
    ? control
    : control === "trim-in" ? "trimIn" : "trimOut";
  const release = (event) => {
    input[property] = false;
    button.classList.remove("active");
    if (event?.pointerId !== undefined && button.hasPointerCapture?.(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    input[property] = true;
    button.classList.add("active");
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

function updateCheckpointUi() {
  if (state.nextGate < coursePoints.length) {
    checkpointLabel.textContent = `浮标 ${String(state.nextGate + 1).padStart(2, "0")} / ${String(coursePoints.length).padStart(2, "0")}`;
    raceProgress.style.width = `${(state.nextGate / coursePoints.length) * 100}%`;
    bearingWidget.classList.remove("is-hidden");
  } else {
    checkpointLabel.textContent = "返回港口";
    raceProgress.style.width = "100%";
    bearingWidget.classList.remove("is-hidden");
  }
}

function finishRace() {
  if (state.mode !== "race") return;
  state.mode = "finish";
  finishTime.textContent = formatTime(state.elapsed);
  const isRecord = state.elapsed < state.bestTime;
  if (isRecord) {
    state.bestTime = state.elapsed;
    try {
      localStorage.setItem("azure-run-best", String(state.elapsed));
    } catch {
      // Private browsing can reject storage; the race still finishes normally.
    }
    finishRecord.textContent = "新的最佳成绩";
    bestTimeLabel.textContent = formatTime(state.bestTime);
  } else {
    finishRecord.textContent = `最佳成绩 ${formatTime(state.bestTime)}`;
  }
  finishRevealTimer = window.setTimeout(() => {
    finishRevealTimer = 0;
    finishScreen.classList.remove("is-hidden");
  }, 650);
  audio.chime(true);
}

function checkRaceProgress() {
  const target = getTarget();
  const distance = Math.hypot(state.position[0] - target.x, state.position[2] - target.z);
  if (distance > 12.5) return;
  if (state.nextGate < coursePoints.length) {
    state.nextGate += 1;
    audio.chime(false);
    if (state.nextGate < coursePoints.length) {
      const nextPoint = coursePoints[state.nextGate];
      gateRingNode.position = [nextPoint.x, 0.1, nextPoint.z];
      showToast(`浮标 ${String(state.nextGate).padStart(2, "0")} 已通过`);
    } else {
      gateRingNode.position = [finishPoint.x, 0.1, finishPoint.z];
      showToast("最后一段 · 返回海风港");
    }
    updateCheckpointUi();
  } else {
    finishRace();
  }
}

function resolveIslandCollisions() {
  if (state.collisionCooldown > 0) return;
  const [x, , z] = state.position;
  for (const island of islands) {
    const dx = x - island.x;
    const dz = z - island.z;
    const minimum = island.radius * 0.92 + 1.8;
    const distance = Math.hypot(dx, dz);
    if (distance < minimum) {
      const push = minimum - distance + 0.2;
      const nx = distance > 0.001 ? dx / distance : 1;
      const nz = distance > 0.001 ? dz / distance : 0;
      state.position[0] += nx * push;
      state.position[2] += nz * push;
      state.speed *= 0.68;
      state.collisionCooldown = 1.5;
      showToast("太靠近浅滩了 · 请向外转向");
      break;
    }
  }
}

function updateRace(dt) {
  const turnInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  state.rudder = damp(state.rudder, turnInput, 6, dt);
  if (input.trimIn) state.sail = clamp(state.sail - dt * 0.38, 0.18, 1);
  if (input.trimOut) state.sail = clamp(state.sail + dt * 0.38, 0.18, 1);

  state.windAngle = 0.86 + Math.sin(simulationTime * 0.018) * 0.12;
  const forwardX = Math.sin(state.yaw);
  const forwardZ = Math.cos(state.yaw);
  const windX = Math.sin(state.windAngle);
  const windZ = Math.cos(state.windAngle);
  const windDot = clamp(forwardX * windX + forwardZ * windZ, -1, 1);
  const windFactor = 0.63 + Math.abs(windDot) * 0.37;
  const trimQuality = clamp(1 - Math.abs(state.sail - 0.68) * 1.25, 0.18, 1);
  const targetSpeed = (2.2 + 14.2 * windFactor * trimQuality) * (1 - Math.abs(state.rudder) * 0.06);
  state.speed = damp(state.speed, targetSpeed, state.speed < targetSpeed ? 0.48 : 0.62, dt);

  const steeringAuthority = 0.055 + state.speed * 0.042;
  // The chase camera looks along +Z, so screen-right is -X in this world.
  // Invert the rudder sign here to keep A = port (left) and D = starboard (right).
  state.yaw -= state.rudder * steeringAuthority * dt;
  state.position[0] += forwardX * state.speed * dt;
  state.position[2] += forwardZ * state.speed * dt;
  state.elapsed += dt;
  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
  resolveIslandCollisions();
  checkRaceProgress();
  audio.setSpeed(clamp(state.speed / 16, 0, 1));
}

function updateBoat(dt) {
  const height = waveHeight(state.position[0], state.position[2], simulationTime);
  state.position[1] = height + 0.025;
  const front = waveHeight(state.position[0], state.position[2] + 1.3, simulationTime);
  const back = waveHeight(state.position[0], state.position[2] - 1.3, simulationTime);
  const right = waveHeight(state.position[0] + 1.1, state.position[2], simulationTime);
  const left = waveHeight(state.position[0] - 1.1, state.position[2], simulationTime);
  const wavePitch = -Math.atan2(front - back, 2.6) * 0.58;
  const waveRoll = -Math.atan2(right - left, 2.2) * 0.5;
  const windDot = Math.sin(state.yaw) * Math.sin(state.windAngle) + Math.cos(state.yaw) * Math.cos(state.windAngle);
  const heel = clamp(-windDot * 0.045 * (state.speed / 10), -0.11, 0.11);
  boat.root.position = [...state.position];
  boat.root.rotation = [wavePitch, state.yaw, waveRoll + heel];

  const cross = Math.sin(state.yaw) * Math.cos(state.windAngle) - Math.cos(state.yaw) * Math.sin(state.windAngle);
  const tack = cross >= 0 ? -1 : 1;
  boat.mainSailGroup.rotation[1] = tack * (0.16 + state.sail * 0.65);
  boat.jibGroup.rotation[1] = tack * (0.06 + state.sail * 0.24) + Math.sin(simulationTime * 2.1) * 0.016;
  boat.flagPivot.rotation[0] = Math.sin(simulationTime * 3.5) * 0.08;
  boat.flagPivot.rotation[2] = Math.sin(simulationTime * 2.7) * 0.08;
  boat.wheelGroup.rotation[2] = state.rudder * 0.52;
  boat.root.update();

  const forward = [Math.sin(state.yaw), 0, Math.cos(state.yaw)];
  const side = [Math.cos(state.yaw), 0, -Math.sin(state.yaw)];
  wake.update(dt, state.position, forward, side, state.speed);
}

function updateWorldAnimation(dt) {
  for (const buoy of buoyRoots) {
    buoy.node.position[1] = waveHeight(buoy.node.position[0], buoy.node.position[2], simulationTime) + 0.02;
    buoy.node.rotation[2] = Math.sin(simulationTime * 1.1 + buoy.phase) * 0.045;
    buoy.node.rotation[0] = Math.cos(simulationTime * 0.8 + buoy.phase) * 0.025;
    const active = buoy.gateIndex === state.nextGate && state.nextGate < coursePoints.length;
    const scale = active ? 1 + Math.sin(simulationTime * 2.5) * 0.025 : 1;
    buoy.node.scale = [scale, scale, scale];
    buoy.node.update();
  }
  for (const buoy of finishBuoys) {
    buoy.position[1] = waveHeight(buoy.position[0], buoy.position[2], simulationTime) + 0.02;
    buoy.update();
  }
  for (const bird of birds) {
    const angle = bird.phase + simulationTime * bird.speed;
    bird.node.position[0] = bird.centerX + Math.cos(angle) * bird.radius;
    bird.node.position[2] = bird.centerZ + Math.sin(angle) * bird.radius;
    bird.node.rotation[1] = -angle + Math.PI * 0.5;
    bird.node.rotation[2] = Math.sin(simulationTime * 2.2 + bird.phase) * 0.07;
    bird.node.update();
  }
  gateRingNode.position[1] = waveHeight(gateRingNode.position[0], gateRingNode.position[2], simulationTime) + 0.14;
  gateRingNode.update();
  const pulse = 1 + Math.sin(simulationTime * 2.6) * 0.025;
  gateRingNode.scale = [pulse, 1, pulse];
}

function resizeCanvas() {
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(viewportWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(viewportHeight * pixelRatio));
  gl.viewport(0, 0, canvas.width, canvas.height);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const cameraPosition = [7, 6, -14];
const cameraTarget = [0, 1.8, 1];

function updateCamera(dt, immediate = false) {
  const forwardX = Math.sin(state.yaw);
  const forwardZ = Math.cos(state.yaw);
  const boatHeight = state.position[1];
  let desiredPosition;
  let desiredTarget;

  if (state.mode === "attract") {
    const orbit = Math.sin(simulationTime * 0.11) * 1.65;
    desiredPosition = [
      state.position[0] + 5.9 + orbit,
      boatHeight + 5.45,
      state.position[2] - 11.7,
    ];
    desiredTarget = [
      state.position[0] + 0.4,
      boatHeight + 1.9,
      state.position[2] + 2.1,
    ];
  } else if (state.mode === "finish") {
    const orbit = simulationTime * 0.18;
    desiredPosition = [
      state.position[0] + Math.cos(orbit) * 15,
      boatHeight + 6.8,
      state.position[2] + Math.sin(orbit) * 15,
    ];
    desiredTarget = [state.position[0], boatHeight + 1.9, state.position[2]];
  } else {
    const longView = state.cameraMode === 1;
    const back = longView ? 17.5 : 10.7;
    const up = longView ? 8.4 : 5.5;
    const lookAhead = longView ? 4.8 : 7.3;
    const speedShake = Math.min(state.speed / 16, 1) * 0.018;
    desiredPosition = [
      state.position[0] - forwardX * back + Math.sin(simulationTime * 7.1) * speedShake,
      boatHeight + up + Math.sin(simulationTime * 5.3) * speedShake,
      state.position[2] - forwardZ * back,
    ];
    desiredTarget = [
      state.position[0] + forwardX * lookAhead,
      boatHeight + (longView ? 2.6 : 1.9),
      state.position[2] + forwardZ * lookAhead,
    ];
  }

  for (let index = 0; index < 3; index += 1) {
    cameraPosition[index] = immediate
      ? desiredPosition[index]
      : damp(cameraPosition[index], desiredPosition[index], state.mode === "finish" ? 1.8 : 3.1, dt);
    cameraTarget[index] = immediate
      ? desiredTarget[index]
      : damp(cameraTarget[index], desiredTarget[index], 4.1, dt);
  }
}

updateCamera(0, true);

function projectToUv(point, viewProjection) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const clipX = viewProjection[0] * x + viewProjection[4] * y + viewProjection[8] * z + viewProjection[12];
  const clipY = viewProjection[1] * x + viewProjection[5] * y + viewProjection[9] * z + viewProjection[13];
  const clipW = viewProjection[3] * x + viewProjection[7] * y + viewProjection[11] * z + viewProjection[15];
  if (clipW <= 0.001) return [-5, -5];
  return [clipX / clipW * 0.5 + 0.5, clipY / clipW * 0.5 + 0.5];
}

const sunDirection = (() => {
  const length = Math.hypot(0.54, 0.7, 0.62);
  return [0.54 / length, 0.7 / length, 0.62 / length];
})();

function drawSceneNode(node) {
  if (!node.visible) return;
  if (node.mesh) {
    gl.uniformMatrix4fv(sceneProgram.uniforms.uModel, false, node.worldMatrix);
    gl.uniformMatrix3fv(sceneProgram.uniforms.uNormalMatrix, false, normalMatrix3(node.worldMatrix));
    node.mesh.draw();
  }
  for (const child of node.children) drawSceneNode(child);
}

function drawEffects() {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.useProgram(effectProgram);
  gl.uniformMatrix4fv(effectProgram.uniforms.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(effectProgram.uniforms.uView, false, cameraView);
  gl.uniform1f(effectProgram.uniforms.uTime, simulationTime);

  const ringModel = compose4(
    [gateRingNode.position[0], gateRingNode.position[1] + 0.07, gateRingNode.position[2]],
    [0, simulationTime * 0.24, 0],
    gateRingNode.scale
  );
  gl.uniformMatrix4fv(effectProgram.uniforms.uModel, false, ringModel);
  gl.uniform3fv(effectProgram.uniforms.uColor, new Float32Array([0.47, 1.0, 0.92]));
  gateRing.draw();

  gl.uniformMatrix4fv(effectProgram.uniforms.uModel, false, identityMatrix);
  gl.uniform3fv(effectProgram.uniforms.uColor, new Float32Array([0.87, 0.98, 0.96]));
  wake.mesh.draw();

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

let projectionMatrix = perspective4(58 * DEG, viewportWidth / viewportHeight, 0.1, 520);
let cameraView = lookAt4(cameraPosition, cameraTarget);

function renderFrame() {
  gl.clearColor(0.1, 0.36, 0.45, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.CULL_FACE);

  const openWaterFov = state.mode === "attract" ? 51 : 54;
  const dynamicFov = openWaterFov + clamp(state.speed / 16, 0, 1) * 4.2;
  projectionMatrix = perspective4(dynamicFov * DEG, viewportWidth / viewportHeight, 0.08, 520);
  cameraView = lookAt4(cameraPosition, cameraTarget);

  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProgram);
  const viewProjection = multiply4(projectionMatrix, cameraView);
  const sunUv = projectToUv([
    cameraPosition[0] + sunDirection[0] * 280,
    cameraPosition[1] + sunDirection[1] * 280,
    cameraPosition[2] + sunDirection[2] * 280,
  ], viewProjection);
  gl.uniform2fv(skyProgram.uniforms.uSunUv, new Float32Array(sunUv));
  gl.uniform1f(skyProgram.uniforms.uAspect, viewportWidth / viewportHeight);
  gl.uniform1f(skyProgram.uniforms.uYaw, state.yaw);
  gl.uniform1f(skyProgram.uniforms.uTime, simulationTime);
  gl.bindVertexArray(skyQuad);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.useProgram(waterProgram);
  gl.uniformMatrix4fv(waterProgram.uniforms.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(waterProgram.uniforms.uView, false, cameraView);
  gl.uniform2fv(waterProgram.uniforms.uCenter, new Float32Array([
    Math.round(state.position[0] / 1.5) * 1.5,
    Math.round(state.position[2] / 1.5) * 1.5,
  ]));
  gl.uniform1f(waterProgram.uniforms.uTime, simulationTime);
  gl.uniform3fv(waterProgram.uniforms.uCameraPosition, new Float32Array(cameraPosition));
  gl.uniform3fv(waterProgram.uniforms.uSunDirection, new Float32Array(sunDirection));
  gl.uniform3fv(waterProgram.uniforms.uFogColor, new Float32Array([0.57, 0.79, 0.79]));
  gl.uniform1f(waterProgram.uniforms.uFogNear, 92);
  gl.uniform1f(waterProgram.uniforms.uFogFar, 300);
  gl.bindVertexArray(water.vao);
  gl.drawElements(gl.TRIANGLES, water.count, gl.UNSIGNED_INT, 0);

  gl.useProgram(sceneProgram);
  gl.uniformMatrix4fv(sceneProgram.uniforms.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(sceneProgram.uniforms.uView, false, cameraView);
  gl.uniform3fv(sceneProgram.uniforms.uCameraPosition, new Float32Array(cameraPosition));
  gl.uniform3fv(sceneProgram.uniforms.uLightDirection, new Float32Array(sunDirection));
  gl.uniform3fv(sceneProgram.uniforms.uFogColor, new Float32Array([0.57, 0.79, 0.79]));
  gl.uniform1f(sceneProgram.uniforms.uFogNear, 105);
  gl.uniform1f(sceneProgram.uniforms.uFogFar, 330);
  gl.uniform1f(sceneProgram.uniforms.uAlpha, 1);
  drawSceneNode(worldRoot);
  drawSceneNode(boat.root);

  drawEffects();
}

function drawMinimap() {
  const ctx = minimapContext;
  const width = minimap.width;
  const height = minimap.height;
  const padding = 18;
  const minX = -126;
  const maxX = 126;
  const minZ = -14;
  const maxZ = 256;
  const mapX = (x) => padding + (x - minX) / (maxX - minX) * (width - padding * 2);
  const mapY = (z) => height - padding - (z - minZ) / (maxZ - minZ) * (height - padding * 2);

  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "rgba(14, 70, 76, 0.9)");
  background.addColorStop(1, "rgba(4, 43, 50, 0.94)");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(210, 239, 235, 0.08)";
  ctx.lineWidth = 1;
  for (let line = 1; line < 5; line += 1) {
    const x = padding + line / 5 * (width - padding * 2);
    const y = padding + line / 5 * (height - padding * 2);
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(120, 166, 116, 0.76)";
  for (const island of islands) {
    const x = mapX(island.x);
    const y = mapY(island.z);
    const radiusX = island.radius / (maxX - minX) * (width - padding * 2);
    const radiusY = island.radius / (maxZ - minZ) * (height - padding * 2);
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, -0.15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(231, 218, 166, 0.32)";
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(112, 222, 210, 0.58)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(mapX(0), mapY(-2));
  for (const point of coursePoints) ctx.lineTo(mapX(point.x), mapY(point.z));
  ctx.lineTo(mapX(finishPoint.x), mapY(finishPoint.z));
  ctx.stroke();
  ctx.setLineDash([]);

  coursePoints.forEach((point, index) => {
    const active = index === state.nextGate;
    ctx.beginPath();
    ctx.arc(mapX(point.x), mapY(point.z), active ? 4.8 : 2.7, 0, TAU);
    ctx.fillStyle = active ? "#f9d79f" : "rgba(235, 247, 242, 0.6)";
    ctx.fill();
    if (active) {
      ctx.beginPath();
      ctx.arc(mapX(point.x), mapY(point.z), 8, 0, TAU);
      ctx.strokeStyle = "rgba(249, 215, 159, 0.6)";
      ctx.stroke();
    }
  });

  ctx.save();
  ctx.translate(mapX(finishPoint.x), mapY(finishPoint.z));
  ctx.fillStyle = "rgba(240, 249, 244, 0.72)";
  ctx.fillRect(-5, -1, 10, 2);
  ctx.fillRect(-1, -5, 2, 10);
  ctx.restore();

  const boatX = mapX(state.position[0]);
  const boatY = mapY(state.position[2]);
  ctx.save();
  ctx.translate(boatX, boatY);
  ctx.rotate(state.yaw);
  ctx.fillStyle = "#f17c59";
  ctx.shadowColor = "rgba(241, 124, 89, 0.7)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5.2, 6);
  ctx.lineTo(0, 3.4);
  ctx.lineTo(-5.2, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function windName(angle) {
  const direction = ((angle / DEG) % 360 + 360) % 360;
  const names = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return names[Math.round(direction / 45) % 8];
}

function updateUi() {
  const target = getTarget();
  const dx = target.x - state.position[0];
  const dz = target.z - state.position[2];
  const targetDistanceValue = Math.hypot(dx, dz);
  const relativeBearing = Math.atan2(dx, dz) - state.yaw;
  bearingArrow.style.transform = `rotate(${-relativeBearing / DEG}deg)`;
  targetDistance.textContent = `${Math.round(targetDistanceValue)} m`;

  windArrow.style.transform = `rotate(${state.windAngle / DEG}deg)`;
  windLabel.textContent = windName(state.windAngle);
  windSpeed.textContent = `${Math.round(9.5 + Math.sin(simulationTime * 0.08) * 1.5)} kn`;

  const knots = state.speed * 1.08;
  speedValue.textContent = knots.toFixed(1);
  speedDial.style.setProperty("--speed-angle", `${clamp(knots / 22, 0, 1) * 280}deg`);

  const forwardX = Math.sin(state.yaw);
  const forwardZ = Math.cos(state.yaw);
  const windDot = clamp(forwardX * Math.sin(state.windAngle) + forwardZ * Math.cos(state.windAngle), -1, 1);
  const efficiency = Math.round(clamp((0.63 + Math.abs(windDot) * 0.37) * clamp(1 - Math.abs(state.sail - 0.68) * 1.25, 0.18, 1), 0, 1) * 100);
  efficiencyFill.style.width = `${efficiency}%`;
  efficiencyFill.style.background = efficiency > 72 ? "#63d8ce" : efficiency > 52 ? "#f9d79f" : "#f17c59";
  efficiencyValue.textContent = `${efficiency}%`;
  trimIndicator.style.top = `${18 + (1 - state.sail) * 64}%`;
  raceTime.textContent = formatTime(state.elapsed);

  if (toastTimer > 0) {
    toastTimer -= 1 / 60;
    if (toastTimer <= 0) toast.classList.remove("show");
  }
}

function updateCountdown(dt) {
  state.countdown -= dt;
  if (state.countdown > 0) {
    const label = String(Math.max(1, Math.ceil(state.countdown)));
    if (label !== state.lastCountdownLabel) {
      restartCountdownAnimation(label);
      state.lastCountdownLabel = label;
    }
  } else if (state.mode === "countdown") {
    state.mode = "race";
    state.goDisplay = 0.75;
    restartCountdownAnimation("出发");
    updateCheckpointUi();
  }

  if (state.mode === "race" && state.goDisplay > 0) {
    state.goDisplay -= dt;
    if (state.goDisplay <= 0) countdown.classList.add("is-hidden");
  }
}

let previousFrameTime = performance.now();
let minimapAccumulator = 0;

function frame(now) {
  const dt = Math.min(0.045, Math.max(0.001, (now - previousFrameTime) / 1000));
  previousFrameTime = now;
  simulationTime += dt;

  if (state.mode === "countdown") {
    updateCountdown(dt);
    state.speed = damp(state.speed, 0, 5, dt);
  } else if (state.mode === "race") {
    updateCountdown(dt);
    updateRace(dt);
  } else if (state.mode === "finish") {
    state.speed = damp(state.speed, 0.5, 0.15, dt);
    state.position[0] += Math.sin(state.yaw) * state.speed * dt;
    state.position[2] += Math.cos(state.yaw) * state.speed * dt;
  }

  updateBoat(dt);
  updateWorldAnimation(dt);
  updateCamera(dt);
  updateUi();
  renderFrame();

  minimapAccumulator += dt;
  if (minimapAccumulator > 0.04) {
    drawMinimap();
    minimapAccumulator = 0;
  }
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  previousFrameTime = performance.now();
});

drawMinimap();
requestAnimationFrame(frame);

window.azureRun = {
  start: startRace,
  get state() {
    return state;
  },
};
