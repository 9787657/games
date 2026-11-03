import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(selector = "") {
    this.selector = selector;
    this.classList = new FakeClassList();
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.dataset = {};
    this.textContent = "";
    this.attributes = new Map();
    this.width = 320;
    this.height = 220;
    this.listeners = new Map();
  }

  get offsetWidth() {
    return 100;
  }

  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }

  dispatch(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) callback(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setPointerCapture() {}
  releasePointerCapture() {}

  hasPointerCapture() {
    return false;
  }

  getContext(kind) {
    if (kind === "webgl2") return createFakeWebGl();
    return createFakeCanvasContext();
  }
}

function createFakeCanvasContext() {
  const gradient = { addColorStop() {} };
  return {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    ellipse() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    closePath() {},
    setLineDash() {},
    createLinearGradient() {
      return gradient;
    },
    createRadialGradient() {
      return gradient;
    },
    set fillStyle(value) {},
    get fillStyle() {
      return "#000";
    },
    set strokeStyle(value) {},
    get strokeStyle() {
      return "#000";
    },
    set lineWidth(value) {},
    set shadowColor(value) {},
    set shadowBlur(value) {},
  };
}

function createFakeWebGl() {
  const constants = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ACTIVE_UNIFORMS: 5,
    ARRAY_BUFFER: 6,
    ELEMENT_ARRAY_BUFFER: 7,
    STATIC_DRAW: 8,
    DYNAMIC_DRAW: 9,
    FLOAT: 10,
    TRIANGLES: 11,
    UNSIGNED_SHORT: 12,
    UNSIGNED_INT: 13,
    COLOR_BUFFER_BIT: 14,
    DEPTH_BUFFER_BIT: 15,
    DEPTH_TEST: 16,
    LEQUAL: 17,
    CULL_FACE: 18,
    BLEND: 19,
    SRC_ALPHA: 20,
    ONE_MINUS_SRC_ALPHA: 21,
  };
  const base = {
    ...constants,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    shaderSource() {},
    compileShader() {},
    attachShader() {},
    linkProgram() {},
    deleteShader() {},
    getShaderParameter: () => true,
    getProgramParameter: (_program, parameter) => parameter === constants.ACTIVE_UNIFORMS ? 0 : true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getActiveUniform: () => ({ name: "unused" }),
    getUniformLocation: () => null,
    getAttribLocation: () => 0,
  };
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
  });
}

const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, new FakeElement(selector));
  return elements.get(selector);
}

let nextFrame = null;
const listeners = new Map();
const fakeWindow = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(name, callback) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame(callback) {
    nextFrame = callback;
    return 1;
  },
};

Object.assign(globalThis, {
  window: fakeWindow,
  document: {
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  localStorage: {
    getItem: () => null,
    setItem() {},
  },
  requestAnimationFrame: fakeWindow.requestAnimationFrame,
});

const gamePath = fileURLToPath(new URL("../game.js", import.meta.url));
await import(pathToFileURL(gamePath).href);

if (typeof window.azureRun?.start !== "function") {
  throw new Error("Game API did not initialize.");
}

function runFrames(count, startTime = performance.now()) {
  for (let index = 1; index <= count; index += 1) {
    const callback = nextFrame;
    if (!callback) throw new Error("Animation loop stopped.");
    nextFrame = null;
    callback(startTime + index * 16.67);
  }
}

runFrames(3);
window.azureRun.start();
runFrames(260);

if (window.azureRun.state.mode !== "race") {
  throw new Error(`Expected race mode, received ${window.azureRun.state.mode}`);
}

const keyEvent = (code) => ({ code, repeat: false, preventDefault() {} });
const dispatchWindow = (name, event) => {
  for (const callback of listeners.get(name) || []) callback(event);
};

dispatchWindow("keydown", keyEvent("KeyD"));
runFrames(18);
if (!(window.azureRun.state.yaw < 0)) {
  throw new Error("D should steer to the visual right.");
}
dispatchWindow("keyup", keyEvent("KeyD"));

const yawBeforeLeft = window.azureRun.state.yaw;
dispatchWindow("keydown", keyEvent("KeyA"));
runFrames(24);
if (!(window.azureRun.state.yaw > yawBeforeLeft)) {
  throw new Error("A should steer to the visual left.");
}
dispatchWindow("keyup", keyEvent("KeyA"));

const route = [
  [15, 45],
  [35, 94],
  [15, 146],
  [-29, 158],
  [-48, 91],
  [-22, 27],
  [0, 1],
];

for (const [x, z] of route) {
  window.azureRun.state.position[0] = x;
  window.azureRun.state.position[2] = z;
  runFrames(2);
}

if (window.azureRun.state.mode !== "finish") {
  throw new Error(`Expected finish mode, received ${window.azureRun.state.mode}`);
}

const source = await readFile(new URL("../game.js", import.meta.url), "utf8");
if (!source.includes("layout(location = 0) in vec3 aPosition")) {
  throw new Error("Shader attribute layout contract is missing.");
}

console.log("Smoke test passed: startup, countdown, route completion, and finish flow.");
