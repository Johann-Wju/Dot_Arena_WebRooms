// =========================
// Constants & DOM Elements
// =========================
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const infoDisplay = document.getElementById('info-display');
const resetBtn = document.getElementById('reset-btn');
const leaderboardList = document.getElementById('leaderboard-list');
const sizeDisplay = document.getElementById('size-display');
const messageDiv = document.getElementById('message');
const powerupTimers = {}; // id: timeout ID

const serverAddr = 'wss://nosch.uber.space/web-rooms/';
const socket = new WebSocket(serverAddr);

// =========================
// Game State
// =========================
let clientId = null;
let clientCount = 0;
let targetPosition = null;
let messageTimeout;
let powerup = null;

let powerupMessage = '';
let powerupMessageOpacity = 0;
let powerupMessageHue = 0;
let powerupMessageTimeout = null;
let powerupRemainingTime = 0;

const snakes = {};              // { id: snakeObject }
const food = [];                // Array of food objects
const snakeLastUpdated = {};    // { id: timestamp }

// =========================
// Initialization
// =========================
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
resetBtn.addEventListener('click', resetGame);
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'r') resetGame(); });
canvas.addEventListener('mousemove', (e) => targetPosition = { x: e.clientX, y: e.clientY });
canvas.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  targetPosition = { x: t.clientX, y: t.clientY };
});
window.addEventListener('beforeunload', () => {
  if (socket.readyState === WebSocket.OPEN && clientId !== null) {
    sendRequest('*set-data*', `snake-${clientId}`, null);
  }
});

// =========================
// Utility Functions
// =========================
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function getRandomBrightColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 90 + Math.random() * 10;
  const l = 50 + Math.random() * 10;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function sendRequest(...msg) {
  socket.send(JSON.stringify(msg));
}

function subscribeSnakeKey(id) {
  sendRequest('*subscribe-data*', `snake-${id}`);
}

function unsubscribeSnakeKey(id) {
  sendRequest('*unsubscribe-data*', `snake-${id}`);
}

function showMessage(text, duration = 3000) {
  clearTimeout(messageTimeout);
  messageDiv.textContent = text;
  messageDiv.style.opacity = '1';
  messageTimeout = setTimeout(() => {
    messageDiv.style.opacity = '0';
  }, duration);
}

// =========================
// Snake Management
// =========================
function createSnake() {
  const padding = 50;
  const x = padding + Math.random() * (canvas.width - 2 * padding);
  const y = padding + Math.random() * (canvas.height - 2 * padding);
  // TODO 
  // Bug when snakesize excedes 400-500 length. Weird behaviour of food spawning
  // Probably a server High Ping problem
  const body = Array.from({ length: 10 }, (_, i) => ({ x: x - i * 5, y }));
  return {
    x, y, dx: 1, dy: 0, body, size: 10,
    color: getRandomBrightColor(),
    hasPowerup: false,
    rainbowPhase: 0
  };
}

function cleanupSnake(id) {
  console.log(`[WS] Cleaning up snake #${id}`);
  const hadPowerup = snakes[id]?.hasPowerup;
  delete snakes[id];
  unsubscribeSnakeKey(id);
  updateLeaderboard();
  draw();

  if (hadPowerup) {
    checkAndRespawnPowerup(); // Recheck if respawn should start
  }
}

function resetGame() {
  if (clientId !== 0) return console.warn('Only Player #1 can reset.');
  const oldColor = snakes[clientId]?.color || getRandomBrightColor();
  snakes[clientId] = createSnake();
  snakes[clientId].color = oldColor;
  food.length = 0;
  spawnFood();
  sendRequest('*set-data*', `snake-${clientId}`, snakes[clientId]);
  sendRequest('*set-data*', 'shared-food', food);
  updateInfo();
  draw();
}

// =========================
// Food Management
// =========================
function spawnFood() {
  if (clientId !== 0) return;
  const padding = 10;
  const toAdd = 40 - food.length;
  for (let i = 0; i < toAdd; i++) {
    food.push({
      x: padding + Math.random() * (canvas.width - 2 * padding),
      y: padding + Math.random() * (canvas.height - 2 * padding),
    });
  }
  sendRequest('*set-data*', 'shared-food', food);
}

