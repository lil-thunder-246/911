const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const inspectThresholdPx = 160;

const assets = {
  bg: new Image(),
  plane: new Image(),
  building: new Image(),
  explosion: new Image(),
  crash: new Audio("crash.wav")
};

assets.bg.src = "bg.png";
assets.plane.src = "plane.png";
assets.building.src = "building.png";
assets.explosion.src = "explosion.png";

const MODES = {
  ARCADE: {
    name: "ARCADE",
    gravity: 0.36,
    flapImpulse: -7.4,
    baseScrollSpeed: 2.5,
    gapMin: 175,
    gapMax: 200,
    spawnEvery: 1600,
    windStrength: 0,
    scoreFactor: 1
  },
  PRO: {
    name: "PRO",
    gravity: 0.41,
    flapImpulse: -7.8,
    baseScrollSpeed: 3.1,
    gapMin: 155,
    gapMax: 180,
    spawnEvery: 1600,
    windStrength: 0,
    scoreFactor: 1.4
  }
};

let activeMode = MODES.PRO;
let state = "menu";
let now = 0;
let last = 0;
let accumulator = 0;
const fixedStep = 1000 / 60;

let parallaxX = 0;
let spawnTimer = 0;
let shakeTime = 0;
let flashTime = 0;
let score = 0;
let nearMiss = 0;
let bestByMode = {
  ARCADE: Number(localStorage.getItem("floppy_best_arcade") || 0),
  PRO: Number(localStorage.getItem("floppy_best_pro") || 0)
};

const plane = {
  x: 66,
  y: 240,
  width: 96,
  height: 40,
  vy: 0,
  angle: 0,
  alive: true
};

let pipes = [];

const explosion = {
  active: false,
  x: 0,
  y: 0,
  size: 90,
  frame: 0,
  fps: 24,
  t: 0,
  delayMs: 950,
  resultDelayMs: 500,
  elapsedMs: 0
};

const crashHold = {
  holdMs: 130,
  currentHoldMs: 130,
  elapsedMs: 0
};

