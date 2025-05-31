const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const infoDisplay = document.getElementById('info-display');

const serverAddr = 'wss://nosch.uber.space/web-rooms/';
const socket = new WebSocket(serverAddr);

let clientId = null;
let clientCount = 0;

const snakes = {}; // key: clientId string, value: snake state
const food = [];

let direction = { dx: 1, dy: 0 };

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getRandomBrightColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 90 + Math.random() * 10;
  const lightness = 50 + Math.random() * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

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

// Subscribe to a snake data key
function subscribeSnakeKey(id) {
  sendRequest('*subscribe-data*', `snake-${id}`);
}

// Unsubscribe snake data key when client leaves (optional)
function unsubscribeSnakeKey(id) {
  sendRequest('*unsubscribe-data*', `snake-${id}`);
}

function resetGame() {
  if (clientId !== 0) {
    console.warn('Only client 1 can reset the game.');
    return;
  }

  const oldColor = snakes[clientId]?.color || getRandomBrightColor();
  snakes[clientId] = createSnake();
  snakes[clientId].color = oldColor;
  direction = { dx: 1, dy: 0 };

  food.length = 0;
  spawnFood();

  sendRequest('*set-data*', `snake-${clientId}`, snakes[clientId]);
  sendRequest('*set-data*', 'shared-food', food);

  draw();
  updateInfo();
}

document.getElementById('reset-btn').addEventListener('click', resetGame);

socket.addEventListener('open', () => {
  sendRequest('*enter-room*', 'snake-room');
  sendRequest('*subscribe-client-count*');
  sendRequest('*subscribe-data*', 'shared-food'); // food updates

  setInterval(() => socket.send(''), 30000); // keep alive
});

function sendRequest(...msg) {
  socket.send(JSON.stringify(msg));
}

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  const selector = data[0];

  switch (selector) {
    case '*client-id*':
      clientId = data[1];
      snakes[clientId] = createSnake();
      if (clientId !== 0) {
        document.getElementById('reset-btn').style.display = 'none';
      }
      direction = { dx: 1, dy: 0 };
      food.length = 0;
      resizeCanvas();
      spawnFood();

      // Subscribe to all snake data keys for other clients
      // We'll do this after getting client count
      updateInfo();
      draw();
      break;

    case '*client-count*':
      clientCount = data[1];
      updateInfo();

      // Subscribe to all snake keys for clients except self
      for (let i = 0; i < clientCount; i++) {
        if (i !== clientId) {
          subscribeSnakeKey(i);
        }
      }
      // Also subscribe own snake key for data consistency
      subscribeSnakeKey(clientId);

      break;

    case '*client-enter*': {
      const newClientId = data[1];
      clientCount++;
      updateInfo();
      if (newClientId !== clientId) {
        subscribeSnakeKey(newClientId);
      }
      break;
    }

    case '*client-exit*': {
      const leftClientId = data[1];
      clientCount--;
      updateInfo();
      if (snakes[leftClientId]) {
        delete snakes[leftClientId];
      }
      unsubscribeSnakeKey(leftClientId);
      break;
    }

    case 'shared-food': {
      const [, value] = data;
      food.length = 0;
      food.push(...value);
      break;
    }

    default: {
      // Handle data updates for snakes and food
      if (selector.startsWith('snake-')) {
        const idStr = selector.split('-')[1];
        const id = parseInt(idStr);
        if (id !== clientId) {
          const snakeState = data[1];
          if (selector.startsWith('snake-')) {
            const idStr = selector.split('-')[1];
            const id = parseInt(idStr);
            if (id !== clientId) {
              const snakeState = data[1];
              if (!snakes[id]) {
                snakes[id] = snakeState;
              } else {
                // Merge in updated state but keep the existing color if the incoming one is missing
                snakes[id] = {
                  ...snakes[id],
                  ...snakeState,
                  color: snakeState.color || snakes[id].color,
                };
              }
            }
          }
        }
      }
      break;
    }
  }
});

socket.addEventListener('close', () => {
  infoDisplay.textContent = 'Disconnected';
});

function updateInfo() {
  if (clientId == null) {
    infoDisplay.textContent = 'Connecting...';
  } else {
    infoDisplay.textContent = `You: #${clientId + 1} | Players: ${clientCount}`;
  }
}

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp':
      if (direction.dy === 0) direction = { dx: 0, dy: -1 };
      break;
    case 'ArrowDown':
      if (direction.dy === 0) direction = { dx: 0, dy: 1 };
      break;
    case 'ArrowLeft':
      if (direction.dx === 0) direction = { dx: -1, dy: 0 };
      break;
    case 'ArrowRight':
      if (direction.dx === 0) direction = { dx: 1, dy: 0 };
      break;
    case 'r':
    case 'R':
      resetGame();
      break;
  }
});

function spawnFood() {
  if (clientId !== 0) return;

  while (food.length < 20) {
    food.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
    });
  }

  sendRequest('*set-data*', 'shared-food', food);
}

function gameLoop() {
  if (clientId == null) return requestAnimationFrame(gameLoop);

  const mySnake = snakes[clientId];
  if (!mySnake) return requestAnimationFrame(gameLoop);

  mySnake.dx = direction.dx;
  mySnake.dy = direction.dy;

  const speed = 1;
  mySnake.x += mySnake.dx * speed;
  mySnake.y += mySnake.dy * speed;

  mySnake.body.unshift({ x: mySnake.x, y: mySnake.y });
  if (mySnake.body.length > mySnake.size) mySnake.body.pop();

  // *** EVERY client checks for food eaten ***
  let ateFood = false;
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    const dist = Math.hypot(mySnake.x - f.x, mySnake.y - f.y);
    if (dist < 10) {
      mySnake.size += 2;
      food.splice(i, 1);
      ateFood = true;
    }
  }

  // If ate food, update shared food data
  if (ateFood) {
    sendRequest('*set-data*', 'shared-food', food);
  }

  // Update own snake data
  sendRequest('*set-data*', `snake-${clientId}`, mySnake);

  draw();
  spawnFood();

  requestAnimationFrame(gameLoop);
}


function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw food
  food.forEach((dot) => {
    ctx.fillStyle = 'lime';
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw snakes
  for (const id in snakes) {
    const s = snakes[id];
    ctx.fillStyle = s.color || (parseInt(id) === clientId ? 'cyan' : 'orange');

    s.body.forEach((segment) => {
      ctx.beginPath();
      ctx.arc(segment.x, segment.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    const head = s.body[0];
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`#${parseInt(id) + 1}`, head.x, head.y - 10);
  }
}

requestAnimationFrame(gameLoop);
