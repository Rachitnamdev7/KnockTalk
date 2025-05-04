const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};
const userNames = {};
const roomCreators = {};

io.on("connection", (socket) => {
  console.log(`🟢 Connected: ${socket.id}`);

  socket.on("create-room", ({ room, name }) => {
    socket.join(room);
    userNames[socket.id] = name;
    roomCreators[room] = socket.id;

    if (!rooms[room]) rooms[room] = new Set();
    rooms[room].add(socket.id);

    console.log(`✅ Room created: ${room} by ${name}`);
  });

  socket.on("request-join", ({ room, name }) => {
    if (!roomCreators[room]) {
      socket.emit("join-response", { accepted: false });
      return;
    }

    const creatorId = roomCreators[room];
    userNames[socket.id] = name;
    io.to(creatorId).emit("join-request", { requesterId: socket.id, name });
  });

  socket.on("join-response", ({ targetId, accepted, room }) => {
    if (accepted) {
      rooms[room]?.add(targetId);
      io.to(targetId).emit("join-response", { accepted: true, room });
    } else {
      io.to(targetId).emit("join-response", { accepted: false });
    }
  });

  socket.on("join-room", ({ room, name }) => {
    socket.join(room);
    userNames[socket.id] = name;

    const others = [...rooms[room] || []]
      .filter(id => id !== socket.id)
      .map(id => ({ id, name: userNames[id] }));

    socket.emit("existing-users", others);
    socket.to(room).emit("user-joined", socket.id, name);
  });

  // Signaling events - always active
  socket.on("ice-candidate", (candidate, targetId) => {
    io.to(targetId).emit("ice-candidate", candidate, socket.id);
  });

  socket.on("offer", (offer, targetId) => {
    io.to(targetId).emit("offer", offer, socket.id);
  });

  socket.on("answer", (answer, targetId) => {
    io.to(targetId).emit("answer", answer, socket.id);
  });

  // Leaving or disconnecting
  function cleanup() {
    for (const room in rooms) {
      if (rooms[room].has(socket.id)) {
        rooms[room].delete(socket.id);
        socket.to(room).emit("user-left", socket.id);

        // Clean up creator if needed
        if (roomCreators[room] === socket.id) {
          delete roomCreators[room];
        }
      }
    }
    delete userNames[socket.id];
  }

  socket.on("leave-room", cleanup);
  socket.on("disconnect", () => {
    console.log(`🔴 Disconnected: ${socket.id}`);
    cleanup();
  });
});

// Get local IP for LAN testing
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const PORT = process.env.PORT || 3000;
const localIP = getLocalIP();

server.listen(PORT, () => {
  console.log("✅ Server running:");
  console.log(`   http://localhost:${PORT}`);
  console.log(`   http://${localIP}:${PORT} (LAN)`);
});
