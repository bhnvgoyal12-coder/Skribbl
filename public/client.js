const socket = io();

const COLORS = [
  "#1a1612", "#e63946", "#f4a300", "#f9e07f",
  "#4f7d52", "#2c6cb0", "#6db5d1", "#ff5a8c",
  "#5d3a6b", "#8b4513", "#7f8c8d", "#1a472a"
];

const AVATAR_COLORS = ["#e63946", "#f4a300", "#2c6cb0", "#4f7d52", "#ff5a8c", "#5d3a6b", "#8b4513", "#6db5d1"];
const AVATAR_EMOJI = ["🦊", "🐻", "🐼", "🐸", "🐙", "🦁", "🐯", "🐰", "🐶", "🐱", "🦉", "🦄", "🐝", "🦋", "🐧", "🦝", "🐺", "🦔", "🦦", "🦩"];

const $ = (id) => document.getElementById(id);
const screens = {
  home: $("screen-home"),
  game: $("screen-game"),
  gameover: $("screen-gameover"),
};

function show(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle("hidden", k !== name);
}

const state = {
  selfId: null,
  hostId: null,
  drawerId: null,
  phase: "lobby",
  word: null,
  endsAt: null,
  color: "#1a1612",
  size: 6,
  tool: "pen",
  isDrawing: false,
  lastPoint: null,
  strokeId: null,
  lastTick: null,
  textareaInitialized: false,
};

// ====== Avatars (deterministic from name) ======
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) >>> 0;
  return h;
}
function avatarFor(name) {
  const h = hashName(name || "Anon");
  return {
    color: AVATAR_COLORS[h % AVATAR_COLORS.length],
    emoji: AVATAR_EMOJI[Math.floor(h / AVATAR_COLORS.length) % AVATAR_EMOJI.length],
  };
}
function avatarHtml(name) {
  const a = avatarFor(name);
  return `<span class="avatar" style="background:${a.color}">${a.emoji}</span>`;
}

