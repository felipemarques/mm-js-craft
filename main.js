import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';

// ---------- Configurações principais ----------
const DEFAULT_WORLD_SIZE = 64; // blocos por eixo X/Z
const CHUNK_SIZE = 16;
const VIEW_DISTANCE_CHUNKS = 3; // raio de chunks carregados
const BLOCK_SIZE = 1;
let WORLD_HEIGHT = 48;
let gameStarted = false;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;
const STEP_HEIGHT = 0.6; // altura máxima do degrau (≈1 bloco)
const GRAVITY = 30;
const WALK_SPEED = 6;
const RUN_SPEED = 9;
const JUMP_FORCE = 12; // pulo mais alto
let WORLD_SIZE = DEFAULT_WORLD_SIZE;
let WORLD_MIN = -WORLD_SIZE / 2;
let WORLD_MAX = WORLD_MIN + WORLD_SIZE;
const INTERACT_DISTANCE = 8;
let gameMode = 'terrain';
const NPC_SPEED = 1.6;
const NPC_HEIGHT = 1.6;
const NPC_RADIUS = 0.3;
const NPC_STEP_HEIGHT = 0.6;
const NPC_JUMP = 10; // salto mais alto que 1 bloco
let touchEnabled = false;
const touchMove = new THREE.Vector2();
const touchLook = new THREE.Vector2();
let jumpQueued = false;
let placeQueued = false;
let removeQueued = false;
let savedSettings = null;

// ---------- DOM / HUD ----------
const hudStats = document.getElementById('stats');
const hudPos = document.getElementById('pos');
const hudInfo = document.getElementById('info-panel');
const instructions = document.getElementById('instructions');
const startBtn = document.getElementById('start-btn');
const gameModeSelect = document.getElementById('game-mode');
const mapSizeSelect = document.getElementById('map-size');
const touchDesktopCheckbox = document.getElementById('touch-desktop');
const paletteEl = document.getElementById('palette');
const freeCursor = document.getElementById('free-cursor');
const touchUI = document.getElementById('touch-ui');
const joyMove = document.getElementById('joy-move');
const joyLook = document.getElementById('joy-look');
const btnJump = document.getElementById('btn-jump');
const btnPlace = document.getElementById('btn-place');
const btnRemove = document.getElementById('btn-remove');
const SETTINGS_KEY = 'voxelcraft/settings/v1';

// ---------- Cena básica ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x162032);
scene.fog = new THREE.Fog(0x162032, 70, 200);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 1; // garante foco para eventos de teclado/mouse

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xfff2d1, 1.15);
sunLight.position.set(0.7, 1, 0.45).normalize();
scene.add(sunLight);

// ---------- Materiais ----------
const chunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const chunkMaterialTranslucent = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

// ---------- Dados do mundo ----------
const chunkMeshes = new Map(); // chave "cx,cz" -> Group com meshes opacos/translúcidos
const tempColor = new THREE.Color();
const worldOverrides = new Map(); // chave "x,y,z" -> tipo de bloco
let cloudsGroup = null;
let selectedBlock = 1;
const dirtyChunks = new Set();
let charactersGroup = null;

const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  SNOW: 5,
  WOOD: 6,
  LEAF: 7,
  WATER: 8,
  BRICK: 9,
  GLOW: 10,
  GLASS: 11,
  FROST: 12,
};

// ---------- Utilidades de ruído leve (determinístico) ----------
function pseudoNoise(x, z) {
  const s = Math.sin(x * 0.143 + z * 0.173) * 43758.5453;
  return s - Math.floor(s);
}

function getHeight(x, z) {
  if (gameMode === 'flat') {
    return 4;
  }
  // Combinações de senoides e ruído barato para variar suavemente.
  const h1 = Math.sin((x + z) * 0.08) * 2.5;
  const h2 = Math.cos(x * 0.12) * 2.0 + Math.sin(z * 0.1) * 2.0;
  const n = (pseudoNoise(x * 0.4, z * 0.4) - 0.5) * 6;
  const height = 6 + h1 + h2 + n;
  return Math.max(1, Math.min(22, Math.floor(height)));
}

function isInsideWorld(x, z) {
  return x >= WORLD_MIN && x < WORLD_MAX && z >= WORLD_MIN && z < WORLD_MAX;
}

function getBlock(x, y, z) {
  const key = `${x},${y},${z}`;
  if (worldOverrides.has(key)) return worldOverrides.get(key);
  if (!isInsideWorld(x, z)) return BLOCK.AIR;
  if (y < 0) return BLOCK.DIRT; // camada base
  const h = getHeight(x, z);
  if (y > h) return BLOCK.AIR;
  if (y === h) return BLOCK.GRASS;
  return BLOCK.DIRT;
}

function markChunkDirty(cx, cz) {
  dirtyChunks.add(`${cx},${cz}`);
}

function setBlock(x, y, z, type, { skipRebuild = false } = {}) {
  const key = `${x},${y},${z}`;
  if (!isInsideWorld(x, z)) return;
  if (y < -1 || y >= WORLD_HEIGHT) return;
  if (type === BLOCK.AIR) {
    worldOverrides.set(key, BLOCK.AIR);
  } else {
    worldOverrides.set(key, type);
  }
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  if (skipRebuild) {
    markChunkDirty(cx, cz);
    if (x % CHUNK_SIZE === 0) markChunkDirty(cx - 1, cz);
    if ((x + 1) % CHUNK_SIZE === 0) markChunkDirty(cx + 1, cz);
    if (z % CHUNK_SIZE === 0) markChunkDirty(cx, cz - 1);
    if ((z + 1) % CHUNK_SIZE === 0) markChunkDirty(cx, cz + 1);
    return;
  }
  rebuildChunk(cx, cz);
  // Se estiver na borda, os chunks vizinhos precisam ser atualizados para revelar faces
  if (x % CHUNK_SIZE === 0) rebuildChunk(cx - 1, cz);
  if ((x + 1) % CHUNK_SIZE === 0) rebuildChunk(cx + 1, cz);
  if (z % CHUNK_SIZE === 0) rebuildChunk(cx, cz - 1);
  if ((z + 1) % CHUNK_SIZE === 0) rebuildChunk(cx, cz + 1);
}

