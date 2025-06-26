// LAST STABLE VERSION
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

const serverAddr = 'wss://nosch.uber.space/web-rooms/';
const socket = new WebSocket(serverAddr);

const DotDrawSize = 10;

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
let powerupTimerDisplay = 0;
let powerupRemainingTime = 0;
let powerupRotation = 0;
let powerupRespawnTimeoutId = null;

let globalTimerSeconds = 0;    // Remaining seconds on the global timer
let globalTimerInterval = null;

let gameEnded = false;

let lastSendTime = 0;
const SEND_INTERVAL = 20; // milliseconds

// Changed to Dots
const dots = {};   // { id: dotObject }
const food = [];   // Array of food objects
// Changed to Dot
const dotLastUpdated = {};    // { id: timestamp }

// =========================
// Initialization
// =========================
resetBtn.style.display = 'none';
updateTimerDisplay();
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

function showMessage(text, duration = 5000) {
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

  // Instead of just sending '*reset-all*', set shared-reset flag for all clients:
  sendRequest('*set-data*', 'shared-reset', true);
}

// =========================
// Food Management
// =========================
function spawnFood() {
  if (clientId !== 0) return;
  const padding = 10;
  const toAdd = 60 - food.length;
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

function updateTimerDisplay() {
  const minutes = Math.floor(globalTimerSeconds / 60);
  const seconds = globalTimerSeconds % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  document.getElementById('timer-display').textContent = `Time Left: ${formatted}`;
}

// =========================
// WebSocket Events
// =========================
socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'dot-arena');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-client-entries*');
  sendRequest('*subscribe-data*', 'shared-food');
  sendRequest('*subscribe-data*', 'shared-powerup');
  sendRequest('*subscribe-data*', 'shared-timer');
  sendRequest('*subscribe-data*', 'shared-game-ended');
  sendRequest('*subscribe-data*', 'shared-reset');

  setInterval(() => socket.send(''), 30000);
});

socket.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  const [selector, payload] = msg;

  if (selector === '*reset-all*') {
    window.location.reload();
    return;
  }

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
          if (food.length < 60) spawnFood();
        }, 1000);
        checkAndRespawnPowerup();

        // Start global timer when first client joins
        if (!globalTimerInterval) {
          globalTimerSeconds = 120; // 2 minutes
          globalTimerInterval = setInterval(() => {
            if (globalTimerSeconds > 0) {
              globalTimerSeconds--;
              updateTimerDisplay();
              sendRequest('*set-data*', 'shared-timer', globalTimerSeconds);
            } else {
              clearInterval(globalTimerInterval);
              globalTimerInterval = null;
              gameEnded = true;  // <- flag game ended here

              // Broadcast game ended state
              sendRequest('*set-data*', 'shared-game-ended', true);
            }
          }, 1000);
        }
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
      if (clientId === 0) {
        checkAndRespawnPowerup();
      }
      break;

    case 'shared-timer':
      globalTimerSeconds = payload ?? 0;
      updateTimerDisplay();
      break;

    case 'shared-game-ended':
      gameEnded = payload === true;

      // Show reset only if game has ended AND this is client 0
      if (gameEnded && clientId === 0) {
        resetBtn.style.display = 'block';
      } else {
        resetBtn.style.display = 'none';
      }
      break;

    case 'shared-reset':
      if (payload === true) {
        window.location.reload();
      }
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
let lastFrameTime = performance.now();
function gameLoop(currentTime) {
  if (gameEnded) {
    // Clear screen black
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw leaderboard text
    ctx.fillStyle = 'white';
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';

    ctx.fillText('Game Over - Top 5 Players:', canvas.width / 2, 80);

    // Get top 5 players sorted by size
    const topPlayers = Object.entries(dots)
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 5);

    topPlayers.forEach(([id, s], i) => {
      ctx.fillText(`#${parseInt(id) + 1}: Size ${Math.floor(s.size)}`, canvas.width / 2, 130 + i * 40);
    });

    // Keep update leaderboard and size display if needed
    // updateLeaderboard();
    updateSizeDisplay();

    requestAnimationFrame(gameLoop);
    return;  // skip rest of game logic
  }
  const delta = (currentTime - lastFrameTime) / 1000;
  lastFrameTime = currentTime;
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
  const speed = s.hasPowerup ? baseSpeed * 1.75 : baseSpeed;
  s.x = Math.max(0, Math.min(canvas.width, s.x + s.dx * speed));
  s.y = Math.max(0, Math.min(canvas.height, s.y + s.dy * speed));

  let ate = false;
  for (let i = food.length - 1; i >= 0; i--) {
    const foodRadius = 6;
    if (Math.hypot(s.x - food[i].x, s.y - food[i].y) < DotDrawSize + foodRadius) {
      s.size += 2
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
      color: s.color
    });
  }
  const powerupRadius = 8;
  if (
    powerup &&
    Math.hypot(s.x - powerup.x, s.y - powerup.y) < DotDrawSize + powerupRadius &&
    !s.hasPowerup) {
    s.hasPowerup = true;
    powerup = null;
    powerupRemainingTime = 10; // seconds

    powerupMessage = 'Powered Up!';
    powerupMessageOpacity = 1;
    powerupMessageHue = 0;

    sendRequest('*set-data*', 'shared-powerup', null);
    sendRequest('*set-data*', `dot-${clientId}`, {
      x: s.x,
      y: s.y,
      dx: s.dx,
      dy: s.dy,
      size: s.size,
      hasPowerup: true,
      color: s.color
    });
  }

  if (s.hasPowerup) {
    powerupRemainingTime -= delta;
    if (powerupRemainingTime > 0) {
      powerupTimerDisplay = powerupRemainingTime; // update the displayed timer
    } else {
      powerupRemainingTime = 0;
      // powerup ended
      powerupTimerDisplay = 0; // will be set during fade below

      s.hasPowerup = false;
      // rest of powerup expiration code ...

      // Start fade
      const fadeDuration = 500;
      const fadeSteps = 30;
      let step = 0;
      powerupTimerDisplay = 0.0; // reset or keep last value
      const fadeInterval = setInterval(() => {
        step++;
        powerupMessageOpacity = Math.max(0, 1 - step / fadeSteps);

        // During fade, show timer as 0.0 or last frame
        powerupTimerDisplay = 0;

        if (step >= fadeSteps) clearInterval(fadeInterval);
      }, fadeDuration / fadeSteps);

      checkAndRespawnPowerup();
    }
  }

  draw();
  updateLeaderboard();
  updateSizeDisplay();
  requestAnimationFrame(gameLoop);
}

