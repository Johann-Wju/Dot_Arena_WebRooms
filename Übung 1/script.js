
const titleElem = document.getElementById('title-display');
const messageElem = document.getElementById('message-display');
const indexElem = document.getElementById('client-index');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const webSocketAddr = 'http://127.0.0.1:5500/';
// const webSocketAddr = 'https://217.248.11.107:3000/';

const circleRadius = 50;

let clientId = null;
let clientCount = 0;

titleElem.innerText = 'Test';
messageElem.innerText = '';
window.addEventListener('resize', updateCanvasSize);

/*************************************************************
 * touches
 */
const touches = new Map();

class Touch {
    constructor(id, x, y, own = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.own = own;
    }

    move(x, y) {
        this.x = x;
        this.y = y;
    }
}

function createTouch(id, x, y, own = false) {
    const touch = new Touch(id, x, y, own);
    touches.set(id, touch);
}

function moveTouch(id, x, y) {
    const touch = touches.get(id);

    if (touch) {
        touch.move(x, y);
    }
}

function deleteTouch(id) {
    touches.delete(id);
}

/*************************************************************
 * start
 */
function start() {
    updateCanvasSize();

    document.body.addEventListener('pointerdown', onPointerDown);
    document.body.addEventListener('pointermove', onPointerMove);
    document.body.addEventListener('pointerup', onPointerUp);
    document.body.addEventListener('pointercancel', onPointerUp);

    requestAnimationFrame(onAnimationFrame);
};

/*************************************************************
 * pointer events
 */
let pointerId = null;

function onPointerDown(e) {
    if (pointerId === null) {
        pointerId = e.pointerId;
        const x = e.clientX / canvas.width;
        const y = e.clientY / canvas.height;
        createTouch(clientId, x, y, true);
        sendRequest('broadcast-message', ['start', clientId, x, y]);
    }
}

function onPointerMove(e) {
    if (e.pointerId === pointerId) {
        const x = e.clientX / canvas.width;
        const y = e.clientY / canvas.height;
        moveTouch(clientId, x, y);
        sendRequest('broadcast-message', ['move', clientId, x, y]);
    }
}

function onPointerUp(e) {
    if (e.pointerId === pointerId) {
        deleteTouch(clientId);
        sendRequest('broadcast-message', ['end', clientId]);
        pointerId = null;
    }
}

/*************************************************************
 * canvas
 */
function updateCanvasSize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function onAnimationFrame() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (let [id, touch] of touches) {
        const x = canvas.width * touch.x
        const y = canvas.height * touch.y
        drawCircle(context, x, y, touch.own);
    }

    requestAnimationFrame(onAnimationFrame);
}

function drawCircle(context, x, y, highlight = false) {
    context.globalAlpha = highlight ? 0.666 : 0.5;
    context.fillStyle = highlight ? '#f00' : '#fff';
    context.beginPath();
    context.arc(x, y, circleRadius, 0, 2 * Math.PI);
    context.fill();
}

/****************************************************************
 * websocket communication
 */
const socket = new WebSocket(webSocketAddr);

// listen to opening websocket connections
socket.addEventListener('open', (event) => {
    sendRequest('enter-room', 'touch-touch');
    sendRequest('subscribe-client-count');
});

socket.addEventListener("close", (event) => {
    clientId = null;
    document.body.classList.add('disconnected');
});

// listen to messages from server
socket.addEventListener('message', (event) => {
    const data = event.data;

    if (data.length > 0) {
        const incoming = JSON.parse(data);
        const selector = incoming[0];

        // dispatch incomming messages
        switch (selector) {
            case 'client-id':
                clientId = incoming[1] + 1;
                indexElem.innerHTML = `#${clientId}/${clientCount}`;
                start();
                break;

            case 'client-count':
                clientCount = incoming[1];
                indexElem.innerHTML = `#${clientId}/${clientCount}`;
                break;

            case 'start': {
                const id = incoming[1];
                const x = incoming[2];
                const y = incoming[3];
                createTouch(id, x, y);
                break;
            }

            case 'move': {
                const id = incoming[1];
                const x = incoming[2];
                const y = incoming[3];
                moveTouch(id, x, y);
                break;
            }

            case 'end': {
                const id = incoming[1];
                deleteTouch(id);
                break;
            }

            case 'error': {
                const message = incoming[1];
                console.warn('server error:', ...message);
                break;
            }

            default:
                break;
        }
    }
});

window.addEventListener("close", () => {
    sendRequest('broadcast-message', ['end', client]);
})

function setErrorMessage(text) {
    messageElem.innerText = text;
    messageElem.classList.add('error');
}

function sendRequest(...message) {
    const str = JSON.stringify(message);
    socket.send(str);
}