const crashUi = {
  retryBtn: { x: 0, y: 0, w: 132, h: 42 }
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

const trail = [];
let trailSpawnMs = 0;

function spawnTrailParticle() {
  trail.push({
    x: plane.x + 8,
    y: plane.y + plane.height * 0.58 + rand(-2, 2),
    vx: -2.4 + rand(-0.7, 0.4),
    vy: -plane.vy * 0.1 + rand(-0.2, 0.2),
    life: 1,
    size: rand(2.2, 4.6)
  });
}

function updateTrail(dt) {
  const ticks = dt / (1000 / 60);
  for (let i = trail.length - 1; i >= 0; i--) {
    const t = trail[i];
    t.x += t.vx * ticks;
    t.y += t.vy * ticks;
    t.vy += 0.015 * ticks;
    t.vx *= 0.985;
    t.size += 0.035 * ticks;
    t.life -= 0.03 * ticks;
    if (t.life <= 0) trail.splice(i, 1);
  }
}

function resetRun() {
  score = 0;
  nearMiss = 0;
  pipes = [];
  spawnTimer = 0;
  parallaxX = 0;
  shakeTime = 0;
  flashTime = 0;
  plane.x = 66;
  plane.y = 240;
  plane.vy = 0;
  plane.angle = 0;
  plane.alive = true;
  explosion.active = false;
  explosion.frame = 0;
  explosion.t = 0;
  explosion.elapsedMs = 0;
  crashHold.elapsedMs = 0;
  trail.length = 0;
  trailSpawnMs = 0;
}

function startRun() {
  resetRun();
  state = "playing";
}

function toggleMode() {
  activeMode = activeMode === MODES.PRO ? MODES.ARCADE : MODES.PRO;
}

function flap() {
  if (state === "menu") {
    startRun();
    plane.vy = activeMode.flapImpulse;
    return;
  }
  if (state === "crashed") {
    if (!isCrashResultVisible()) return;
    state = "menu";
    resetRun();
    return;
  }
  if (state !== "playing") return;
  const speedBoost = clamp(-plane.vy * 0.13, -0.8, 1.9);
  plane.vy = activeMode.flapImpulse - speedBoost;
}

function spawnPipe() {
  const modeScale = clamp(score / 20, 0, 1);
  const gap = rand(
    activeMode.gapMin - modeScale * 12,
    activeMode.gapMax - modeScale * 8
  );
  const topMin = 0;
  const topMax = canvas.height - gap;
  const top = rand(topMin, topMax);
  pipes.push({
    x: canvas.width + 18,
    width: 100,
    top,
    gap,
    scored: false,
    nearScored: false
  });
}

function getSpeed() {
  const ramp = clamp(score / 35, 0, 1) * 1.6;
  return activeMode.baseScrollSpeed + ramp;
}

function killPlane(reason = "generic", frozenY = null) {
  if (!plane.alive) return;
  plane.alive = false;
  if (typeof frozenY === "number") {
    plane.y = frozenY;
  }
  plane.vy = 0;
  shakeTime = 320;
  flashTime = 150;
  crashHold.currentHoldMs = reason === "pipe" ? 280 : crashHold.holdMs;
  explosion.active = true;
  explosion.frame = 0;
  explosion.t = 0;
  explosion.elapsedMs = 0;
  crashHold.elapsedMs = 0;
  explosion.x = plane.x + plane.width * 0.5;
  explosion.y = plane.y + plane.height * 0.5;
  assets.crash.currentTime = 0;
  assets.crash.play().catch(() => {});
  state = "crashed";

  const key = activeMode.name === "PRO" ? "floppy_best_pro" : "floppy_best_arcade";
  if (score > bestByMode[activeMode.name]) {
    bestByMode[activeMode.name] = score;
    localStorage.setItem(key, String(score));
  }
}

function circleIntersectsRect(cx, cy, r, rx, ry, rw, rh) {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy <= r * r;
}

function collideWithPipe(p) {
  // Tighten the hitboxes slightly so transparent sprite padding does not
  // trigger premature crashes, while keeping consistent AABB collision.
  const planePadX = -10;
  const planePadY = 0;
  const pipePadX = 16;

  const px = plane.x + planePadX;
  const py = plane.y + planePadY;
  const pw = plane.width - planePadX * 2;
  const ph = plane.height - planePadY * 2;

  const pipeLeft = p.x + pipePadX;
  const pipeRight = p.x + p.width - pipePadX;
  const gapTop = p.top;
  const gapBottom = p.top + p.gap;

  const overlapsPipeX = px + pw > pipeLeft && px < pipeRight;
  if (!overlapsPipeX) return false;

  const hitsTopPipe = py < gapTop;
  const hitsBottomPipe = py + ph > gapBottom;
  return hitsTopPipe || hitsBottomPipe;
}

function updateGame(dt) {
  const seconds = dt / 1000;
  if (state !== "crashed") {
    parallaxX -= getSpeed() * 0.22;
  }

  if (state === "playing") {
    spawnTimer += dt;
    if (spawnTimer >= activeMode.spawnEvery) {
      spawnTimer = 0;
      spawnPipe();
    }

    const wind =
      activeMode.windStrength > 0
        ? Math.sin(now * 0.0019) * activeMode.windStrength
        : 0;

    plane.vy += activeMode.gravity + wind * seconds * 60;
    plane.vy *= 0.996;
    plane.vy = clamp(plane.vy, -11, 12.5);
    plane.y += plane.vy;
    const targetAngle = clamp(plane.vy * 0.075, -0.62, 1.05);
    plane.angle = lerp(plane.angle, targetAngle, 0.18);

    trailSpawnMs += dt;
    const burstEvery = plane.vy < -1.2 ? 18 : 34;
    while (trailSpawnMs >= burstEvery) {
      spawnTrailParticle();
      trailSpawnMs -= burstEvery;
    }
    updateTrail(dt);

    const speed = getSpeed();
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= speed;

      if (!p.scored && p.x + p.width < plane.x) {
        p.scored = true;
        score += 1;
      }

      const center = p.top + p.gap * 0.5;
      const planeCenter = plane.y + plane.height * 0.5;
      const nearDistance = Math.abs(planeCenter - center);
      if (!p.nearScored && p.scored && nearDistance <= 7) {
        p.nearScored = true;
        nearMiss += 1;
        score += 1;
      }

      if (collideWithPipe(p)) {
        // Keep the plane at the true collision position instead of rewinding Y.
        killPlane("pipe");
        break;
      }

      if (p.x + p.width < -20) {
        pipes.splice(i, 1);
      }
    }

    if (plane.y <= 0 || plane.y + plane.height >= canvas.height) {
      killPlane();
    }
  } else if (state === "crashed") {
    updateTrail(dt);
    explosion.elapsedMs += dt;

    if (explosion.active && explosion.elapsedMs >= explosion.delayMs) {
      explosion.t += dt;
      if (explosion.t >= 1000 / explosion.fps) {
        explosion.t = 0;
        explosion.frame += 1;
        if (explosion.frame > 5) {
          explosion.active = false;
        }
      }
    }
  } else {
    // Keep idle hover centered instead of accumulating drift each frame.
    const bob = Math.sin(now * 0.004) * 6;
    plane.y = 240 + bob;
    plane.angle = lerp(plane.angle, Math.sin(now * 0.006) * 0.08, 0.1);
  }

  if (shakeTime > 0) shakeTime -= dt;
  if (flashTime > 0) flashTime -= dt;
}