// ---------- Construção de chunks com culling de faces ----------
const FACE_DEFS = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },  // +X
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] }, // -X
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },  // +Y
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },  // +Z
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }, // -Z
];

function blockColor(type, y, x = 0, z = 0) {
  const shade = 0.9 + (pseudoNoise(x * 0.35, z * 0.35) - 0.5) * 0.12; // variação leve de "textura"
  switch (type) {
    case BLOCK.GRASS: return tempColor.setRGB(0.56, 0.86, 0.34).multiplyScalar(shade);
    case BLOCK.DIRT: return tempColor.setRGB(0.58, 0.42, 0.26).multiplyScalar(shade);
    case BLOCK.STONE: return tempColor.setRGB(0.55, 0.58, 0.6).multiplyScalar(shade);
    case BLOCK.SAND: return tempColor.setRGB(0.92, 0.86, 0.6).multiplyScalar(shade);
    case BLOCK.SNOW: return tempColor.setRGB(0.9, 0.95, 1.0).multiplyScalar(shade);
    case BLOCK.WOOD: return tempColor.setRGB(0.45, 0.28, 0.12).multiplyScalar(shade);
    case BLOCK.LEAF: return tempColor.setRGB(0.36, 0.72, 0.28).multiplyScalar(shade);
    case BLOCK.WATER: return tempColor.setRGB(0.25, 0.55, 0.95).multiplyScalar(shade);
    case BLOCK.BRICK: return tempColor.setRGB(0.72, 0.32, 0.28).multiplyScalar(shade);
    case BLOCK.GLOW: return tempColor.setRGB(0.95, 0.9, 0.4).multiplyScalar(shade * 1.05);
    case BLOCK.GLASS: return tempColor.setRGB(0.7, 0.9, 1.0).multiplyScalar(1.05);
    case BLOCK.FROST: return tempColor.setRGB(0.7, 0.9, 1.0).multiplyScalar(0.9);
    default: return tempColor.setRGB(0.6, 0.6, 0.6).multiplyScalar(shade);
  }
}

function buildChunkGeometry(cx, cz) {
  const startX = cx * CHUNK_SIZE;
  const startZ = cz * CHUNK_SIZE;
  if (startX + CHUNK_SIZE <= WORLD_MIN || startX >= WORLD_MAX) return null;
  if (startZ + CHUNK_SIZE <= WORLD_MIN || startZ >= WORLD_MAX) return null;

  const positionsOpaque = [];
  const normalsOpaque = [];
  const colorsOpaque = [];
  const positionsTrans = [];
  const normalsTrans = [];
  const colorsTrans = [];
  const isTranslucent = (type) => type === BLOCK.GLASS || type === BLOCK.FROST;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    const worldX = startX + x;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldZ = startZ + z;
      for (let y = -1; y < WORLD_HEIGHT; y++) {
        const type = getBlock(worldX, y, worldZ);
        if (type === BLOCK.AIR) continue;
        const bx = worldX;
        const by = y;
        const bz = worldZ;
        for (let f = 0; f < FACE_DEFS.length; f++) {
          const face = FACE_DEFS[f];
          const nx = bx + face.dir[0];
          const ny = by + face.dir[1];
          const nz = bz + face.dir[2];
          if (getBlock(nx, ny, nz) !== BLOCK.AIR) continue; // remove faces internas
          const c = blockColor(type, y, bx, bz);
          const posArr = isTranslucent(type) ? positionsTrans : positionsOpaque;
          const normArr = isTranslucent(type) ? normalsTrans : normalsOpaque;
          const colArr = isTranslucent(type) ? colorsTrans : colorsOpaque;
          const corners = face.corners;
          // Dois triângulos por face
          for (let i = 0; i < 6; i++) {
            const idx = [0, 1, 2, 0, 2, 3][i];
            const corner = corners[idx];
            posArr.push(
              bx + corner[0],
              by + corner[1],
              bz + corner[2],
            );
            normArr.push(face.dir[0], face.dir[1], face.dir[2]);
            colArr.push(c.r, c.g, c.b);
          }
        }
      }
    }
  }

  const makeGeom = (positions, normals, colors) => {
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  };

  const opaque = makeGeom(positionsOpaque, normalsOpaque, colorsOpaque);
  const translucent = makeGeom(positionsTrans, normalsTrans, colorsTrans);
  if (!opaque && !translucent) return null;
  return { opaque, translucent };
}

function ensureChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunkMeshes.has(key)) return;
  const geoms = buildChunkGeometry(cx, cz);
  if (!geoms) return;
  const group = new THREE.Group();
  if (geoms.opaque) {
    const mesh = new THREE.Mesh(geoms.opaque, chunkMaterial);
    mesh.frustumCulled = true;
    group.add(mesh);
  }
  if (geoms.translucent) {
    const meshT = new THREE.Mesh(geoms.translucent, chunkMaterialTranslucent);
    meshT.frustumCulled = true;
    meshT.renderOrder = 2;
    group.add(meshT);
  }
  chunkMeshes.set(key, group);
  scene.add(group);
}

function rebuildChunk(cx, cz) {
  const key = `${cx},${cz}`;
  const existing = chunkMeshes.get(key);
  if (existing) {
    scene.remove(existing);
    existing.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
    chunkMeshes.delete(key);
  }
  ensureChunk(cx, cz);
}