// =========================
// UI Functions
// =========================
function updateInfo() {
  infoDisplay.textContent = clientId === null
    ? 'Connecting...'
    : `You: #${clientId + 1} | Players: ${clientCount}`;
}

function updateLeaderboard() {
  leaderboardList.innerHTML = '';
  Object.entries(snakes)
    .sort(([, a], [, b]) => b.size - a.size)
    .slice(0, 5)
    .forEach(([id, s]) => {
      const li = document.createElement('li');
      li.textContent = `#${parseInt(id) + 1}: ${s.size}`;
      leaderboardList.appendChild(li);
    });
}

function updateSizeDisplay() {
  const s = snakes[clientId];
  sizeDisplay.textContent = s ? `Size: ${s.size}` : '';
}

// =========================
// WebSocket Events
// =========================
socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'snake-room');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-client-entries*');
  sendRequest('*subscribe-data*', 'shared-food');
  sendRequest('*subscribe-data*', 'shared-powerup');

  setInterval(() => socket.send(''), 30000);
});

socket.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  const [selector, payload] = msg;

  if (selector.startsWith('snake-')) {
    const id = +selector.split('-')[1];
    if (id !== clientId) {
      if (payload === null) {
        delete snakes[id];
        updateLeaderboard();
        draw();
      } else {
        snakes[id] = {
          ...payload,
          color: snakes[id]?.color || payload.color || getRandomBrightColor()
        };
        snakeLastUpdated[id] = Date.now();
      }
    }
    return;
  }

  switch (selector) {
    case '*client-id*':
      clientId = payload;
      snakes[clientId] = createSnake();
      if (clientId !== 0) resetBtn.style.display = 'none';
      if (clientId === 0) {
        spawnFood();
        startStaleSnakeCleanup();
        setInterval(spawnFood, 500);
        checkAndRespawnPowerup();
      }
      updateInfo();
      showMessage(`You joined as Player #${clientId + 1}`);
      draw();
      break;

    case '*client-count*':
      clientCount = payload;
      updateInfo();
      for (let i = 0; i < clientCount; i++) {
        if (!snakes[i]) subscribeSnakeKey(i);
      }
      subscribeSnakeKey(clientId);
      break;

    case '*client-enter*':
      clientCount++;
      updateInfo();
      if (payload !== clientId) subscribeSnakeKey(payload);
      break;

    case '*client-exit*':
      clientCount--;
      cleanupSnake(payload);
      updateInfo();
      break;

    case 'shared-food':
      food.length = 0;
      food.push(...payload);
      break;

    case 'shared-powerup':
      powerup = payload;
      break;
  }
});

socket.addEventListener('close', () => {
  infoDisplay.textContent = 'Disconnected';
  if (snakes[clientId]) {
    delete snakes[clientId];
    unsubscribeSnakeKey(clientId);
    updateLeaderboard();
    draw();
  }
});

