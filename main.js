import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';

// ---------- Configurações principais ----------
const WORLD_SIZE = 64; // blocos por eixo X/Z
const CHUNK_SIZE = 16;
const VIEW_DISTANCE_CHUNKS = 3; // raio de chunks carregados
const BLOCK_SIZE = 1;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;
const STEP_HEIGHT = 0.6; // altura máxima do degrau (≈1 bloco)
const GRAVITY = 30;
const WALK_SPEED = 6;
const RUN_SPEED = 9;
const JUMP_FORCE = 12; // pulo mais alto
const WORLD_MIN = -WORLD_SIZE / 2;
const WORLD_MAX = WORLD_MIN + WORLD_SIZE;
const INTERACT_DISTANCE = 8;

// ---------- DOM / HUD ----------
const hudStats = document.getElementById('stats');
const hudPos = document.getElementById('pos');
const instructions = document.getElementById('instructions');
const startBtn = document.getElementById('start-btn');

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

// ---------- Dados do mundo ----------
const chunkMeshes = new Map(); // chave "cx,cz" -> Mesh
const tempColor = new THREE.Color();
const worldOverrides = new Map(); // chave "x,y,z" -> tipo de bloco

const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
};

// ---------- Utilidades de ruído leve (determinístico) ----------
function pseudoNoise(x, z) {
  const s = Math.sin(x * 0.143 + z * 0.173) * 43758.5453;
  return s - Math.floor(s);
}