function checkAndRespawnPowerup() {
  if (clientId !== 0) return; // Only host manages powerups

  if (powerupRespawnTimeoutId !== null) {
    // A respawn timer is already running, so don't start another
    return;
  }

  const anyonePoweredUp = Object.values(dots).some(s => s.hasPowerup);

  if (!anyonePoweredUp && !powerup) {
    powerupRespawnTimeoutId = setTimeout(() => {
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
      powerupRespawnTimeoutId = null; // Clear the timer ID once done
    }, 15000); // Wait 10 seconds before respawning
  }
}

function startStaleDotCleanup() {
  setInterval(() => {
    if (gameEnded) return;

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
const stars = [];

for (let i = 0; i < 200; i++) {
  const isShooting = Math.random() < 0.05; // 5% chance to be shooting star
  stars.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: Math.random() * 0.8 + 0.2,
    speed: isShooting
      ? Math.random() * 4 + 2  // faster for shooting stars
      : Math.random() * 0.3 + 0.1,
    isShooting,
    trail: [],  // will hold previous positions for trail effect
  });
}

function drawStars() {
  for (let star of stars) {
    // Move star
    star.y += star.speed;

    // Reset if off screen
    if (star.y > canvas.height) {
      star.y = 0;
      star.x = Math.random() * canvas.width;
      star.trail = [];
    }

    if (star.isShooting) {
      // Add current position to trail array (limit trail length)
      star.trail.push({ x: star.x, y: star.y });
      if (star.trail.length > 15) {
        star.trail.shift(); // remove oldest trail position
      }

      // Draw trail with fading opacity
      for (let i = 0; i < star.trail.length; i++) {
        const pos = star.trail[i];
        const alpha = (i + 1) / star.trail.length * 0.5; // fade out trail
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw the shooting star itself brighter
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius + 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal star flicker
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.5})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPowerUp(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

function drawSmiley(ctx, x, y, radius) {
  const eyeRadius = radius * 0.15;
  const eyeOffsetX = radius * 0.4;
  const eyeOffsetY = radius * 0.3;
  const smileRadius = radius * 0.6;

  ctx.save();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;

  // Eyes
  ctx.beginPath();
  ctx.fillStyle = 'black';
  // Left eye
  ctx.arc(x - eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
  // Right eye
  ctx.arc(x + eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.beginPath();
  ctx.arc(x, y, smileRadius, 0, Math.PI);
  ctx.stroke();

  ctx.restore();
}

function draw() {
  powerupRotation += 0.01; // radians per frame (~0.57°)
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Black Background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawStars();

  // Food is drawn
  ctx.fillStyle = 'lime';
  food.forEach(({ x, y }) => {
    // Create a radial gradient for the glowing effect
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 12);
    gradient.addColorStop(0, 'rgba(144, 238, 144, 1)');       // bright lime center (lightgreen)
    gradient.addColorStop(0.7, 'rgba(50, 205, 50, 0.7)');     // medium lime
    gradient.addColorStop(1, 'rgba(50, 205, 50, 0)');         // transparent edges

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Optional: Draw solid lime core for sharper center
    ctx.fillStyle = 'lime';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (powerup) {
    ctx.save();

    // Outer glow
    const gradient = ctx.createRadialGradient(
      powerup.x, powerup.y, 0,
      powerup.x, powerup.y, 30
    );
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
    gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(powerup.x, powerup.y, 30, 0, Math.PI * 2);
    ctx.fill();

    // Draw star
    drawPowerUp(ctx, powerup.x, powerup.y, 5, 12, 6);
    ctx.save();
    ctx.translate(powerup.x, powerup.y);
    ctx.rotate(powerupRotation);
    drawPowerUp(ctx, 0, 0, 5, 12, 6);
    ctx.fillStyle = 'gold';
    ctx.strokeStyle = 'orange';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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
    ctx.arc(s.x, s.y, DotDrawSize, 0, Math.PI * 2);
    ctx.fill();

    // Draw smiley face on dot
    drawSmiley(ctx, s.x, s.y, DotDrawSize);

    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';

    // Draw client number and size score
    ctx.fillText(`#${+id + 1}: ${Math.floor(s.size)}`, s.x, s.y - 10);
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

    // Draw timer while fading (if opacity > 0)
    if (powerupTimerDisplay > 0 || powerupMessageOpacity > 0) {
      ctx.font = '32px Arial';
      ctx.fillText(powerupTimerDisplay.toFixed(1) + 's', canvas.width / 2, canvas.height / 2 + 60);
    }

    ctx.restore();
  }
}

requestAnimationFrame(gameLoop);