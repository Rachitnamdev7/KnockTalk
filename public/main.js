const socket = io();
const peerConnections = {};
const userNames = {};

let localStream = null;
let localUsername = "";
let roomId = "";
let isRoomCreator = false;

const videoGrid = document.getElementById("user-streams");
const localVideoContainer = document.getElementById("local-video-container");
const joinButton = document.getElementById("join-btn");
const createButton = document.getElementById("create-btn");
const usernameInput = document.getElementById("username-input");
const roomInput = document.getElementById("room-input");

const cameraBtn = document.getElementById("camera-btn");
const micBtn = document.getElementById("mic-btn");
const leaveBtn = document.getElementById("leave-btn");

const popupContainer = document.getElementById("popup-container");
const popupMessage = document.getElementById("popup-message");
const acceptBtn = document.getElementById("accept-btn");
const rejectBtn = document.getElementById("reject-btn");

function addVideoStream(video, stream, isLocal = false, userId = null, username = "") {
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;
  video.classList.add("video-player");

  const container = document.createElement("div");
  container.classList.add("video-containers");
  if (!isLocal && userId) video.setAttribute("data-socket-id", userId);

  const label = document.createElement("div");
  label.className = "user-label";
  label.innerText = username || "User";

  container.appendChild(video);
  container.appendChild(label);

  if (isLocal) {
    localVideoContainer.innerHTML = "";
    localVideoContainer.appendChild(container);
  } else {
    if (document.querySelector(`[data-socket-id="${userId}"]`)) return;
    videoGrid.appendChild(container);
  }
}

async function startCall(name, room, isCreator) {
  localUsername = name;
  roomId = room;
  isRoomCreator = isCreator;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const videoElement = document.createElement("video");
    addVideoStream(videoElement, localStream, true, null, name);
    document.getElementById("join-section").style.display = "none";
    document.body.classList.add("call-active");
  } catch (err) {
    alert("Could not access media devices");
    console.error(err);
  }
}

createButton.addEventListener("click", async () => {
  const name = usernameInput.value.trim();
  const room = roomInput.value.trim();
  if (!name || !room) return alert("Please enter name and room code");

  await startCall(name, room, true);
  socket.emit("create-room", { room, name });
});

joinButton.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  const room = roomInput.value.trim();
  if (!name || !room) return alert("Please enter name and room code");

  localUsername = name;
  roomId = room;
  socket.emit("request-join", { room, name });
});

cameraBtn.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    cameraBtn.classList.toggle("disabled", !track.enabled);
  }
});

micBtn.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    micBtn.classList.toggle("disabled", !track.enabled);
  }
});

leaveBtn.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  document.body.classList.remove("call-active");
  document.getElementById("join-section").style.display = "flex";
  localVideoContainer.innerHTML = "";
  videoGrid.innerHTML = "";

  socket.emit("leave-room", roomId);
  for (let id in peerConnections) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
});

socket.on("join-request", ({ requesterId, name }) => {
  popupMessage.innerText = `${name} wants to join the room. Allow?`;
  popupContainer.classList.remove("hidden");

  acceptBtn.onclick = () => {
    socket.emit("join-response", { targetId: requesterId, accepted: true, room: roomId });
    popupContainer.classList.add("hidden");
  };

  rejectBtn.onclick = () => {
    socket.emit("join-response", { targetId: requesterId, accepted: false });
    popupContainer.classList.add("hidden");
  };
});

socket.on("join-response", async ({ accepted, room }) => {
  if (accepted) {
    await startCall(localUsername, room, false);
    socket.emit("join-room", { room, name: localUsername });
  } else {
    alert("Your request was denied by the room creator.");
  }
});

function setupPeerConnection(userId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  peerConnections[userId] = pc;

  localStream?.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", event.candidate, userId);
    }
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream || document.querySelector(`[data-socket-id="${userId}"]`)) return;

    const videoElement = document.createElement("video");
    addVideoStream(videoElement, stream, false, userId, userNames[userId] || "User");
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state for ${userId}:`, pc.iceConnectionState);
  };

  return pc;
}

socket.on("existing-users", (userList) => {
  for (const { id, name } of userList) {
    userNames[id] = name;
    if (id === socket.id) continue;

    const pc = setupPeerConnection(id);
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit("offer", offer, id);
    });
  }
});

socket.on("user-joined", (userId, name) => {
  userNames[userId] = name;
  if (userId === socket.id) return;
  setupPeerConnection(userId);
});

socket.on("offer", async (offer, userId) => {
  const pc = setupPeerConnection(userId);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer, userId);
});

socket.on("answer", async (answer, userId) => {
  await peerConnections[userId]?.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate, userId) => {
  const pc = peerConnections[userId];
  if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("user-left", (userId) => {
  peerConnections[userId]?.close();
  delete peerConnections[userId];
  const el = document.querySelector(`[data-socket-id="${userId}"]`);
  el?.parentElement.remove();
});
