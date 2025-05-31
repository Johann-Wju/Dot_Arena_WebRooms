// =========================
// Canvas and UI Setup
// =========================
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const infoDisplay = document.getElementById('info-display');
const resetBtn = document.getElementById('reset-btn');
const leaderboardList = document.getElementById('leaderboard-list');
const sizeDisplay = document.getElementById('size-display');

// Resize canvas to full screen
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// =========================
// WebSocket Setup
// =========================
const serverAddr = 'wss://nosch.uber.space/web-rooms/';
const socket = new WebSocket(serverAddr);

// =========================
// Game State and Client Info
// =========================
let clientId = null;
let clientCount = 0;

const snakes = {}; // { clientId: snakeObject }
const food = [];   // Shared food array
let targetPosition = null; // Mouse/touch target for movement

// =========================
// Snake and Food Logic
// =========================

// Create a new bright HSL color
function getRandomBrightColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 90 + Math.random() * 10;
  const lightness = 50 + Math.random() * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Create a new snake with random position and body
function createSnake() {
  const padding = 50;
  const startX = padding + Math.random() * (canvas.width - 2 * padding);
  const startY = padding + Math.random() * (canvas.height - 2 * padding);
  const body = [];

  for (let i = 0; i < 10; i++) {
    body.push({ x: startX - i * 5, y: startY });
  }

  return {
    x: startX,
    y: startY,
    dx: 1,
    dy: 0,
    body,
    size: 10,
    color: getRandomBrightColor(),
  };
}

// Spawn food items at random locations
function spawnFood() {
  if (clientId !== 0) return;

  const padding = 10;
  const needed = 40 - food.length;

  for (let i = 0; i < needed; i++) {
    food.push({
      x: padding + Math.random() * (canvas.width - 2 * padding),
      y: padding + Math.random() * (canvas.height - 2 * padding),
    });
  }

  sendRequest('*set-data*', 'shared-food', food);
}

// =========================
// WebSocket Communication
// =========================

// Send a structured request
function sendRequest(...msg) {
  socket.send(JSON.stringify(msg));
}

// Subscribe/unsubscribe to other players' snake data
function subscribeSnakeKey(id) {
  sendRequest('*subscribe-data*', `snake-${id}`);
}
function unsubscribeSnakeKey(id) {
  sendRequest('*unsubscribe-data*', `snake-${id}`);
}

// =========================
// UI Update Functions
// =========================

// Display client info
function updateInfo() {
  if (clientId === null) {
    infoDisplay.textContent = 'Connecting...';
  } else {
    infoDisplay.textContent = `You: #${clientId + 1} | Players: ${clientCount}`;
  }
}

// Display leaderboard (top 5 snakes by size)
function updateLeaderboard() {
  const sortedSnakes = Object.entries(snakes)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);

  leaderboardList.innerHTML = '';
  sortedSnakes.forEach(([id, snake]) => {
    const li = document.createElement('li');
    li.textContent = `#${parseInt(id) + 1}: ${snake.size}`;
    leaderboardList.appendChild(li);
  });
}

// Display your own snake size
function updateSizeDisplay() {
  const mySnake = snakes[clientId];
  sizeDisplay.textContent = mySnake ? `Size: ${mySnake.size}` : '';
}

// =========================
// Game Control and Input
// =========================

// Reset the game (only client 0 allowed)
function resetGame() {
  if (clientId !== 0) {
    console.warn('Only client 1 can reset the game.');
    return;
  }

  const oldColor = snakes[clientId]?.color || getRandomBrightColor();
  snakes[clientId] = createSnake();
  snakes[clientId].color = oldColor;

  food.length = 0;
  spawnFood();

  sendRequest('*set-data*', `snake-${clientId}`, snakes[clientId]);
  sendRequest('*set-data*', 'shared-food', food);

  draw();
  updateInfo();
}
resetBtn.addEventListener('click', resetGame);

// Handle keyboard reset
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') resetGame();
});