function updateVisibleChunks(force = false) {
  const playerChunkX = Math.floor(player.position.x / CHUNK_SIZE);
  const playerChunkZ = Math.floor(player.position.z / CHUNK_SIZE);
  if (!force && playerChunkX === lastChunkX && playerChunkZ === lastChunkZ) return;
  lastChunkX = playerChunkX;
  lastChunkZ = playerChunkZ;

  const needed = new Set();
  for (let dx = -VIEW_DISTANCE_CHUNKS; dx <= VIEW_DISTANCE_CHUNKS; dx++) {
    for (let dz = -VIEW_DISTANCE_CHUNKS; dz <= VIEW_DISTANCE_CHUNKS; dz++) {
      const cx = playerChunkX + dx;
      const cz = playerChunkZ + dz;
      const startX = cx * CHUNK_SIZE;
      const startZ = cz * CHUNK_SIZE;
      if (startX + CHUNK_SIZE <= WORLD_MIN || startX >= WORLD_MAX) continue;
      if (startZ + CHUNK_SIZE <= WORLD_MIN || startZ >= WORLD_MAX) continue;
      const key = `${cx},${cz}`;
      needed.add(key);
      ensureChunk(cx, cz);
    }
  }

  // Remove chunks fora do raio
  for (const [key, mesh] of chunkMeshes) {
    if (!needed.has(key)) {
      scene.remove(mesh);
      mesh.traverse((child) => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
      chunkMeshes.delete(key);
    }
  }
}

// ---------- Controle do jogador ----------
const player = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  onGround: false,
};

const HALF_HEIGHT = PLAYER_HEIGHT * 0.5;
let lastChunkX = null;
let lastChunkZ = null;
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpNormalMatrix = new THREE.Matrix3();
const tmpFaceNormal = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();
const tmpVec2 = new THREE.Vector2();
const tmpPos = new THREE.Vector3();
const infoRecords = new Map();
let infoVisible = true;
let infoDirty = true;
const paletteConfig = [
  { type: BLOCK.GRASS, label: 'Grass' },
  { type: BLOCK.DIRT, label: 'Dirt' },
  { type: BLOCK.STONE, label: 'Stone' },
  { type: BLOCK.SAND, label: 'Sand' },
  { type: BLOCK.SNOW, label: 'Snow' },
  { type: BLOCK.WOOD, label: 'Wood' },
  { type: BLOCK.LEAF, label: 'Leaf' },
  { type: BLOCK.WATER, label: 'Water' },
  { type: BLOCK.BRICK, label: 'Brick' },
  { type: BLOCK.GLOW, label: 'Glow' },
  { type: BLOCK.GLASS, label: 'Glass' },
  { type: BLOCK.FROST, label: 'Frost (Translúcido)' },
];
const raycaster = new THREE.Raycaster();
const centerMouse = new THREE.Vector2(0, 0);

function renderInfoPanel() {
  if (!hudInfo) return;
  hudInfo.classList.toggle('hidden', !infoVisible);
  if (!infoVisible || !infoDirty) return;
  hudInfo.replaceChildren();
  infoRecords.forEach((rec) => {
    if (rec.active === false) return;
    const item = document.createElement('div');
    item.className = 'info-item';
    const label = document.createElement('div');
    label.className = 'info-label';
    label.textContent = rec.label || '';
    const text = document.createElement('div');
    text.className = 'info-text';
    text.textContent = rec.text || '';
    item.append(label, text);
    hudInfo.appendChild(item);
  });
  infoDirty = false;
}

function setInfoRecord(id, { label, text, active = true }) {
  const rec = infoRecords.get(id) || { id };
  let changed = false;
  if (label !== undefined && rec.label !== label) { rec.label = label; changed = true; }
  if (text !== undefined && rec.text !== text) { rec.text = text; changed = true; }
  if (rec.active !== active) { rec.active = active; changed = true; }
  if (!infoRecords.has(id)) {
    infoRecords.set(id, rec);
    changed = true;
  }
  if (changed) {
    infoDirty = true;
  }
}

function updateInfoText(id, text) {
  const rec = infoRecords.get(id);
  if (!rec) {
    setInfoRecord(id, { label: id, text });
    return;
  }
  if (rec.text !== text) {
    rec.text = text;
    infoDirty = true;
  }
}

function toggleInfoVisibility() {
  infoVisible = !infoVisible;
  infoDirty = true;
  renderInfoPanel();
}

function refreshStaticInfo() {
  const touchControls = 'Joystick esquerdo move, direito olha; botões Pular/Colocar/Remover.';
  const kbControls = 'WASD mover, Espaço pular, Shift correr, clique esq. coloca, dir. remove, scroll troca bloco.';
  setInfoRecord('controls', { label: 'Controles', text: touchEnabled ? touchControls : kbControls });
  setInfoRecord('hud', { label: 'HUD', text: 'Pressione H para mostrar/ocultar este painel.' });
  setInfoRecord('input', { label: 'Entrada', text: touchEnabled ? 'Toque/HUD na tela' : 'Mouse + teclado' });
  infoDirty = true;
  renderInfoPanel();
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    savedSettings = data;
    if (data.gameMode && gameModeSelect.querySelector(`option[value="${data.gameMode}"]`)) {
      gameModeSelect.value = data.gameMode;
    }
    if (data.mapSize && mapSizeSelect.querySelector(`option[value="${data.mapSize}"]`)) {
      mapSizeSelect.value = data.mapSize;
    }
    if (typeof data.touchDesktop === 'boolean') {
      touchDesktopCheckbox.checked = data.touchDesktop;
    }
  } catch (e) {
    console.warn('Não foi possível ler configurações salvas', e);
  }
}

function persistSettings() {
  const data = {
    gameMode: gameModeSelect.value,
    mapSize: mapSizeSelect.value,
    touchDesktop: touchDesktopCheckbox.checked,
  };
  savedSettings = data;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Não foi possível salvar configurações', e);
  }
}

setInfoRecord('desempenho', { label: 'Desempenho', text: '-' });
setInfoRecord('posicao', { label: 'Posição', text: '-' });
setInfoRecord('mundo', { label: 'Mundo', text: '-' });
setInfoRecord('bloco', { label: 'Bloco', text: '-' });
refreshStaticInfo();

