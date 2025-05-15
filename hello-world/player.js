const titleDisplay = document.getElementById('title-display');
const infoDisplay = document.getElementById('info-display');

// address of the WebSocket server
const webRoomsWebSocketServerAddr = 'https://nosch.uber.space/web-rooms/';

// variables
let clientId = null; // client ID sent by web-rooms server when calling 'enter-room'
let clientCount = 0; // number of clients connected to the same room

function start() {
  console.log("Hello Console!"); // watch the console in the browser

  // register simple click event on window
  window.addEventListener('pointerdown', sendHelloThere);
};

// send message 'hello-there' to all other clients
function sendHelloThere() {
  sendRequest('*broadcast-message*', ['hello-there', clientId]);
  highlightText(infoDisplay); // highlight the info-display
}

function highlightText(elem) {
  elem.classList.add('highlight-text');

  setTimeout(() => {
    elem.classList.remove('highlight-text');
  }, 120);
}

/****************************************************************
 * websocket communication
 */
const socket = new WebSocket(webRoomsWebSocketServerAddr);

// helper function to send requests over websocket to web-room server
function sendRequest(...message) {
  const str = JSON.stringify(message);
  socket.send(str);
}

// listen to opening websocket connections
socket.addEventListener('open', (event) => {
  sendRequest('*enter-room*', 'touch-touch');
  sendRequest('*subscribe-client-count*');

  // ping the server regularly with an empty message to prevent the socket from closing
  setInterval(() => socket.send(''), 30000);
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
      // responds to '*enter-room*'
      case '*client-id*':
        clientId = incoming[1];
        infoDisplay.innerHTML = `#${clientId + 1}/${clientCount}`;
        start();
        break;

      // responds to '*subscribe-client-count*'
      case '*client-count*':
        clientCount = incoming[1];
        infoDisplay.innerHTML = `#${clientId + 1}/${clientCount}`;
        break;

      // 'hello there' messages sent from other clients
      case 'hello-there':
        const otherId = incoming[1];
        console.log(`client #${otherId + 1} says 'Hello there!'`);

        highlightText(titleDisplay); // highlight screen by others (function defined above)
        break;

      case '*error*': {
        const message = incoming[1];
        console.warn('server error:', ...message);
        break;
      }

      default:
        break;
    }
  }
});
