const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const infoDisplay = document.getElementById('info-display');

// WebSocket setup
const serverAddr = 'wss://nosch.uber.space/web-rooms/';
const socket = new WebSocket(serverAddr);
let clientId = null;
let clientCount = 0;

// Game state
const snakes = {}; // key: clientId, value: {x, y, dx, dy, body, size}
const food = [];

// Controls
let direction = { dx: 1, dy: 0 };

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // set initially

function resetGame() {
  if (clientId == null || !snakes[clientId]) {
    console.warn('Client ID not set yet — cannot reset.');
    return;
  }

  snakes[clientId] = createSnake();
  direction = { dx: 1, dy: 0 };

  food.length = 0;
  resizeCanvas();
  spawnFood();

  sendRequest('*player-state*', clientId, snakes[clientId]);
  draw();
  updateInfo();
}

document.getElementById('reset-btn').addEventListener('click', resetGame);

// Initial snake setup
function createSnake() {
  const body = [];
  for (let i = 0; i < 10; i++) {
    body.push({ x: 100 - i * 5, y: 100 });
  }
  return {
    x: 100,
    y: 100,
    dx: 1,
    dy: 0,
    body: body,
    size: 10,
  };
}

// Handle WebSocket connection
socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'snake-room');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-data*', 'shared-food'); // 👈 SUBSCRIBE to food updates
  setInterval(() => socket.send(''), 30000); // keep alive
});

// Send messages
function sendRequest(...msg) {
  socket.send(JSON.stringify(msg));
}

// Handle messages
socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  const selector = data[0];

  switch (selector) {
    case '*client-id*':
      clientId = data[1];
      snakes[clientId] = createSnake();

      // SAFE to initialize game-dependent state here
      direction = { dx: 1, dy: 0 };
      food.length = 0;
      resizeCanvas();
      spawnFood();
      sendRequest('*player-state*', clientId, snakes[clientId]);
      updateInfo();
      draw();

      console.log('Client ID assigned:', clientId);
      console.log('Initial snake:', snakes[clientId]);
      break;
    case '*client-count*':
      clientCount = data[1];
      updateInfo();
      break;
    case '*client-enter*':
    case '*client-exit*':
      sendRequest('*subscribe-client-count*');
      break;
    case 'shared-food': {
      const [, value] = data;
      food.length = 0;
      food.push(...value);
      break;
    }
    case '*player-state*': {
      const [_, id, state] = data;
      if (id !== clientId) {
        snakes[id] = state;
      }
      break;
    }
  }
});

socket.addEventListener('close', () => {
  infoDisplay.textContent = 'Disconnected';
});

// Update display info
function updateInfo() {
  if (clientId == null) {
    infoDisplay.textContent = `Connecting...`;
  } else {
    infoDisplay.textContent = `You: #${clientId + 1} | Players: ${clientCount}`;
  }
}

// Movement input
window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp': if (direction.dy === 0) direction = { dx: 0, dy: -1 }; break;
    case 'ArrowDown': if (direction.dy === 0) direction = { dx: 0, dy: 1 }; break;
    case 'ArrowLeft': if (direction.dx === 0) direction = { dx: -1, dy: 0 }; break;
    case 'ArrowRight': if (direction.dx === 0) direction = { dx: 1, dy: 0 }; break;
    case 'r':
    case 'R':
      resetGame();
      break;
  }
});

// Food generation
function spawnFood() {
  if (clientId !== 0) return; // Only first client manages food

  while (food.length < 20) {
    food.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height
    });
  }

  sendRequest('*set-data*', 'shared-food', food);
}

// Game loop
function gameLoop() {
  if (clientId === null || clientId === undefined) return requestAnimationFrame(gameLoop);

  const mySnake = snakes[clientId];
  mySnake.dx = direction.dx;
  mySnake.dy = direction.dy;

  const speed = 2;
  mySnake.x += mySnake.dx * speed;
  mySnake.y += mySnake.dy * speed;

  mySnake.body.unshift({ x: mySnake.x, y: mySnake.y });
  if (mySnake.body.length > mySnake.size) mySnake.body.pop();

  // Eat food
  if (clientId === 0) {
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      const dist = Math.hypot(mySnake.x - f.x, mySnake.y - f.y);
      if (dist < 10) {
        mySnake.size += 2;
        food.splice(i, 1);
        sendRequest('*set-data*', 'shared-food', food); // 👈 update shared data
      }
    }
  }

  // Broadcast own snake
  sendRequest('*player-state*', clientId, mySnake);

  draw();
  spawnFood();
  requestAnimationFrame(gameLoop);
}

// Draw game
function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw food
  food.forEach(dot => {
    ctx.fillStyle = 'lime';
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw all snakes
  for (const id in snakes) {
    const s = snakes[id];
    ctx.fillStyle = id == clientId ? 'cyan' : 'orange';
    s.body.forEach((segment, i) => {
      ctx.beginPath();
      ctx.arc(segment.x, segment.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

requestAnimationFrame(gameLoop);