function findSpawn() {
  const spawnX = 0;
  const spawnZ = 0;
  const h = getHeight(spawnX, spawnZ) + 2;
  return new THREE.Vector3(spawnX + 0.5, h + HALF_HEIGHT, spawnZ + 0.5);
}

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyH') {
    toggleInfoVisibility();
  }
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function handlePointerLock() {
  const locked = document.pointerLockElement === renderer.domElement;
  document.body.classList.toggle('unlocked', !locked);
  if (touchEnabled) {
    document.body.classList.add('touch-ui');
    instructions.classList.add('hidden');
    return;
  }
  if (locked) {
    instructions.classList.add('hidden');
    freeCursor.style.display = 'none';
  } else if (!gameStarted) {
    instructions.classList.remove('hidden');
    freeCursor.style.display = 'block';
  } else {
    freeCursor.style.display = 'block';
  }
}

renderer.domElement.addEventListener('click', () => {
  if (touchEnabled) return;
  renderer.domElement.requestPointerLock();
  // Em alguns browsers o pointer lock pode falhar; escondemos as instruções mesmo assim após o clique.
  instructions.classList.add('hidden');
});

gameModeSelect.addEventListener('change', persistSettings);
mapSizeSelect.addEventListener('change', persistSettings);
touchDesktopCheckbox.addEventListener('change', persistSettings);

function startGame() {
  gameStarted = true;
  const size = parseInt(mapSizeSelect.value, 10) || DEFAULT_WORLD_SIZE;
  gameMode = gameModeSelect.value || 'terrain';
  const prefersTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  touchEnabled = prefersTouch || touchDesktopCheckbox.checked;
  document.body.classList.toggle('touch-ui', touchEnabled);
  persistSettings();
  resetWorld(size);
  refreshStaticInfo();
  setInfoRecord('mundo', {
    label: 'Mundo',
    text: `${WORLD_SIZE}x${WORLD_SIZE} | altura ${WORLD_HEIGHT} | ${gameMode === 'flat' ? 'Planície com árvores' : 'Terreno montanhoso'}`,
  });
  instructions.classList.add('hidden');
  if (!touchEnabled) {
    renderer.domElement.requestPointerLock();
    renderer.domElement.focus();
  }
}

startBtn.addEventListener('click', startGame);

// Impede menu de contexto para liberar o botão direito
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Atualiza cursor livre quando não estiver em pointer lock
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) return;
  freeCursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

// ----- Controles touch -----
function setupJoystick(pad, onChange) {
  const knob = pad.querySelector('.knob');
  const rect = () => pad.getBoundingClientRect();
  let active = false;
  let id = null;
  function update(e) {
    if (!active) return;
    const r = rect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const x = e.clientX - cx;
    const y = e.clientY - cy;
    const max = r.width * 0.35;
    const clampedX = Math.max(-max, Math.min(max, x));
    const clampedY = Math.max(-max, Math.min(max, y));
    knob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    onChange(clampedX / max, clampedY / max);
  }
  function end() {
    active = false;
    id = null;
    knob.style.transform = 'translate(0px, 0px)';
    onChange(0, 0);
  }
  pad.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    active = true;
    id = e.pointerId;
    pad.setPointerCapture(id);
    update(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    update(e);
  });
  pad.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    end();
  });
  pad.addEventListener('pointercancel', end);
}

setupJoystick(joyMove, (x, y) => {
  touchMove.set(x, y * -1); // invert Y para frente
});
setupJoystick(joyLook, (x, y) => {
  touchLook.set(x, y);
});

btnJump.addEventListener('click', () => { jumpQueued = true; });
btnPlace.addEventListener('click', () => { placeQueued = true; });
btnRemove.addEventListener('click', () => { removeQueued = true; });

function pickBlock() {
  if (chunkMeshes.size === 0) return null;
  raycaster.setFromCamera(centerMouse, camera);
  raycaster.near = 0.1;
  raycaster.far = INTERACT_DISTANCE;
  const meshes = Array.from(chunkMeshes.values());
  const hits = raycaster.intersectObjects(meshes, true);
  if (!hits.length) return null;
  const hit = hits[0];
  tmpNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
  tmpFaceNormal.copy(hit.face.normal).applyNormalMatrix(tmpNormalMatrix).normalize();
  return { point: hit.point.clone(), normal: tmpFaceNormal.clone() };
}

function getRemoveCoords() {
  const hit = pickBlock();
  if (!hit) return null;
  tmpPoint.copy(hit.point).addScaledVector(hit.normal, -0.001);
  return {
    bx: Math.floor(tmpPoint.x),
    by: Math.floor(tmpPoint.y),
    bz: Math.floor(tmpPoint.z),
  };
}

function getPlaceCoords() {
  const hit = pickBlock();
  if (!hit) return null;
  tmpPoint.copy(hit.point).addScaledVector(hit.normal, 0.51);
  return {
    bx: Math.floor(tmpPoint.x),
    by: Math.floor(tmpPoint.y),
    bz: Math.floor(tmpPoint.z),
  };
}

function placeBlock() {
  const target = getPlaceCoords();
  if (!target) return;
  const { bx, by, bz } = target;
  if (!isInsideWorld(bx, bz) || by < -1 || by >= WORLD_HEIGHT) return;
  if (blockIntersectsPlayer(bx, by, bz)) return;
  setBlock(bx, by, bz, selectedBlock);
  placeQueued = false;
}

function removeBlock() {
  const target = getRemoveCoords();
  if (!target) return;
  const { bx, by, bz } = target;
  if (!isInsideWorld(bx, bz) || by < -1 || by >= WORLD_HEIGHT) return;
  if (getBlock(bx, by, bz) === BLOCK.AIR) return;
  setBlock(bx, by, bz, BLOCK.AIR);
  removeQueued = false;
}

window.addEventListener('mousedown', (e) => {
  // Permite interação mesmo sem pointer lock, mas não quando overlay de instruções está ativo.
  if (!instructions.classList.contains('hidden') && document.pointerLockElement !== renderer.domElement) return;
  renderer.domElement.focus();
  if (e.button === 0) {
    placeBlock();
  } else if (e.button === 2) {
    removeBlock();
  }
});

document.addEventListener('pointerlockchange', handlePointerLock);
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const sensitivity = 0.0025;
  player.yaw -= e.movementX * sensitivity;
  player.pitch -= e.movementY * sensitivity;
  const maxPitch = Math.PI / 2 - 0.05;
  player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));
});

