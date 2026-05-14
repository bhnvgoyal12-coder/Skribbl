import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pickWords } from "./words.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(join(__dirname, "public")));

const httpServer = createServer(app);
const io = new Server(httpServer);

const PICK_SECONDS = 15;
const REVEAL_SECONDS = 5;

const DEFAULT_SETTINGS = {
  rounds: 3,
  drawSeconds: 70,
};

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function maskWord(word) {
  return word.split("").map((c) => (c === " " ? " " : "_")).join("");
}

function revealHint(word, mask) {
  const arr = mask.split("");
  const hidden = [];
  for (let i = 0; i < word.length; i++) {
    if (arr[i] === "_") hidden.push(i);
  }
  if (hidden.length === 0) return mask;
  const idx = hidden[Math.floor(Math.random() * hidden.length)];
  arr[idx] = word[idx];
  return arr.join("");
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isDrawer: p.id === room.drawerId,
      guessed: room.guessedIds.has(p.id),
      connected: p.connected,
    })),
    phase: room.phase,
    round: room.round,
    totalRounds: room.settings.rounds,
    drawerId: room.drawerId,
    mask: room.mask,
    wordLength: room.word ? room.word.length : 0,
    endsAt: room.endsAt,
    settings: room.settings,
    customWordCount: room.customWords ? room.customWords.length : 0,
  };
}

function broadcastState(room) {
  io.to(room.code).emit("state", publicRoomState(room));
}

function clearTimers(room) {
  if (room.timer) clearTimeout(room.timer);
  if (room.hintTimer) clearInterval(room.hintTimer);
  room.timer = null;
  room.hintTimer = null;
}

function endGame(room) {
  clearTimers(room);
  room.phase = "ended";
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.code).emit("gameover", { ranked: ranked.map((p) => ({ name: p.name, score: p.score })) });
  broadcastState(room);
}

function nextTurn(room) {
  clearTimers(room);
  room.guessedIds = new Set();
  room.word = null;
  room.mask = null;
  room.strokes = [];

  room.turnIndex++;
  if (room.turnIndex >= room.players.length) {
    room.turnIndex = 0;
    room.round++;
  }
  if (room.round > room.settings.rounds) {
    endGame(room);
    return;
  }

  const drawer = room.players[room.turnIndex];
  if (!drawer) {
    endGame(room);
    return;
  }
  room.drawerId = drawer.id;
  room.phase = "picking";
  const choices = pickWords(3, room.customWords);
  room.wordChoices = choices;
  room.endsAt = Date.now() + PICK_SECONDS * 1000;

  broadcastState(room);
  io.to(room.code).emit("choose", { choices, drawerId: drawer.id, drawerName: drawer.name });

  room.timer = setTimeout(() => {
    if (room.phase === "picking") {
      const auto = choices[Math.floor(Math.random() * choices.length)];
      startDrawing(room, auto);
    }
  }, PICK_SECONDS * 1000);
}

function startDrawing(room, word) {
  clearTimers(room);
  room.word = word;
  room.mask = maskWord(word);
  room.phase = "drawing";
  room.guessedIds = new Set();
  room.strokes = [];
  const drawMs = room.settings.drawSeconds * 1000;
  room.endsAt = Date.now() + drawMs;
  room.guessOrder = [];

  broadcastState(room);
  io.to(room.drawerId).emit("word", { word });
  io.to(room.code).emit("clear");
  io.to(room.code).emit("hideChoose");

  setTimeout(() => {
    if (room.phase === "drawing" && room.word) {
      room.mask = revealHint(room.word, room.mask);
      broadcastState(room);
    }
  }, drawMs * 0.5);
  setTimeout(() => {
    if (room.phase === "drawing" && room.word) {
      room.mask = revealHint(room.word, room.mask);
      broadcastState(room);
    }
  }, drawMs * 0.75);

  room.timer = setTimeout(() => endRound(room), drawMs);
}

function endRound(room) {
  clearTimers(room);
  room.phase = "reveal";
  room.endsAt = Date.now() + REVEAL_SECONDS * 1000;

  const drawer = room.players.find((p) => p.id === room.drawerId);
  if (drawer && room.guessOrder.length > 0) {
    const bonus = Math.round(50 + (room.guessOrder.length / Math.max(1, room.players.length - 1)) * 100);
    drawer.score += bonus;
  }

  io.to(room.code).emit("reveal", { word: room.word });
  broadcastState(room);
  room.timer = setTimeout(() => nextTurn(room), REVEAL_SECONDS * 1000);
}