function drawPipe(p) {
  const topEdgeBleed = 34;
  const bottomEdgeBleed = 24;

  ctx.save();
  ctx.scale(1, -1);
  ctx.drawImage(assets.building, p.x, -p.top, p.width, p.top + topEdgeBleed);
  ctx.restore();

  const bottomHeight = canvas.height - (p.top + p.gap);
  ctx.drawImage(
    assets.building,
    p.x,
    p.top + p.gap,
    p.width,
    bottomHeight + bottomEdgeBleed
  );
}

function drawPlane() {
  const shadowStretch = clamp(1 + Math.abs(plane.vy) * 0.06, 1, 1.5);
  ctx.save();
  ctx.fillStyle = "rgba(4, 10, 18, 0.28)";
  ctx.beginPath();
  ctx.ellipse(
    plane.x + plane.width * 0.5 + 8,
    plane.y + plane.height + 16,
    plane.width * 0.32 * shadowStretch,
    plane.height * 0.16,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(plane.x + plane.width * 0.5, plane.y + plane.height * 0.5);
  ctx.rotate(plane.angle);
  ctx.drawImage(
    assets.plane,
    -plane.width * 0.5,
    -plane.height * 0.5,
    plane.width,
    plane.height
  );
  ctx.restore();
}

function drawTrail() {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const alpha = clamp(t.life, 0, 1) * 0.45;
    ctx.fillStyle = `rgba(222, 236, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawExplosion() {
  if (!explosion.active || explosion.elapsedMs < explosion.delayMs) return;
  const frames = 6;
  const frameWidth = assets.explosion.width / frames;
  const f = clamp(explosion.frame, 0, frames - 1);
  ctx.drawImage(
    assets.explosion,
    frameWidth * f,
    0,
    frameWidth,
    assets.explosion.height,
    explosion.x - explosion.size * 0.5,
    explosion.y - explosion.size * 0.5,
    explosion.size,
    explosion.size
  );
}

function drawHud() {
  const speedText = getSpeed().toFixed(1);
  ctx.fillStyle = "rgba(5, 16, 32, 0.64)";
  ctx.fillRect(10, 10, 190, 78);
  ctx.strokeStyle = "rgba(169, 210, 255, 0.4)";
  ctx.strokeRect(10, 10, 190, 78);

  ctx.fillStyle = "#e8f3ff";
  ctx.font = "bold 20px Segoe UI";
  ctx.fillText(`Score ${score}`, 20, 35);

  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#b6d5ff";
  ctx.fillText(`Mode: ${activeMode.name}`, 20, 53);
  ctx.fillText(`Speed: ${speedText}`, 20, 68);
  ctx.fillText(`Near Miss: ${nearMiss}`, 20, 83);

  const best = bestByMode[activeMode.name] || 0;
  ctx.textAlign = "right";
  ctx.fillText(`Best ${best}`, canvas.width - 14, 28);
  ctx.textAlign = "left";
}

function drawOverlays() {
  if (state === "menu") {
    ctx.fillStyle = "rgba(0, 7, 18, 0.62)";
    ctx.fillRect(40, 145, 320, 210);
    ctx.strokeStyle = "rgba(176, 217, 255, 0.35)";
    ctx.strokeRect(40, 145, 320, 210);

    ctx.fillStyle = "#e6f2ff";
    ctx.font = "bold 28px Segoe UI";
    ctx.fillText("911 PLANE", 125, 190);

    ctx.font = "bold 14px Segoe UI";
    ctx.fillStyle = "#b9d8ff";
    ctx.fillText(`${activeMode.name} MODE`, 152, 215);

    ctx.font = "13px Segoe UI";
    ctx.fillStyle = "#c7dfff";
    ctx.fillText("Space / Click: Fly", 132, 252);
    ctx.fillText("M: Toggle ARCADE / PRO", 112, 272);
    ctx.fillText("Detailed flight model and adaptive pace", 88, 304);
    ctx.fillText("Press Space or Click to launch", 108, 325);
  }

  if (state === "crashed" && isCrashResultVisible()) {
    const panelW = 340;
    const panelH = 220;
    const panelX = (canvas.width - panelW) * 0.5;
    const panelY = 130;

    ctx.fillStyle = "rgba(1, 10, 24, 0.72)";
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = "rgba(176, 217, 255, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.fillStyle = "#e9f4ff";
    ctx.font = "bold 24px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("MISSION ACCOMPLISHED", canvas.width * 0.5, panelY + 46);

    ctx.fillStyle = "#c5defc";
    ctx.font = "14px Segoe UI";
    ctx.fillText(`Score: ${score}`, canvas.width * 0.5, panelY + 78);
    ctx.fillText(`Best (${activeMode.name}): ${bestByMode[activeMode.name] || 0}`, canvas.width * 0.5, panelY + 98);

    crashUi.retryBtn.x = panelX + (panelW - crashUi.retryBtn.w) * 0.5;
    crashUi.retryBtn.y = panelY + 145;

    drawCrashButton(crashUi.retryBtn, "TRY AGAIN");
    ctx.textAlign = "left";
  }

}

function drawCrashButton(btn, label) {
  ctx.fillStyle = "rgba(17, 52, 90, 0.92)";
  ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
  ctx.strokeStyle = "rgba(176, 217, 255, 0.6)";
  ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
  ctx.fillStyle = "#e8f3ff";
  ctx.font = "bold 14px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(label, btn.x + btn.w * 0.5, btn.y + 27);
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const shakeOffset = shakeTime > 0 ? (Math.random() - 0.5) * 8 : 0;
  ctx.save();
  ctx.translate(shakeOffset, shakeOffset * 0.65);

  const bgX = parallaxX % canvas.width;
  ctx.drawImage(assets.bg, bgX - canvas.width, 0, canvas.width, canvas.height);
  ctx.drawImage(assets.bg, bgX, 0, canvas.width, canvas.height);
  ctx.drawImage(assets.bg, bgX + canvas.width, 0, canvas.width, canvas.height);

  // Atmospheric depth to reduce the flat sprite look.
  const skyFade = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyFade.addColorStop(0, "rgba(188, 216, 255, 0.08)");
  skyFade.addColorStop(1, "rgba(7, 20, 38, 0.12)");
  ctx.fillStyle = skyFade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const p of pipes) drawPipe(p);
  drawTrail();
  const explosionStarted = state === "crashed" && explosion.elapsedMs >= explosion.delayMs;
  if (!explosionStarted) {
    drawPlane();
  }
  drawExplosion();
  drawHud();
  drawOverlays();
  ctx.restore();

  if (flashTime > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashTime / 400})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function frameLoop(ts) {
  now = ts;
  if (!last) last = ts;
  accumulator += ts - last;
  last = ts;

  while (accumulator >= fixedStep) {
    updateGame(fixedStep);
    accumulator -= fixedStep;
  }

  render();
  requestAnimationFrame(frameLoop);
}

function onKey(e) {
  if (e.code === "Space") {
    e.preventDefault();
    flap();
    return;
  }
  if (e.code === "KeyM" && state !== "playing") {
    toggleMode();
  }
}

function onPointerDown(e) {
  if (state === "crashed" && isCrashResultVisible()) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (pointInRect(x, y, crashUi.retryBtn)) {
      startRun();
      return;
    }
  }
  flap();
}

function isCrashResultVisible() {
  return explosion.elapsedMs >= explosion.delayMs + explosion.resultDelayMs;
}

function updateInspectMode() {
  const widthGap = Math.abs(window.outerWidth - window.innerWidth);
  const heightGap = Math.abs(window.outerHeight - window.innerHeight);
  const inspectOpen = widthGap > inspectThresholdPx || heightGap > inspectThresholdPx;
  document.body.classList.toggle("inspect-mode", inspectOpen);
}

function ready() {
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", updateInspectMode);
  updateInspectMode();
  resetRun();
  requestAnimationFrame(frameLoop);
}

function preload() {
  const images = [assets.bg, assets.plane, assets.building, assets.explosion];
  return Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) resolve();
          else img.onload = resolve;
        })
    )
  );
}

preload().then(ready);