// ---------- Física e colisão ----------
function aabbIntersectsBlock(pos) {
  const minX = pos.x - PLAYER_RADIUS;
  const maxX = pos.x + PLAYER_RADIUS;
  const minY = pos.y - HALF_HEIGHT;
  const maxY = pos.y + HALF_HEIGHT;
  const minZ = pos.z - PLAYER_RADIUS;
  const maxZ = pos.z + PLAYER_RADIUS;

  for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
        if (getBlock(x, y, z) !== BLOCK.AIR) {
          // Check precise overlap to evitar falso positivo ao lado
          const bxMin = x;
          const bxMax = x + 1;
          const byMin = y;
          const byMax = y + 1;
          const bzMin = z;
          const bzMax = z + 1;
          if (maxX > bxMin && minX < bxMax &&
              maxY > byMin && minY < byMax &&
              maxZ > bzMin && minZ < bzMax) {
            return { x, y, z };
          }
        }
      }
    }
  }
  return null;
}

function blockIntersectsPlayer(x, y, z) {
  const minX = x;
  const maxX = x + 1;
  const minY = y;
  const maxY = y + 1;
  const minZ = z;
  const maxZ = z + 1;
  const pMinX = player.position.x - PLAYER_RADIUS;
  const pMaxX = player.position.x + PLAYER_RADIUS;
  const pMinY = player.position.y - HALF_HEIGHT;
  const pMaxY = player.position.y + HALF_HEIGHT;
  const pMinZ = player.position.z - PLAYER_RADIUS;
  const pMaxZ = player.position.z + PLAYER_RADIUS;
  return maxX > pMinX && minX < pMaxX &&
         maxY > pMinY && minY < pMaxY &&
         maxZ > pMinZ && minZ < pMaxZ;
}