// ====== Sounds (Web Audio) ======
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (audioCtx?.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur, type = "sine", vol = 0.1, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
const sound = {
  correct: () => { tone(523, 0.12, "triangle", 0.15); tone(659, 0.12, "triangle", 0.15, 0.09); tone(784, 0.25, "triangle", 0.15, 0.18); },
  tick:    () => tone(880, 0.04, "square", 0.04),
  timeout: () => { tone(440, 0.15, "sawtooth", 0.1); tone(330, 0.3, "sawtooth", 0.1, 0.15); },
  fanfare: () => { tone(523, 0.12, "triangle", 0.15); tone(659, 0.12, "triangle", 0.15, 0.12); tone(784, 0.12, "triangle", 0.15, 0.24); tone(1047, 0.4, "triangle", 0.18, 0.36); },
  join:    () => { tone(660, 0.08, "triangle", 0.06); tone(880, 0.12, "triangle", 0.06, 0.07); },
};

// First user interaction unlocks audio
document.addEventListener("click", () => ensureAudio(), { once: true });

// ====== Confetti ======
function confetti(count = 40, originX = null, originY = null) {
  const x = originX ?? window.innerWidth / 2;
  const y = originY ?? window.innerHeight / 3;
  const colors = ["#e63946", "#f4a300", "#2c6cb0", "#4f7d52", "#ff5a8c", "#5d3a6b", "#f9e07f"];
  const shapes = ["square", "rect", "circle"];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = `confetti-bit ${shapes[i % shapes.length]}`;
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.left = x + "px";
    el.style.top = y + "px";
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI;
    const velocity = 200 + Math.random() * 400;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity;
    const rot = (Math.random() - 0.5) * 1440;
    el.animate(
      [
        { transform: `translate(0, 0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 800}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 800, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" }
    );
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}

// ====== Home screen ======
function requireName() {
  const name = $("name-input").value.trim();
  if (!name) {
    $("home-error").textContent = "Please enter your name first";
    const input = $("name-input");
    input.classList.remove("shake");
    void input.offsetWidth; // re-trigger animation
    input.classList.add("shake");
    input.focus();
    return null;
  }
  $("home-error").textContent = "";
  return name;
}

$("name-input").addEventListener("input", () => {
  if ($("home-error").textContent === "Please enter your name first") {
    $("home-error").textContent = "";
  }
});

$("btn-create").addEventListener("click", () => {
  ensureAudio();
  const name = requireName();
  if (!name) return;
  socket.emit("create", { name }, (res) => {
    if (!res.ok) $("home-error").textContent = res.error || "Error";
  });
});

$("btn-join").addEventListener("click", () => {
  ensureAudio();
  const name = requireName();
  if (!name) return;
  const code = $("code-input").value.trim().toUpperCase();
  if (!code) { $("home-error").textContent = "Enter a room code"; return; }
  socket.emit("join", { name, code }, (res) => {
    if (!res.ok) $("home-error").textContent = res.error || "Error";
  });
});

// Pressing Enter from either field — Join if code present, else Create
[$("name-input"), $("code-input")].forEach((el) =>
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const hasCode = $("code-input").value.trim().length > 0;
    (hasCode ? $("btn-join") : $("btn-create")).click();
  })
);

const urlParams = new URLSearchParams(location.search);
const urlRoom = urlParams.get("room");
if (urlRoom) {
  const code = urlRoom.toUpperCase();
  $("code-input").value = code;
  const hint = $("join-hint");
  hint.querySelector("strong").textContent = code;
  hint.classList.remove("hidden");
  // Focus the name input so the user can type immediately
  setTimeout(() => $("name-input").focus(), 100);
} else {
  setTimeout(() => $("name-input").focus(), 100);
}

// ====== Game UI ======
$("btn-copy").addEventListener("click", () => {
  const url = `${location.origin}?room=${$("room-code").textContent}`;
  navigator.clipboard?.writeText(url);
  $("btn-copy").textContent = "Copied!";
  setTimeout(() => ($("btn-copy").textContent = "Copy link"), 1500);
});

$("btn-start").addEventListener("click", () => socket.emit("start"));

// Palette
const paletteEl = $("palette");
function setActiveSwatch(color) {
  paletteEl.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.color === color));
}
COLORS.forEach((c) => {
  const el = document.createElement("div");
  el.className = "swatch";
  el.style.background = c;
  el.dataset.color = c;
  if (c === state.color) el.classList.add("active");
  el.addEventListener("click", () => {
    state.color = c;
    state.tool = "pen";
    setActiveSwatch(c);
    setActiveTool("pen");
  });
  paletteEl.appendChild(el);
});

$("size").addEventListener("input", (e) => { state.size = +e.target.value; });

// Tool buttons
function setActiveTool(tool) {
  $("btn-pen").classList.toggle("active", tool === "pen");
  $("btn-eraser").classList.toggle("active", tool === "eraser");
}
$("btn-pen").addEventListener("click", () => { state.tool = "pen"; setActiveTool("pen"); });
$("btn-eraser").addEventListener("click", () => { state.tool = "eraser"; setActiveTool("eraser"); });
$("btn-undo").addEventListener("click", () => {
  if (state.drawerId !== state.selfId) return;
  socket.emit("undo");
});
$("btn-clear").addEventListener("click", () => {
  if (state.drawerId !== state.selfId) return;
  socket.emit("clear");
});

// Canvas
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
ctx.lineCap = "round";
ctx.lineJoin = "round";

function ctxClear() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
ctxClear();

function drawStroke(s) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.beginPath();
  ctx.moveTo(s.x0 * canvas.width, s.y0 * canvas.height);
  ctx.lineTo(s.x1 * canvas.width, s.y1 * canvas.height);
  ctx.stroke();
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

function canDraw() {
  return state.drawerId === state.selfId && state.phase === "drawing";
}

function currentStrokeColor() {
  return state.tool === "eraser" ? "#ffffff" : state.color;
}
function currentStrokeSize() {
  return state.tool === "eraser" ? Math.max(state.size * 2.5, 16) : state.size;
}

function startDraw(e) {
  if (!canDraw()) return;
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  state.isDrawing = true;
  state.lastPoint = getPoint(e);
  state.strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const stroke = {
    strokeId: state.strokeId,
    x0: state.lastPoint.x, y0: state.lastPoint.y,
    x1: state.lastPoint.x, y1: state.lastPoint.y,
    color: currentStrokeColor(),
    size: currentStrokeSize(),
  };
  drawStroke(stroke);
  socket.emit("stroke", stroke);
}

function moveDraw(e) {
  if (!state.isDrawing) return;
  e.preventDefault();
  const p = getPoint(e);
  const stroke = {
    strokeId: state.strokeId,
    x0: state.lastPoint.x, y0: state.lastPoint.y,
    x1: p.x, y1: p.y,
    color: currentStrokeColor(),
    size: currentStrokeSize(),
  };
  drawStroke(stroke);
  socket.emit("stroke", stroke);
  state.lastPoint = p;
}

function endDraw(e) {
  if (e?.pointerId != null) canvas.releasePointerCapture?.(e.pointerId);
  state.isDrawing = false;
  state.lastPoint = null;
  state.strokeId = null;
}

canvas.addEventListener("pointerdown", startDraw);
canvas.addEventListener("pointermove", moveDraw);
canvas.addEventListener("pointerup", endDraw);
canvas.addEventListener("pointercancel", endDraw);
canvas.addEventListener("pointerleave", (e) => { if (state.isDrawing) endDraw(e); });

// Chat
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("chat", { text });
  input.value = "";
});

// ====== Settings ======
function sendSettings(partial) {
  socket.emit("updateSettings", partial);
}
$("set-rounds").addEventListener("change", (e) => sendSettings({ rounds: +e.target.value }));
$("set-time").addEventListener("change", (e) => sendSettings({ drawSeconds: +e.target.value }));
$("set-words").addEventListener("blur", (e) => sendSettings({ customWords: e.target.value }));

// ====== Socket handlers ======
socket.on("joined", ({ code, selfId }) => {
  state.selfId = selfId;
  $("room-code").textContent = code;
  show("game");
});

socket.on("state", (s) => {
  const prevPhase = state.phase;
  state.hostId = s.hostId;
  state.drawerId = s.drawerId;
  state.phase = s.phase;
  state.endsAt = s.endsAt;

  const amHost = s.hostId === state.selfId;
  const inLobby = s.phase === "lobby" || s.phase === "ended";

  // Players list
  const list = $("players-list");
  list.innerHTML = "";
  const ranked = [...s.players].sort((a, b) => b.score - a.score);
  ranked.forEach((p) => {
    const li = document.createElement("li");
    if (p.isDrawer) li.classList.add("drawer");
    if (p.guessed) li.classList.add("guessed");
    if (p.id === state.selfId) li.classList.add("you");
    li.innerHTML = `
      <div class="player-main">
        ${avatarHtml(p.name)}
        <span class="pname">${escapeHtml(p.name)}${p.isDrawer ? ' <span class="drawer-badge">✏️</span>' : ""}</span>
      </div>
      <span class="score">${p.score}</span>`;
    list.appendChild(li);
  });

  // Round info
  $("round-info").textContent = s.round > 0 ? `Round ${s.round}/${s.totalRounds}` : "Lobby";

  // Word display
  const wordEl = $("word-display");
  if (s.phase === "drawing") {
    wordEl.textContent = (state.drawerId === state.selfId && state.word) ? state.word : (s.mask || "");
  } else if (s.phase === "picking") {
    const drawer = s.players.find((p) => p.id === s.drawerId);
    wordEl.textContent = drawer ? `${drawer.name} is choosing...` : "";
  } else if (s.phase !== "reveal") {
    wordEl.textContent = "";
  }

  // Start button — host, in lobby/ended, 2+ players
  const showStart = inLobby && amHost && s.players.length >= 2;
  $("btn-start").classList.toggle("hidden", !showStart);
  $("btn-start").textContent = s.phase === "ended" ? "Play Again" : "Start Game";

  // Tools — only drawer during drawing
  const amDrawer = state.drawerId === state.selfId;
  $("tools").classList.toggle("hidden", !(s.phase === "drawing" && amDrawer));
  canvas.classList.toggle("not-drawer", !(s.phase === "drawing" && amDrawer));

  // Draw status pill
  const status = $("draw-status");
  if (s.phase === "drawing") {
    status.classList.remove("hidden");
    if (amDrawer) {
      status.textContent = "Your turn — draw!";
      status.classList.remove("guesser");
    } else {
      const drawer = s.players.find((p) => p.id === s.drawerId);
      status.textContent = `${drawer?.name || "Someone"} is drawing — guess in chat!`;
      status.classList.add("guesser");
    }
  } else {
    status.classList.add("hidden");
  }

  // Settings panel — visible in lobby/ended for everyone
  const panel = $("settings-panel");
  panel.classList.toggle("hidden", !inLobby);
  if (inLobby && s.settings) {
    $("set-rounds").value = s.settings.rounds;
    $("set-time").value = s.settings.drawSeconds;
    [$("set-rounds"), $("set-time"), $("set-words")].forEach((el) => (el.disabled = !amHost));
    $("words-summary").textContent = s.customWordCount > 0
      ? `Using ${s.customWordCount} custom words`
      : "Default word pack";
    if (!state.textareaInitialized && amHost) state.textareaInitialized = true;
  }

  if (s.phase !== "picking") $("choose-panel").classList.add("hidden");

  // Overlay for lobby
  const overlay = $("overlay");
  if (s.phase === "lobby") {
    overlay.classList.remove("hidden");
    overlay.innerHTML = `<div>Waiting for players</div><div>share the code <strong>${escapeHtml(s.code)}</strong> with a friend</div>`;
  } else {
    overlay.classList.add("hidden");
  }
});

socket.on("choose", ({ choices, drawerId, drawerName }) => {
  const panel = $("choose-panel");
  const btns = $("choose-buttons");
  btns.innerHTML = "";
  if (drawerId === state.selfId) {
    $("choose-title").textContent = "Choose a word";
    choices.forEach((w) => {
      const b = document.createElement("button");
      b.textContent = w;
      b.addEventListener("click", () => {
        socket.emit("pickWord", { word: w });
        panel.classList.add("hidden");
      });
      btns.appendChild(b);
    });
  } else {
    $("choose-title").textContent = `${drawerName} is choosing a word...`;
  }
  panel.classList.remove("hidden");
});

socket.on("hideChoose", () => { $("choose-panel").classList.add("hidden"); });
socket.on("word", ({ word }) => { state.word = word; });
socket.on("clear", () => { ctxClear(); });
socket.on("stroke", (s) => { drawStroke(s); });
socket.on("strokes", (strokes) => { ctxClear(); for (const s of strokes) drawStroke(s); });
socket.on("replace-strokes", (strokes) => { ctxClear(); for (const s of strokes) drawStroke(s); });

socket.on("reveal", ({ word }) => {
  $("word-display").textContent = `The word was: ${word}`;
  $("choose-panel").classList.add("hidden");
  state.word = null;
  sound.timeout();
});

socket.on("chat", (msg) => {
  const li = document.createElement("li");
  if (msg.system) {
    li.className = "system";
    li.textContent = msg.text;
    if (msg.text.includes("guessed the word")) {
      li.classList.add("correct");
      sound.correct();
      confetti(50);
    } else if (msg.text.endsWith("joined")) {
      sound.join();
    }
  } else {
    li.innerHTML = `${avatarHtml(msg.from)}<span class="name">${escapeHtml(msg.from)}</span> ${escapeHtml(msg.text)}`;
  }
  const list = $("chat-list");
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
});

socket.on("gameover", ({ ranked }) => {
  const ol = $("final-scores");
  ol.innerHTML = "";
  ranked.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `${avatarHtml(p.name)}<span class="pname">${escapeHtml(p.name)}</span><span class="score">${p.score}</span>`;
    ol.appendChild(li);
  });
  show("gameover");
  sound.fanfare();
  setTimeout(() => confetti(80), 100);
  setTimeout(() => confetti(60), 500);
});

$("btn-back").addEventListener("click", () => { show("game"); });

// Timer + countdown ticks
setInterval(() => {
  const timer = $("timer");
  if (!state.endsAt || state.phase === "lobby" || state.phase === "ended") {
    timer.textContent = "";
    timer.classList.remove("urgent");
    state.lastTick = null;
    return;
  }
  const s = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  timer.textContent = `${s}s`;
  const urgent = s <= 10 && state.phase === "drawing";
  timer.classList.toggle("urgent", urgent);
  if (urgent && s !== state.lastTick && s > 0) {
    sound.tick();
    state.lastTick = s;
  }
  if (!urgent) state.lastTick = null;
}, 200);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