// =========================
// Game Loop & Cleanup
// =========================
function gameLoop() {
  const s = snakes[clientId];
  if (!s) return requestAnimationFrame(gameLoop);

  if (targetPosition) {
    const dx = targetPosition.x - s.x;
    const dy = targetPosition.y - s.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      s.dx = dx / len;
      s.dy = dy / len;
    }
  }

  const baseSpeed = 1;
  const speed = s.hasPowerup ? baseSpeed * 1.5 : baseSpeed;
  s.x = Math.max(0, Math.min(canvas.width, s.x + s.dx * speed));
  s.y = Math.max(0, Math.min(canvas.height, s.y + s.dy * speed));
  s.body.unshift({ x: s.x, y: s.y });
  if (s.body.length > s.size) s.body.pop();

  let ate = false;
  for (let i = food.length - 1; i >= 0; i--) {
    if (Math.hypot(s.x - food[i].x, s.y - food[i].y) < 10) {
      s.size += 2;
      food.splice(i, 1);
      ate = true;
    }
  }

  if (ate) sendRequest('*set-data*', 'shared-food', food);
  sendRequest('*set-data*', `snake-${clientId}`, s);

  if (powerup && Math.hypot(s.x - powerup.x, s.y - powerup.y) < 10) {
    s.hasPowerup = true;
    powerup = null;
    sendRequest('*set-data*', 'shared-powerup', null);

    if (powerupTimers[clientId]) clearTimeout(powerupTimers[clientId]);
    powerupTimers[clientId] = setTimeout(() => {
      snakes[clientId].hasPowerup = false;

      const fadeDuration = 500;
      const fadeSteps = 30;
      let step = 0;
      const fadeInterval = setInterval(() => {
        step++;
        powerupMessageOpacity = Math.max(0, 1 - step / fadeSteps);
        if (step >= fadeSteps) clearInterval(fadeInterval);
      }, fadeDuration / fadeSteps);

      checkAndRespawnPowerup(); // <-- Trigger next spawn check
    }, 10000);

    powerupMessage = 'Powered Up!';
    powerupMessageOpacity = 1;
    powerupMessageHue = 0;

    powerupRemainingTime = 25; // Initialize 10 seconds timer here
  }

  if (s.hasPowerup && powerupRemainingTime > 0) {
    powerupRemainingTime -= 1 / 60; // assuming 60fps
    if (powerupRemainingTime < 0) powerupRemainingTime = 0;
  } else {
    powerupRemainingTime = 0;
  }

  draw();
  updateLeaderboard();
  updateSizeDisplay();
  requestAnimationFrame(gameLoop);
}

function checkAndRespawnPowerup() {
  if (clientId !== 0) return; // Only host manages powerups

  const anyonePoweredUp = Object.values(snakes).some(s => s.hasPowerup);

  if (!anyonePoweredUp && !powerup) {
    setTimeout(() => {
      // Double-check no one gained powerup during the wait
      const stillNone = Object.values(snakes).every(s => !s.hasPowerup);
      if (!powerup && stillNone) {
        const padding = 10;
        powerup = {
          x: padding + Math.random() * (canvas.width - 2 * padding),
          y: padding + Math.random() * (canvas.height - 2 * padding)
        };
        sendRequest('*set-data*', 'shared-powerup', powerup);
      }
    }, 20000); // Wait 20 seconds before respawning
  }
}

function startStaleSnakeCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const id in snakeLastUpdated) {
      if (+id !== clientId && now - snakeLastUpdated[id] > 5000) {
        delete snakes[id];
        delete snakeLastUpdated[id];
        sendRequest('*set-data*', `snake-${id}`, null);
        updateLeaderboard();
        draw();
      }
    }
  }, 1000);
}

// =========================
// Rendering
// =========================
function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'lime';
  food.forEach(({ x, y }) => {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  if (powerup) {
    // Outer glow
    const gradient = ctx.createRadialGradient(
      powerup.x, powerup.y, 0,
      powerup.x, powerup.y, 20
    );
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)'); // Bright gold center
    gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');   // Transparent outer

    ctx.beginPath();
    ctx.fillStyle = gradient;
    ctx.arc(powerup.x, powerup.y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Main circle with stroke
    ctx.beginPath();
    ctx.strokeStyle = 'gold';
    ctx.lineWidth = 3;
    ctx.arc(powerup.x, powerup.y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const id in snakes) {
    const s = snakes[id];

    if (s.hasPowerup) {
      // Cycle hue for rainbow effect
      s.rainbowPhase = (s.rainbowPhase + 5) % 360;
      ctx.fillStyle = `hsl(${s.rainbowPhase}, 100%, 50%)`;
    } else {
      ctx.fillStyle = s.color;
    }

    s.body.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    const head = s.body[0];
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`#${+id + 1}`, head.x, head.y - 10);
  }

  if (powerupMessageOpacity > 0) {
    powerupMessageHue = (powerupMessageHue + 4) % 360;
    ctx.save();
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsla(${powerupMessageHue}, 100%, 50%, ${powerupMessageOpacity})`;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 8;
    ctx.fillText(powerupMessage, canvas.width / 2, canvas.height / 2);

    // NEW: Draw timer below
    if (powerupRemainingTime > 0) {
      ctx.font = '32px Arial';
      ctx.fillText(powerupRemainingTime.toFixed(1) + 's', canvas.width / 2, canvas.height / 2 + 60);
    }

    ctx.restore();
  }
}

requestAnimationFrame(gameLoop);