function aabbIntersectsBlockSized(pos, radius, height) {
  const halfH = height * 0.5;
  const minX = pos.x - radius;
  const maxX = pos.x + radius;
  const minY = pos.y - halfH;
  const maxY = pos.y + halfH;
  const minZ = pos.z - radius;
  const maxZ = pos.z + radius;
  for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
        if (getBlock(x, y, z) !== BLOCK.AIR) {
          const bxMin = x;
          const bxMax = x + 1;
          const byMin = y;
          const byMax = y + 1;
          const bzMin = z;
          const bzMax = z + 1;
          if (maxX > bxMin && minX < bxMax &&
              maxY > byMin && minY < byMax &&
              maxZ > bzMin && minZ < bzMax) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function attemptStep(axis, amount) {
  const saved = player.position[axis];
  const savedY = player.position.y;
  player.position[axis] += amount;
  player.position.y += STEP_HEIGHT;
  if (!aabbIntersectsBlock(player.position)) {
    return true;
  }
  player.position[axis] = saved;
  player.position.y = savedY;
  return false;
}

function moveAxis(axis, amount) {
  if (amount === 0) return;
  const saved = player.position[axis];
  player.position[axis] += amount;
  const hit = aabbIntersectsBlock(player.position);
  if (hit) {
    // permite subir 1 bloco quando no chão
    if (player.onGround && attemptStep(axis, amount)) {
      return;
    }
    player.position[axis] = saved;
    player.velocity[axis] = 0;
  }
}

function applyPhysics(dt) {
  if (touchEnabled && document.pointerLockElement !== renderer.domElement) {
    const lookSpeed = 2.2;
    player.yaw -= touchLook.x * lookSpeed * dt;
    player.pitch -= touchLook.y * lookSpeed * dt;
    const maxPitch = Math.PI / 2 - 0.05;
    player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));
  }
  tmpForward.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  // right vetorial invertido para alinhar A=esquerda / D=direita
  tmpRight.set(-tmpForward.z, 0, tmpForward.x);
  tmpMove.set(0, 0, 0);

  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (keys.has('KeyW')) tmpMove.add(tmpForward);
  if (keys.has('KeyS')) tmpMove.sub(tmpForward);
  if (keys.has('KeyA')) tmpMove.sub(tmpRight);
  if (keys.has('KeyD')) tmpMove.add(tmpRight);
  if (touchEnabled && (touchMove.x !== 0 || touchMove.y !== 0)) {
    tmpMove.addScaledVector(tmpRight, touchMove.x);
    tmpMove.addScaledVector(tmpForward, touchMove.y);
  }
  if (tmpMove.lengthSq() > 0) {
    tmpMove.normalize().multiplyScalar(speed);
  }

  // aceleração simples no plano XZ
  const accel = 20;
  player.velocity.x += (tmpMove.x - player.velocity.x) * Math.min(1, accel * dt);
  player.velocity.z += (tmpMove.z - player.velocity.z) * Math.min(1, accel * dt);

  // gravidade e pulo
  player.velocity.y -= GRAVITY * dt;
  const wantsJump = keys.has('Space') || jumpQueued;
  if (player.onGround && wantsJump) {
    player.velocity.y = JUMP_FORCE;
    player.onGround = false;
    jumpQueued = false;
  }
  jumpQueued = false;

  // Movimento horizontal com colisão + degrau
  moveAxis('x', player.velocity.x * dt);
  moveAxis('z', player.velocity.z * dt);

  // Movimento vertical
  player.position.y += player.velocity.y * dt;
  const hit = aabbIntersectsBlock(player.position);
  if (hit) {
    if (player.velocity.y < 0) {
      // colidiu com o chão
      const bottom = player.position.y - HALF_HEIGHT;
      player.position.y = Math.floor(bottom) + 1 + HALF_HEIGHT + 0.001;
      player.onGround = true;
    } else if (player.velocity.y > 0) {
      const top = player.position.y + HALF_HEIGHT;
      player.position.y = Math.floor(top) - HALF_HEIGHT - 0.001;
    }
    player.velocity.y = 0;
  } else {
    player.onGround = false;
  }

  // Limite de mapa
  const minClamp = WORLD_MIN + PLAYER_RADIUS + 0.1;
  const maxClamp = WORLD_MAX - PLAYER_RADIUS - 0.1;
  let clamped = false;
  if (player.position.x < minClamp) { player.position.x = minClamp; clamped = true; }
  if (player.position.x > maxClamp) { player.position.x = maxClamp; clamped = true; }
  if (player.position.z < minClamp) { player.position.z = minClamp; clamped = true; }
  if (player.position.z > maxClamp) { player.position.z = maxClamp; clamped = true; }
  if (clamped) {
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  // Atualiza câmera
  tmpEye.copy(player.position);
  tmpEye.y += PLAYER_HEIGHT * 0.45;
  camera.position.copy(tmpEye);
  tmpLook.set(
    Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    Math.cos(player.yaw) * Math.cos(player.pitch),
  );
  tmpTarget.copy(tmpEye).add(tmpLook);
  camera.lookAt(tmpTarget);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let fpsSmoothed = 60;
let lastDt = 1 / 60;

function updateHUD(dt) {
  const safeDt = dt > 1e-5 ? dt : lastDt;
  lastDt = safeDt;
  const fps = 1 / safeDt;
  fpsSmoothed = fpsSmoothed * 0.9 + fps * 0.1;
  hudStats.textContent = `FPS: ${fpsSmoothed.toFixed(0)} | Δ: ${(safeDt * 1000).toFixed(1)} ms`;
  const p = player.position;
  hudPos.textContent = `Pos: X ${p.x.toFixed(1)} Y ${p.y.toFixed(1)} Z ${p.z.toFixed(1)}`;
  updateInfoText('desempenho', `FPS ${fpsSmoothed.toFixed(0)} | Δ ${(safeDt * 1000).toFixed(1)} ms`);
  updateInfoText('posicao', `X ${p.x.toFixed(1)} Y ${p.y.toFixed(1)} Z ${p.z.toFixed(1)}`);
  updateInfoText('mundo', `${WORLD_SIZE}x${WORLD_SIZE} | altura ${WORLD_HEIGHT} | ${gameMode === 'flat' ? 'Planície com árvores' : 'Terreno montanhoso'}`);
  const selected = paletteConfig.find((i) => i.type === selectedBlock);
  updateInfoText('bloco', selected ? selected.label : `Tipo ${selectedBlock}`);
  renderInfoPanel();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  applyPhysics(dt);
  updateVisibleChunks();
  updateCharacters(dt);
  updateHUD(dt);
  renderer.render(scene, camera);
}

// ---------- Init ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function clearWorld() {
  if (cloudsGroup) {
    cloudsGroup.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    scene.remove(cloudsGroup);
    cloudsGroup = null;
  }
  for (const [, mesh] of chunkMeshes) {
    scene.remove(mesh);
    mesh.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
  }
  chunkMeshes.clear();
  worldOverrides.clear();
  dirtyChunks.clear();
  if (charactersGroup) {
    charactersGroup.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    scene.remove(charactersGroup);
    charactersGroup = null;
  }
}

function regenerateClouds() {
  const count = Math.floor((WORLD_SIZE * WORLD_SIZE) / 256);
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  cloudsGroup = new THREE.Group();
  const baseY = WORLD_HEIGHT * 0.7;
  for (let i = 0; i < count; i++) {
    const cx = WORLD_MIN + Math.random() * WORLD_SIZE;
    const cz = WORLD_MIN + Math.random() * WORLD_SIZE;
    const puffCount = 6 + Math.floor(Math.random() * 8);
    for (let p = 0; p < puffCount; p++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(
        cx + (Math.random() - 0.5) * 6,
        baseY + Math.random() * 4,
        cz + (Math.random() - 0.5) * 6,
      );
      cloudsGroup.add(mesh);
    }
  }
  scene.add(cloudsGroup);
}

function flushDirtyChunks() {
  if (dirtyChunks.size === 0) return;
  for (const key of dirtyChunks) {
    const [cx, cz] = key.split(',').map(Number);
    rebuildChunk(cx, cz);
  }
  dirtyChunks.clear();
}

function generateTrees() {
  if (gameMode !== 'flat') return;
  const count = Math.floor((WORLD_SIZE * WORLD_SIZE) / 150);
  const minDistanceFromSpawn = 6;
  const spawn = player.position;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(WORLD_MIN + Math.random() * (WORLD_SIZE - 1));
    const z = Math.floor(WORLD_MIN + Math.random() * (WORLD_SIZE - 1));
    if (spawn.distanceToSquared(new THREE.Vector3(x + 0.5, spawn.y, z + 0.5)) < minDistanceFromSpawn * minDistanceFromSpawn) continue;
    const h = getHeight(x, z);
    const trunkHeight = 3 + Math.floor(Math.random() * 3);
    for (let y = h + 1; y <= h + trunkHeight; y++) {
      setBlock(x, y, z, BLOCK.WOOD, { skipRebuild: true });
    }
    const leafBase = h + trunkHeight;
    for (let lx = -2; lx <= 2; lx++) {
      for (let ly = 0; ly <= 2; ly++) {
        for (let lz = -2; lz <= 2; lz++) {
          if (Math.abs(lx) + Math.abs(lz) + ly > 4) continue; // forma mais esférica
          const bx = x + lx;
          const by = leafBase + ly;
          const bz = z + lz;
          if (!isInsideWorld(bx, bz) || by >= WORLD_HEIGHT) continue;
          setBlock(bx, by, bz, BLOCK.LEAF, { skipRebuild: true });
        }
      }
    }
  }
}