function getHeight(x, z) {
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

function setBlock(x, y, z, type) {
  const key = `${x},${y},${z}`;
  if (!isInsideWorld(x, z)) return;
  if (type === BLOCK.AIR) {
    worldOverrides.set(key, BLOCK.AIR);
  } else {
    worldOverrides.set(key, type);
  }
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
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

function blockColor(type, y) {
  if (type === BLOCK.GRASS) return tempColor.setRGB(0.56, 0.86, 0.34);
  if (type === BLOCK.DIRT) return tempColor.setRGB(0.58, 0.42, 0.26);
  return tempColor.setRGB(0.6, 0.6, 0.6);
}

function buildChunkGeometry(cx, cz) {
  const startX = cx * CHUNK_SIZE;
  const startZ = cz * CHUNK_SIZE;
  if (startX + CHUNK_SIZE <= WORLD_MIN || startX >= WORLD_MAX) return null;
  if (startZ + CHUNK_SIZE <= WORLD_MIN || startZ >= WORLD_MAX) return null;

  const positions = [];
  const normals = [];
  const colors = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    const worldX = startX + x;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldZ = startZ + z;
      const h = getHeight(worldX, worldZ);
      for (let y = 0; y <= h; y++) {
        const type = y === h ? BLOCK.GRASS : BLOCK.DIRT;
        const bx = worldX;
        const by = y;
        const bz = worldZ;
        for (let f = 0; f < FACE_DEFS.length; f++) {
          const face = FACE_DEFS[f];
          const nx = bx + face.dir[0];
          const ny = by + face.dir[1];
          const nz = bz + face.dir[2];
          if (getBlock(nx, ny, nz) !== BLOCK.AIR) continue; // remove faces internas
          const c = blockColor(type, y);
          const corners = face.corners;
          // Dois triângulos por face
          for (let i = 0; i < 6; i++) {
            const idx = [0, 1, 2, 0, 2, 3][i];
            const corner = corners[idx];
            positions.push(
              bx + corner[0],
              by + corner[1],
              bz + corner[2],
            );
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            colors.push(c.r, c.g, c.b);
          }
        }
      }
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function ensureChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunkMeshes.has(key)) return;
  const geom = buildChunkGeometry(cx, cz);
  if (!geom) return;
  const mesh = new THREE.Mesh(geom, chunkMaterial);
  mesh.frustumCulled = true;
  chunkMeshes.set(key, mesh);
  scene.add(mesh);
}

function rebuildChunk(cx, cz) {
  const key = `${cx},${cz}`;
  const existing = chunkMeshes.get(key);
  if (existing) {
    scene.remove(existing);
    existing.geometry.dispose();
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
      mesh.geometry.dispose();
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
const raycaster = new THREE.Raycaster();
const centerMouse = new THREE.Vector2(0, 0);

function findSpawn() {
  const spawnX = 0;
  const spawnZ = 0;
  const h = getHeight(spawnX, spawnZ) + 2;
  return new THREE.Vector3(spawnX + 0.5, h + HALF_HEIGHT, spawnZ + 0.5);
}

player.position.copy(findSpawn());

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function handlePointerLock() {
  if (document.pointerLockElement === renderer.domElement) {
    instructions.classList.add('hidden');
  } else {
    instructions.classList.remove('hidden');
  }
}

renderer.domElement.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
  // Em alguns browsers o pointer lock pode falhar; escondemos as instruções mesmo assim após o clique.
  instructions.classList.add('hidden');
});

function startGame() {
  instructions.classList.add('hidden');
  renderer.domElement.requestPointerLock();
  renderer.domElement.focus();
}

startBtn.addEventListener('click', startGame);

// Impede menu de contexto para liberar o botão direito
window.addEventListener('contextmenu', (e) => e.preventDefault());

function pickBlock() {
  if (chunkMeshes.size === 0) return null;
  raycaster.setFromCamera(centerMouse, camera);
  raycaster.near = 0.1;
  raycaster.far = INTERACT_DISTANCE;
  const meshes = Array.from(chunkMeshes.values());
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const hit = hits[0];
  tmpNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
  tmpFaceNormal.copy(hit.face.normal).applyNormalMatrix(tmpNormalMatrix).normalize();
  return { point: hit.point.clone(), normal: tmpFaceNormal.clone() };
}

function placeBlock() {
  const hit = pickBlock();
  if (!hit) return;
  tmpPoint.copy(hit.point).addScaledVector(hit.normal, 0.5);
  const bx = Math.floor(tmpPoint.x);
  const by = Math.floor(tmpPoint.y);
  const bz = Math.floor(tmpPoint.z);
  if (!isInsideWorld(bx, bz) || by < -8 || by > 60) return;
  if (blockIntersectsPlayer(bx, by, bz)) return;
  setBlock(bx, by, bz, BLOCK.GRASS);
}

function removeBlock() {
  const hit = pickBlock();
  if (!hit) return;
  tmpPoint.copy(hit.point).addScaledVector(hit.normal, -0.01);
  const bx = Math.floor(tmpPoint.x);
  const by = Math.floor(tmpPoint.y);
  const bz = Math.floor(tmpPoint.z);
  if (getBlock(bx, by, bz) === BLOCK.AIR) return;
  setBlock(bx, by, bz, BLOCK.AIR);
}

window.addEventListener('mousedown', (e) => {
  // Permite interação mesmo sem pointer lock, mas não quando overlay de instruções está ativo.
  if (!instructions.classList.contains('hidden') && document.pointerLockElement !== renderer.domElement) return;
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
  tmpForward.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  tmpRight.set(tmpForward.z, 0, -tmpForward.x);
  tmpMove.set(0, 0, 0);

  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (keys.has('KeyW')) tmpMove.add(tmpForward);
  if (keys.has('KeyS')) tmpMove.sub(tmpForward);
  if (keys.has('KeyA')) tmpMove.sub(tmpRight);
  if (keys.has('KeyD')) tmpMove.add(tmpRight);
  if (tmpMove.lengthSq() > 0) {
    tmpMove.normalize().multiplyScalar(speed);
  }

  // aceleração simples no plano XZ
  const accel = 20;
  player.velocity.x += (tmpMove.x - player.velocity.x) * Math.min(1, accel * dt);
  player.velocity.z += (tmpMove.z - player.velocity.z) * Math.min(1, accel * dt);

  // gravidade e pulo
  player.velocity.y -= GRAVITY * dt;
  if (player.onGround && keys.has('Space')) {
    player.velocity.y = JUMP_FORCE;
    player.onGround = false;
  }

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
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  applyPhysics(dt);
  updateVisibleChunks();
  updateHUD(dt);
  renderer.render(scene, camera);
}

// ---------- Init ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

updateVisibleChunks(true);
animate();
