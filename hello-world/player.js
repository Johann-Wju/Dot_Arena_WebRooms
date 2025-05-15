const titleDisplay = document.getElementById('title-display');
const infoDisplay = document.getElementById('info-display');
const playersDisplay = document.getElementById('players');

// variables
let clientId = null; // client ID sent by web-rooms server when calling 'enter-room'
let clientCount = 0; // number of clients connected to the same room

function start() {
  console.log("Hello Console! Test Johann"); // watch the console in the browser
  // !! CRASHES THE SERVER !!
  // sendRequest('*get-client-ids*');
  // sendRequest('*subscribe-client-enter-exit*');
  // playersDisplay.innerHTML = ids.map(id => `<div>Player #${id + 1}</div>`).join('');
};

/****************************************************************
 * websocket communication
 */
// address of the WebSocket server
const webRoomsWebSocketServerAddr = 'https://nosch.uber.space/web-rooms/';
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

      case '*client-enter*': {
        const newId = incoming[1];
        console.log(`Client #${newId + 1} joined`);
        break;
      }
      case '*client-exit*': {
        const leftId = incoming[1];
        console.log(`Client #${leftId + 1} left`);
        break;
      }

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