function startGame(room) {
  if (room.players.length < 2) return;
  room.round = 1;
  room.turnIndex = -1;
  room.phase = "starting";
  for (const p of room.players) p.score = 0;
  nextTurn(room);
}

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("create", ({ name }, cb) => {
    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: [],
      phase: "lobby",
      round: 0,
      turnIndex: -1,
      drawerId: null,
      word: null,
      mask: null,
      wordChoices: null,
      guessedIds: new Set(),
      guessOrder: [],
      strokes: [],
      timer: null,
      hintTimer: null,
      endsAt: null,
      settings: { ...DEFAULT_SETTINGS },
      customWords: null,
    };
    rooms.set(code, room);
    joinRoom(socket, room, name);
    cb?.({ ok: true, code });
  });

  socket.on("join", ({ code, name }, cb) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Room not found" });
    if (room.players.length >= 10) return cb?.({ ok: false, error: "Room full" });
    joinRoom(socket, room, name);
    cb?.({ ok: true, code });
  });

  function joinRoom(sock, room, name) {
    const safeName = (name || "Anon").slice(0, 20);
    const player = { id: sock.id, name: safeName, score: 0, connected: true };
    room.players.push(player);
    sock.join(room.code);
    currentRoom = room;
    sock.emit("joined", { code: room.code, selfId: sock.id });
    io.to(room.code).emit("chat", { system: true, text: `${safeName} joined` });
    if (room.phase === "drawing" && room.strokes.length > 0) {
      sock.emit("strokes", room.strokes);
    }
    broadcastState(room);
  }

  socket.on("start", () => {
    if (!currentRoom) return;
    if (currentRoom.hostId !== socket.id) return;
    if (currentRoom.phase !== "lobby" && currentRoom.phase !== "ended") return;
    startGame(currentRoom);
  });

  socket.on("pickWord", ({ word }) => {
    const room = currentRoom;
    if (!room || room.phase !== "picking") return;
    if (room.drawerId !== socket.id) return;
    if (!room.wordChoices?.includes(word)) return;
    startDrawing(room, word);
  });

  socket.on("stroke", (stroke) => {
    const room = currentRoom;
    if (!room) return;
    if (room.phase !== "drawing") {
      console.log(`[stroke rejected] phase=${room.phase} from=${socket.id}`);
      return;
    }
    if (room.drawerId !== socket.id) {
      console.log(`[stroke rejected] not drawer. drawerId=${room.drawerId} from=${socket.id}`);
      return;
    }
    room.strokes.push(stroke);
    socket.to(room.code).emit("stroke", stroke);
  });

  socket.on("clear", () => {
    const room = currentRoom;
    if (!room || room.phase !== "drawing" || room.drawerId !== socket.id) return;
    room.strokes = [];
    io.to(room.code).emit("clear");
  });

  socket.on("undo", () => {
    const room = currentRoom;
    if (!room || room.phase !== "drawing" || room.drawerId !== socket.id) return;
    if (room.strokes.length === 0) return;
    const lastId = room.strokes[room.strokes.length - 1].strokeId;
    if (lastId == null) {
      room.strokes.pop();
    } else {
      room.strokes = room.strokes.filter((s) => s.strokeId !== lastId);
    }
    io.to(room.code).emit("replace-strokes", room.strokes);
  });

  socket.on("updateSettings", ({ rounds, drawSeconds, customWords }) => {
    const room = currentRoom;
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== "lobby" && room.phase !== "ended") return;
    if (typeof rounds === "number") room.settings.rounds = Math.max(1, Math.min(10, Math.round(rounds)));
    if (typeof drawSeconds === "number") room.settings.drawSeconds = Math.max(20, Math.min(180, Math.round(drawSeconds)));
    if (typeof customWords === "string") {
      const arr = customWords
        .split(/[\n,]/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0 && w.length <= 30);
      const unique = [...new Set(arr.map((w) => w.toLowerCase()))];
      room.customWords = unique.length >= 3 ? unique : null;
    }
    broadcastState(room);
  });

  socket.on("chat", ({ text }) => {
    const room = currentRoom;
    if (!room) return;
    text = (text || "").toString().slice(0, 200).trim();
    if (!text) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (room.phase === "drawing" && room.word) {
      if (socket.id === room.drawerId) return;
      if (room.guessedIds.has(socket.id)) return;

      const guess = text.toLowerCase();
      const target = room.word.toLowerCase();
      if (guess === target) {
        room.guessedIds.add(socket.id);
        room.guessOrder.push(socket.id);
        const totalMs = room.settings.drawSeconds * 1000;
        const elapsed = (Date.now() - (room.endsAt - totalMs)) / 1000;
        const remaining = Math.max(0, room.settings.drawSeconds - elapsed);
        const points = Math.round(100 + (remaining / room.settings.drawSeconds) * 200);
        player.score += points;
        io.to(room.code).emit("chat", { system: true, text: `${player.name} guessed the word! (+${points})` });
        io.to(socket.id).emit("chat", { system: true, text: `The word was "${room.word}"` });
        broadcastState(room);

        const guessers = room.players.filter((p) => p.id !== room.drawerId);
        if (guessers.every((p) => room.guessedIds.has(p.id))) {
          endRound(room);
        }
        return;
      }
      if (Math.abs(guess.length - target.length) <= 1) {
        let diff = 0;
        for (let i = 0; i < Math.max(guess.length, target.length); i++) {
          if (guess[i] !== target[i]) diff++;
        }
        if (diff <= 2 && diff > 0) {
          socket.emit("chat", { system: true, text: `"${text}" is close!` });
          socket.to(room.code).emit("chat", { from: player.name, text });
          return;
        }
      }
    }
    io.to(room.code).emit("chat", { from: player.name, text });
  });

  socket.on("disconnect", () => {
    const room = currentRoom;
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;
    const [gone] = room.players.splice(idx, 1);
    io.to(room.code).emit("chat", { system: true, text: `${gone.name} left` });

    if (room.players.length === 0) {
      clearTimers(room);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }
    if (room.drawerId === socket.id && (room.phase === "drawing" || room.phase === "picking")) {
      endRound(room);
      return;
    }
    if (room.turnIndex >= idx) room.turnIndex--;
    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Scribble running at http://localhost:${PORT}`);
});