// ---------- Personagens voxel ----------
const charGeo = {
  head: new THREE.BoxGeometry(0.6, 0.6, 0.6),
  body: new THREE.BoxGeometry(0.7, 0.9, 0.4),
  arm: new THREE.BoxGeometry(0.25, 0.8, 0.25),
  leg: new THREE.BoxGeometry(0.28, 0.9, 0.28),
  pick: new THREE.BoxGeometry(0.8, 0.1, 0.1),
  pickHead: new THREE.BoxGeometry(0.4, 0.25, 0.15),
};
const charMat = {
  skin: new THREE.MeshLambertMaterial({ color: 0xd8b28c }),
  hair: new THREE.MeshLambertMaterial({ color: 0x4b2a17 }),
  shirt: new THREE.MeshLambertMaterial({ color: 0x3aa7c3 }),
  pants: new THREE.MeshLambertMaterial({ color: 0x335a9c }),
  boot: new THREE.MeshLambertMaterial({ color: 0x2d2d2d }),
  pickHandle: new THREE.MeshLambertMaterial({ color: 0x72512f }),
  pickMetal: new THREE.MeshLambertMaterial({ color: 0xcfd4d8 }),
};

function makeVoxelChar() {
  const g = new THREE.Group();
  const visual = new THREE.Group();
  visual.position.y = -NPC_HEIGHT * 0.5; // alinha o modelo com o centro do colisor
  g.add(visual);
  // Head
  const head = new THREE.Mesh(charGeo.head, charMat.skin);
  head.position.set(0, 1.65, 0);
  visual.add(head);
  // Hair cap
  const hair = new THREE.Mesh(charGeo.head, charMat.hair);
  hair.scale.set(1.02, 1.02, 1.02);
  hair.position.copy(head.position).add(new THREE.Vector3(0, 0.03, 0));
  hair.castShadow = false;
  visual.add(hair);
  // Body
  const body = new THREE.Mesh(charGeo.body, charMat.shirt);
  body.position.set(0, 0.9, 0);
  visual.add(body);
  // Arms
  const armL = new THREE.Mesh(charGeo.arm, charMat.skin);
  armL.position.set(-0.48, 0.95, 0);
  visual.add(armL);
  const armR = new THREE.Mesh(charGeo.arm, charMat.skin);
  armR.position.set(0.48, 0.95, 0);
  visual.add(armR);
  // Legs
  const legL = new THREE.Mesh(charGeo.leg, charMat.pants);
  legL.position.set(-0.18, 0.45, 0); // base no chão (altura 0.9 => vai de 0 a 0.9)
  visual.add(legL);
  const legR = new THREE.Mesh(charGeo.leg, charMat.pants);
  legR.position.set(0.18, 0.45, 0);
  visual.add(legR);
  // Boots
  const bootL = new THREE.Mesh(charGeo.leg, charMat.boot);
  bootL.scale.y = 0.35; // ~0.315 altura
  bootL.position.set(-0.18, 0.1575, 0); // vai de 0 a ~0.315
  visual.add(bootL);
  const bootR = new THREE.Mesh(charGeo.leg, charMat.boot);
  bootR.scale.y = 0.35;
  bootR.position.set(0.18, 0.1575, 0);
  visual.add(bootR);
  // Pickaxe
  const pickHandle = new THREE.Mesh(charGeo.pick, charMat.pickHandle);
  pickHandle.rotation.z = Math.PI * 0.25;
  pickHandle.position.set(0.8, 1.2, 0.05);
  visual.add(pickHandle);
  const pickHead = new THREE.Mesh(charGeo.pickHead, charMat.pickMetal);
  pickHead.rotation.z = Math.PI * -0.25;
  pickHead.position.set(1.0, 1.35, 0.05);
  visual.add(pickHead);
  g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  g.userData.heading = new THREE.Vector2((Math.random() * 2 - 1), (Math.random() * 2 - 1)).normalize();
  g.userData.timer = 1 + Math.random() * 2;
  g.userData.velY = 0;
  g.userData.onGround = false;
  g.userData.animPhase = Math.random() * Math.PI * 2;
  g.userData.limbs = { armL, armR, legL, legR };
  g.userData.breakCooldown = 0;
  return g;
}

function spawnCharacters() {
  if (gameMode !== 'flat') return;
  charactersGroup = new THREE.Group();
  const spawnCount = Math.max(3, Math.floor(WORLD_SIZE / 24));
  const minDistance = 5;
  const playerPos = player.position.clone();
  for (let i = 0; i < spawnCount; i++) {
    const gx = WORLD_MIN + Math.random() * (WORLD_SIZE - 1);
    const gz = WORLD_MIN + Math.random() * (WORLD_SIZE - 1);
    const h = getHeight(Math.floor(gx), Math.floor(gz));
    // h é o nível do bloco de topo; bloco ocupa [h, h+1). Posicionamos acima do bloco.
    const pos = new THREE.Vector3(gx + 0.5, h + 1 + NPC_HEIGHT * 0.5 + 0.02, gz + 0.5);
    if (pos.distanceToSquared(playerPos) < minDistance * minDistance) continue;
    const char = makeVoxelChar();
    char.position.copy(pos);
    char.rotation.y = Math.random() * Math.PI * 2;
    char.userData.onGround = true;
    char.userData.velY = 0;
    charactersGroup.add(char);
  }
  scene.add(charactersGroup);
}

