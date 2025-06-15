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

let lastSendTime = 0;
const SEND_INTERVAL = 10; // milliseconds

// Changed to Dots
const dots = {};              // { id: dotObject }
const food = [];   // Array of food objects
// Changed to Dot
const dotLastUpdated = {};    // { id: timestamp }

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
    sendRequest('*set-data*', `dot-${clientId}`, null);
  }
});

// =========================
// Utility Functions
// =========================
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

let foodUpdateTimeout;
function delayedFoodSync() {
  clearTimeout(foodUpdateTimeout);
  foodUpdateTimeout = setTimeout(() => {
    sendRequest('*set-data*', 'shared-food', food);
  }, 100);
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

function subscribeDotKey(id) {
  sendRequest('*subscribe-data*', `dot-${id}`);
}

function unsubscribeDotKey(id) {
  sendRequest('*unsubscribe-data*', `dot-${id}`);
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
// Dot Management
// =========================
function createDot() {
  const padding = 50;
  const x = padding + Math.random() * (canvas.width - 2 * padding);
  const y = padding + Math.random() * (canvas.height - 2 * padding);
  return {
    x, y, dx: 1, dy: 0, size: 10,
    color: getRandomBrightColor(),
    hasPowerup: false,
    rainbowPhase: 0
  };
}

function cleanupDot(id) {
  console.log(`[WS] Cleaning up dot #${id}`);
  const hadPowerup = dots[id]?.hasPowerup;
  delete dots[id];
  unsubscribeDotKey(id);
  updateLeaderboard();
  draw();

  if (hadPowerup) {
    checkAndRespawnPowerup(); // Recheck if respawn should start
  }
}

function resetGame() {
  if (clientId !== 0) return console.warn('Only Player #1 can reset.');
  const oldColor = dots[clientId]?.color || getRandomBrightColor();
  dots[clientId] = createDot();
  dots[clientId].color = oldColor;
  food.length = 0;
  spawnFood();
  sendRequest('*set-data*', `dot-${clientId}`, dots[clientId]);
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
  Object.entries(dots)
    .sort(([, a], [, b]) => b.size - a.size)
    .slice(0, 5)
    .forEach(([id, s]) => {
      const li = document.createElement('li');
      li.textContent = `#${parseInt(id) + 1}: ${s.size}`;
      leaderboardList.appendChild(li);
    });
}

function updateSizeDisplay() {
  const s = dots[clientId];
  sizeDisplay.textContent = s ? `Size: ${s.size}` : '';
}

// =========================
// WebSocket Events
// =========================
socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'dot-arena-room');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-client-entries*');
  sendRequest('*subscribe-data*', 'shared-food');
  sendRequest('*subscribe-data*', 'shared-powerup');

  setInterval(() => socket.send(''), 30000);
});

socket.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  const [selector, payload] = msg;

  if (selector.startsWith('dot-')) {
    const id = +selector.split('-')[1];
    if (id !== clientId) {
      if (payload === null) {
        delete dots[id];
        updateLeaderboard();
        draw();
      } else {
        const s = dots[id] || createDot();
        s.x = payload.x;
        s.y = payload.y;
        s.dx = payload.dx;
        s.dy = payload.dy;
        s.size = payload.size;
        s.hasPowerup = payload.hasPowerup;
        if (payload.color) s.color = payload.color;

        dots[id] = s;
        dotLastUpdated[id] = Date.now();;
        dotLastUpdated[id] = Date.now();
      }
    }
    return;
  }

  switch (selector) {
    case '*client-id*':
      clientId = payload;
      dots[clientId] = createDot();
      if (clientId !== 0) resetBtn.style.display = 'none';
      if (clientId === 0) {
        spawnFood();
        startStaleDotCleanup();
        setInterval(() => {
          if (food.length < 40) spawnFood();
        }, 1000);
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
        if (!dots[i]) subscribeDotKey(i);
      }
      subscribeDotKey(clientId);
      break;

    case '*client-enter*':
      clientCount++;
      updateInfo();
      if (payload !== clientId) subscribeDotKey(payload);
      break;

    case '*client-exit*':
      clientCount--;
      cleanupDot(payload);
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
  if (dots[clientId]) {
    delete dots[clientId];
    unsubscribeDotKey(clientId);
    updateLeaderboard();
    draw();
  }
});

// =========================
// Game Loop & Cleanup
// =========================
function gameLoop() {
  const s = dots[clientId];
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

  let ate = false;
  for (let i = food.length - 1; i >= 0; i--) {
    if (Math.hypot(s.x - food[i].x, s.y - food[i].y) < 10) {
      s.size += 2;
      food.splice(i, 1);
      ate = true;
    }
  }

  if (ate) delayedFoodSync();
  const now = Date.now();
  if (now - lastSendTime > SEND_INTERVAL) {
    lastSendTime = now;
    sendRequest('*set-data*', `dot-${clientId}`, {
      x: s.x,
      y: s.y,
      dx: s.dx,
      dy: s.dy,
      size: s.size,
      hasPowerup: s.hasPowerup,
      color: s.color, // include so other clients can retain correct color
    });
  }

  if (powerup && Math.hypot(s.x - powerup.x, s.y - powerup.y) < 10) {
    s.hasPowerup = true;
    powerup = null;
    sendRequest('*set-data*', 'shared-powerup', null);

    if (powerupTimers[clientId]) clearTimeout(powerupTimers[clientId]);
    powerupTimers[clientId] = setTimeout(() => {
      dots[clientId].hasPowerup = false;

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

  const anyonePoweredUp = Object.values(dots).some(s => s.hasPowerup);

  if (!anyonePoweredUp && !powerup) {
    setTimeout(() => {
      // Double-check no one gained powerup during the wait
      const stillNone = Object.values(dots).every(s => !s.hasPowerup);
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

function startStaleDotCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const id in dotLastUpdated) {
      if (+id !== clientId && now - dotLastUpdated[id] > 5000) {
        delete dots[id];
        delete dotLastUpdated[id];
        sendRequest('*set-data*', `dot-${id}`, null);
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

  for (const id in dots) {
    const s = dots[id];

    if (s.hasPowerup) {
      // Cycle hue for rainbow effect
      s.rainbowPhase = (s.rainbowPhase + 5) % 360;
      ctx.fillStyle = `hsl(${s.rainbowPhase}, 100%, 50%)`;
    } else {
      ctx.fillStyle = s.color;
    }

    ctx.beginPath();
    // Dot draw
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`#${+id + 1}`, s.x, s.y - 10);
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