// Mouse and touch input for targeting
canvas.addEventListener('mousemove', (e) => {
  targetPosition = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('touchmove', (e) => {
  const touch = e.touches[0];
  targetPosition = { x: touch.clientX, y: touch.clientY };
});

// =========================
// WebSocket Event Handling
// =========================
socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'snake-room');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-client-entries*');
  sendRequest('*subscribe-data*', 'shared-food');

  setInterval(() => socket.send(''), 30000); // Keep-alive ping
});

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  const selector = data[0];

  switch (selector) {
    case '*client-id*':
      clientId = data[1];
      snakes[clientId] = createSnake();
      if (clientId !== 0) resetBtn.style.display = 'none';

      food.length = 0;
      resizeCanvas();
      spawnFood();

      if (clientId === 0) {
        setInterval(spawnFood, 500); // Maintain food supply
      }

      updateInfo();
      draw();
      break;

    case '*client-count*':
      clientCount = data[1];
      updateInfo();

      for (let i = 0; i < clientCount; i++) {
        if (i !== clientId) subscribeSnakeKey(i);
      }
      subscribeSnakeKey(clientId);
      break;

    case '*client-enter*': {
      const newClientId = data[1];
      clientCount++;
      updateInfo();
      if (newClientId !== clientId) subscribeSnakeKey(newClientId);
      break;
    }

    case '*client-exit*': {
      const leftClientId = data[1];
      clientCount--;
      updateInfo();
      delete snakes[leftClientId];
      unsubscribeSnakeKey(leftClientId);
      updateLeaderboard();
      break;
    }

    case 'shared-food': {
      const [, value] = data;
      food.length = 0;
      food.push(...value);
      break;
    }

    default:
      if (selector.startsWith('snake-')) {
        const id = parseInt(selector.split('-')[1]);
        if (id !== clientId) {
          const snakeState = data[1];
          snakes[id] = {
            ...snakeState,
            color: snakes[id]?.color || snakeState.color || getRandomBrightColor(),
          };
        }
      }
      break;
  }
});

socket.addEventListener('close', () => {
  infoDisplay.textContent = 'Disconnected';
});

// =========================
// Main Game Loop
// =========================
function gameLoop() {
  if (clientId === null) return requestAnimationFrame(gameLoop);

  const mySnake = snakes[clientId];
  if (!mySnake) return requestAnimationFrame(gameLoop);

  // Move toward target position
  if (targetPosition) {
    const dx = targetPosition.x - mySnake.x;
    const dy = targetPosition.y - mySnake.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      mySnake.dx = dx / length;
      mySnake.dy = dy / length;
    }
  }

  const speed = 1;
  mySnake.x += mySnake.dx * speed;
  mySnake.y += mySnake.dy * speed;

  // Bounce off walls
  if (mySnake.x < 0 || mySnake.x > canvas.width) mySnake.dx *= -1;
  if (mySnake.y < 0 || mySnake.y > canvas.height) mySnake.dy *= -1;

  mySnake.x = Math.max(0, Math.min(mySnake.x, canvas.width));
  mySnake.y = Math.max(0, Math.min(mySnake.y, canvas.height));

  // Update body
  mySnake.body.unshift({ x: mySnake.x, y: mySnake.y });
  if (mySnake.body.length > mySnake.size) mySnake.body.pop();

  // Eat food
  let ateFood = false;
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    if (Math.hypot(mySnake.x - f.x, mySnake.y - f.y) < 10) {
      mySnake.size += 2;
      food.splice(i, 1);
      ateFood = true;
    }
  }

  if (ateFood) {
    sendRequest('*set-data*', 'shared-food', food);
  }

  // Sync state to server
  sendRequest('*set-data*', `snake-${clientId}`, mySnake);

  draw();
  updateLeaderboard();
  updateSizeDisplay();

  requestAnimationFrame(gameLoop);
}

// =========================
// Drawing
// =========================
function draw() {
  // Clear canvas
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw food
  ctx.fillStyle = 'lime';
  food.forEach(({ x, y }) => {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw snakes
  for (const id in snakes) {
    const s = snakes[id];
    ctx.fillStyle = s.color || (parseInt(id) === clientId ? 'cyan' : 'orange');

    s.body.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw player number
    const head = s.body[0];
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`#${parseInt(id) + 1}`, head.x, head.y - 10);
  }
}

// Start the game loop
requestAnimationFrame(gameLoop);