function updateCharacters(dt) {
  if (!charactersGroup) return;
  const margin = 1.5;
  charactersGroup.children.forEach((char) => {
    if (!char.userData.heading) {
      char.userData.heading = new THREE.Vector2(1, 0);
      char.userData.timer = 1;
      char.userData.velY = 0;
      char.userData.onGround = false;
      char.userData.breakCooldown = 0;
    }
    char.userData.breakCooldown = Math.max(0, (char.userData.breakCooldown || 0) - dt);
    char.userData.timer -= dt;
    if (char.userData.timer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      char.userData.heading.set(Math.cos(angle), Math.sin(angle));
      char.userData.timer = 1 + Math.random() * 2.5;
    }
    const move2D = char.userData.heading;
    // impede saída do mundo
    if (char.position.x < WORLD_MIN + margin || char.position.x > WORLD_MAX - margin ||
        char.position.z < WORLD_MIN + margin || char.position.z > WORLD_MAX - margin) {
      move2D.multiplyScalar(-1);
    }

    // Movimento horizontal com colisão e degrau
    const moveX = move2D.x * NPC_SPEED * dt;
    const moveZ = move2D.y * NPC_SPEED * dt;
    const halfH = NPC_HEIGHT * 0.5;

    const tryBreakBlockAhead = (axis, amount) => {
      const sign = Math.sign(amount);
      if (sign === 0) return false;
      const radius = NPC_RADIUS;
      const half = NPC_HEIGHT * 0.5;
      let targetX = Math.floor(char.position.x);
      let targetZ = Math.floor(char.position.z);
      if (axis === 'x') {
        targetX = Math.floor(char.position.x + (radius + 0.05) * sign);
      } else {
        targetZ = Math.floor(char.position.z + (radius + 0.05) * sign);
      }
      const y0 = Math.floor(char.position.y - half);
      const y1 = Math.floor(char.position.y + half);
      for (let y = y0; y <= y1; y++) {
        if (!isInsideWorld(targetX, targetZ)) continue;
        const type = getBlock(targetX, y, targetZ);
        if (type !== BLOCK.AIR) {
          setBlock(targetX, y, targetZ, BLOCK.AIR);
          return true;
        }
      }
      return false;
    };

    const attemptStepNpc = (axis, amount) => {
      const saved = char.position[axis];
      const savedY = char.position.y;
      char.position[axis] += amount;
      char.position.y += NPC_STEP_HEIGHT;
      const hit = aabbIntersectsBlockSized(char.position, NPC_RADIUS, NPC_HEIGHT);
      if (!hit) return true;
      char.position[axis] = saved;
      char.position.y = savedY;
      return false;
    };

    const moveAxisNpc = (axis, amount) => {
      if (amount === 0) return false;
      const saved = char.position[axis];
      char.position[axis] += amount;
      const hit = aabbIntersectsBlockSized(char.position, NPC_RADIUS, NPC_HEIGHT);
      if (hit) {
        if (char.userData.onGround && attemptStepNpc(axis, amount)) {
          return false;
        }
        char.position[axis] = saved;
        if (char.userData.onGround) {
          if ((char.userData.breakCooldown || 0) <= 0 && tryBreakBlockAhead(axis, amount)) {
            char.userData.breakCooldown = 0.6;
          } else {
            char.userData.velY = NPC_JUMP;
            char.userData.onGround = false;
            // impulso para fora do buraco
            char.position[axis] += amount * 0.25;
          }
        }
        return true;
      }
      return false;
    };

    moveAxisNpc('x', moveX);
    moveAxisNpc('z', moveZ);

    // Gravidade
    char.userData.velY -= GRAVITY * dt;
    char.position.y += char.userData.velY * dt;
    const hit = aabbIntersectsBlockSized(char.position, NPC_RADIUS, NPC_HEIGHT);
    if (hit) {
      if (char.userData.velY < 0) {
        const bottom = char.position.y - halfH;
        char.position.y = Math.floor(bottom) + 1 + halfH + 0.001;
        char.userData.onGround = true;
      } else if (char.userData.velY > 0) {
        const top = char.position.y + halfH;
        char.position.y = Math.floor(top) - halfH - 0.001;
      }
      char.userData.velY = 0;
    } else {
      char.userData.onGround = false;
    }

    // Se cair de borda de bloco, apenas deixa gravidade agir; sem snap forçado.
    char.rotation.y = Math.atan2(move2D.x, move2D.y);

    // Animação simples de caminhada
    const limbs = char.userData.limbs;
    if (limbs) {
      const moveSpeed = Math.hypot(moveX, moveZ) / Math.max(dt, 1e-5);
      const intensity = Math.min(1, moveSpeed / NPC_SPEED);
      const phase = (char.userData.animPhase || 0) + dt * 8 * (intensity > 0.05 ? 1 : 0);
      char.userData.animPhase = phase;
      const swingArm = Math.sin(phase) * 0.6 * intensity;
      const swingLeg = Math.sin(phase + Math.PI) * 0.6 * intensity;
      limbs.armL.rotation.x = swingArm;
      limbs.armR.rotation.x = -swingArm;
      limbs.legL.rotation.x = swingLeg;
      limbs.legR.rotation.x = -swingLeg;
    }

    // Limite de mapa para NPCs
    const minClamp = WORLD_MIN + NPC_RADIUS + 0.1;
    const maxClamp = WORLD_MAX - NPC_RADIUS - 0.1;
    if (char.position.x < minClamp) { char.position.x = minClamp; char.userData.heading.x *= -1; }
    if (char.position.x > maxClamp) { char.position.x = maxClamp; char.userData.heading.x *= -1; }
    if (char.position.z < minClamp) { char.position.z = minClamp; char.userData.heading.y *= -1; }
    if (char.position.z > maxClamp) { char.position.z = maxClamp; char.userData.heading.y *= -1; }
  });
}

function resetWorld(size) {
  WORLD_SIZE = size;
  WORLD_MIN = -WORLD_SIZE / 2;
  WORLD_MAX = WORLD_MIN + WORLD_SIZE;
  WORLD_HEIGHT = Math.max(32, Math.min(80, Math.floor(size * 0.75)));
  clearWorld();
  player.position.copy(findSpawn());
  player.velocity.set(0, 0, 0);
  lastChunkX = null;
  lastChunkZ = null;
  generateTrees();
  flushDirtyChunks();
  updateVisibleChunks(true);
  regenerateClouds();
  spawnCharacters();
}

function buildPalette() {
  paletteEl.innerHTML = '';
  paletteConfig.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'palette-item';
    const c = blockColor(item.type, 0, 0, 0);
    btn.style.background = `rgb(${Math.floor(c.r * 255)}, ${Math.floor(c.g * 255)}, ${Math.floor(c.b * 255)})`;
    btn.title = item.label;
    btn.addEventListener('click', () => {
      selectedBlock = item.type;
      document.querySelectorAll('.palette-item').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
    });
    paletteEl.appendChild(btn);
  });
  // default selection
  if (paletteEl.firstChild) paletteEl.firstChild.classList.add('selected');
}

buildPalette();
loadSavedSettings();
resetWorld(DEFAULT_WORLD_SIZE);
updateVisibleChunks(true);
animate();
