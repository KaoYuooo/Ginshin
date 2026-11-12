/* 合成银新：所有可调参数集中在这里，图片需为透明背景的正方形 PNG。 */
const CONFIG = {
  width: 400,
  height: 600,
 images: [
    'img/level1.png?v=3', 'img/level2.png?v=3', 'img/level3.png?v=3', 'img/level4.png?v=3',
    'img/level5.png?v=3', 'img/level6.png?v=3', 'img/level7.png?v=3', 'img/level8.png?v=3',
    'img/level9.png?v=3', 'img/level10.png?v=3'
],
  // 每个等级的物理半径（像素）、合成得分和无素材时的占位颜色
  radii: [15, 22, 30, 38, 48, 52, 58, 65, 73, 82, 94],
  scores: [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 100],
  placeholderColors: ['#f3a77c', '#f4c66d', '#db8e78', '#a8c987', '#f0a3ae', '#9dcae1', '#c4a4dc', '#f0cc8f', '#91c8b3', '#e48b71', '#d2a2b9'],
  dropLevelCount: 4,          // 初始仅掉落数字 1～4
  // 达到对应分数后，随机掉落池逐步加入更高数字的球
  spawnUnlocks: [
    { minScore: 50, levelCount: 5 },
    { minScore: 100, levelCount: 6 },
    { minScore: 180, levelCount: 7 }
  ],
  winLevel: 10,               // 合成出数字 10 的球即获胜（10 不会随机掉落）
  dangerLine: 112,            // 危险红线的 y 坐标
  dropY: 57,
  dropCooldown: 420,          // 两次投放之间的冷却时间（毫秒）
  gravity: { x: 0, y: 1, scale: 0.001 },
  fixedStep: 1000 / 60,
  maxFrameDelta: 100,          // 切换标签页后限制补帧，避免物理瞬移
  wallThickness: 18,
  leftWallX: 9,
  rightWallX: 391,
  dangerSpeedThreshold: 0.7,  // 速度低于此值视为稳定
  mergeLockMs: 1500,          // 新合成水果的死亡判定保护时间
  dangerHoldMs: 500,           // 稳定越线持续时间后结束
  previewAlpha: 0.55
};

(() => {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const scoreElement = document.getElementById('score');
  const finalScoreElement = document.getElementById('final-score');
  const gameOverElement = document.getElementById('game-over');
  const resultEyebrowElement = document.getElementById('result-eyebrow');
  const resultTitleElement = document.getElementById('result-title');
  const restartButton = document.getElementById('restart-button');
  const loadingScreen = document.getElementById('loading-screen');
  const loadingStatus = document.getElementById('loading-status');
  const loadingProgress = document.querySelector('.loading-progress');
  const loadingProgressBar = document.getElementById('loading-progress-bar');
  const loadingCount = document.getElementById('loading-count');
  const startButton = document.getElementById('start-button');

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.x = CONFIG.gravity.x;
  engine.gravity.y = CONFIG.gravity.y;
  engine.gravity.scale = CONFIG.gravity.scale;

  let loadedImageCount = 0;
  let failedImageCount = 0;
  const images = CONFIG.images.map((src) => {
    const image = new Image();
    image.loaded = false;
    image.onload = () => { image.loaded = true; };
    image.onerror = () => { image.loaded = false; };
    image.src = src;
    return image;
  });

  let score = 0;
  let pointerX = CONFIG.width / 2;
  let currentLevel = 0;
  let lastDropAt = -Infinity;
  let lastFrameAt = 0;
  let accumulator = 0;
  let gameOver = false;
  let gameStarted = false;
  const mergeQueue = [];
  const dangerTimers = new Map();

  // 物理边界留在画布内，顶部开放，方便危险线判断。
  function addWalls() {
    const wallOptions = { isStatic: true, friction: 0.8, restitution: 0.05, label: 'wall' };
    const left = Bodies.rectangle(CONFIG.leftWallX, CONFIG.height / 2, CONFIG.wallThickness, CONFIG.height * 2, wallOptions);
    const right = Bodies.rectangle(CONFIG.rightWallX, CONFIG.height / 2, CONFIG.wallThickness, CONFIG.height * 2, wallOptions);
    const floor = Bodies.rectangle(CONFIG.width / 2, CONFIG.height - CONFIG.wallThickness / 2, CONFIG.width, CONFIG.wallThickness, wallOptions);
    Composite.add(engine.world, [left, right, floor]);
  }

  // 图片缺失时绘制彩色占位圆，方便直接运行和调试。
  function drawFruit(target, level, x, y, radius, angle = 0, alpha = 1) {
    target.save();
    target.globalAlpha = alpha;
    target.translate(x, y);
    target.rotate(angle);

    const image = images[level];
    if (image && image.loaded && image.naturalWidth > 0) {
      target.save();
      target.beginPath();
      target.arc(0, 0, radius, 0, Math.PI * 2);
      target.clip();
      target.drawImage(image, -radius, -radius, radius * 2, radius * 2);
      target.restore();
      target.beginPath();
      target.arc(0, 0, radius - 0.75, 0, Math.PI * 2);
      target.strokeStyle = 'rgba(255,255,255,.55)';
      target.lineWidth = Math.max(1, radius * 0.045);
      target.stroke();
    } else {
      const color = CONFIG.placeholderColors[level % CONFIG.placeholderColors.length];
      const gradient = target.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.08, 0, 0, radius);
      gradient.addColorStop(0, '#fff5df');
      gradient.addColorStop(0.35, color);
      gradient.addColorStop(1, shadeColor(color, -16));
      target.fillStyle = gradient;
      target.beginPath();
      target.arc(0, 0, radius, 0, Math.PI * 2);
      target.fill();
      target.strokeStyle = 'rgba(255,255,255,.78)';
      target.lineWidth = Math.max(1.5, radius * 0.07);
      target.stroke();
      target.fillStyle = 'rgba(78,55,42,.66)';
      target.font = `700 ${Math.max(10, Math.min(20, radius * 0.62))}px sans-serif`;
      target.textAlign = 'center';
      target.textBaseline = 'middle';
      target.fillText(String(level + 1), 0, 1);
    }
    target.restore();
  }

  function shadeColor(hex, amount) {
    const value = Number.parseInt(hex.slice(1), 16);
    const red = Math.max(0, Math.min(255, (value >> 16) + amount));
    const green = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
    const blue = Math.max(0, Math.min(255, (value & 255) + amount));
    return `rgb(${red}, ${green}, ${blue})`;
  }

  function getAvailableDropLevelCount(scoreValue = score) {
    let count = CONFIG.dropLevelCount;
    for (const unlock of CONFIG.spawnUnlocks) {
      if (scoreValue >= unlock.minScore) count = unlock.levelCount;
    }
    // 获胜目标本身不进入掉落池，只能通过合成得到。
    return Math.max(1, Math.min(count, CONFIG.images.length, CONFIG.winLevel - 1));
  }

  function randomDropLevel(scoreValue = score) {
    return Math.floor(Math.random() * getAvailableDropLevelCount(scoreValue));
  }

  // 生成刚体，物理半径与渲染半径保持一致。
  function createFruit(level, x, y) {
    const radius = CONFIG.radii[level];
    const body = Bodies.circle(x, y, radius, {
      label: `fruit-${level + 1}`,
      restitution: 0.12,
      friction: 0.52,
      frictionStatic: 0.65,
      frictionAir: 0.008,
      density: 0.0012,
      slop: 0.02,
      sleepThreshold: 60
    });
    body.level = level;
    body.isMerged = false;
    body.createdAt = performance.now();
    Composite.add(engine.world, body);
    return body;
  }

  function updatePointer(clientX) {
    const bounds = canvas.getBoundingClientRect();
    const logicalX = (clientX - bounds.left) * (CONFIG.width / bounds.width);
    const radius = CONFIG.radii[currentLevel];
    pointerX = Math.max(CONFIG.leftWallX + CONFIG.wallThickness / 2 + radius,
      Math.min(CONFIG.rightWallX - CONFIG.wallThickness / 2 - radius, logicalX));
  }

  function dropFruit() {
    if (!gameStarted || gameOver) return;
    const now = performance.now();
    if (now - lastDropAt < CONFIG.dropCooldown) return;

    createFruit(currentLevel, pointerX, CONFIG.dropY);
    lastDropAt = now;
    currentLevel = randomDropLevel();
  }

  function handleCollision(event) {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.level === undefined || b.level === undefined || a.level !== b.level) continue;
      if (a.level >= CONFIG.radii.length - 1 || a.isMerged || b.isMerged) continue;
      a.isMerged = true;
      b.isMerged = true;
      mergeQueue.push({ a, b, level: a.level + 1 });
    }
  }

  // 在物理步进结束后统一执行合成，避免迭代 Matter.js 碰撞列表时修改世界。
  function processMerges(now) {
    while (mergeQueue.length) {
      const { a, b, level } = mergeQueue.shift();
      if (!Composite.get(engine.world, a.id, 'body') || !Composite.get(engine.world, b.id, 'body')) continue;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      Composite.remove(engine.world, a);
      Composite.remove(engine.world, b);
      dangerTimers.delete(a.id);
      dangerTimers.delete(b.id);
      createFruit(level, x, y);
      score += CONFIG.scores[level];
      scoreElement.textContent = String(score);
      // 本轮得分解锁新等级后，从当前可用等级中重新抽取待投放球。
      currentLevel = randomDropLevel();
      if (level + 1 >= CONFIG.winLevel) {
        endGame('win');
        break;
      }
    }
  }

  function checkDanger(now) {
    for (const body of Composite.allBodies(engine.world)) {
      if (body.level === undefined || body.isStatic) continue;
      if (now - body.createdAt < CONFIG.mergeLockMs) {
        dangerTimers.delete(body.id);
        continue;
      }

      const radius = CONFIG.radii[body.level];
      const isOverLine = body.position.y - radius < CONFIG.dangerLine;
      const isStable = Math.hypot(body.velocity.x, body.velocity.y) < CONFIG.dangerSpeedThreshold
        && Math.abs(body.angularVelocity) < 0.035;
      if (isOverLine && isStable) {
        if (!dangerTimers.has(body.id)) dangerTimers.set(body.id, now);
        if (now - dangerTimers.get(body.id) >= CONFIG.dangerHoldMs) {
          endGame('lose');
          return;
        }
      } else {
        dangerTimers.delete(body.id);
      }
    }
  }

  function endGame(result) {
    if (gameOver) return;
    gameOver = true;
    finalScoreElement.textContent = String(score);
    if (result === 'win') {
      resultEyebrowElement.textContent = 'YOU DID IT!';
      resultTitleElement.textContent = '成功合成大银新！';
    } else {
      resultEyebrowElement.textContent = 'ONE MORE ROUND?';
      resultTitleElement.textContent = '银新叠得太高了啊喂！';
    }
    gameOverElement.hidden = false;
  }

  function restartGame() {
    Composite.clear(engine.world, false);
    Engine.clear(engine);
    mergeQueue.length = 0;
    dangerTimers.clear();
    addWalls();
    score = 0;
    scoreElement.textContent = '0';
    finalScoreElement.textContent = '0';
    pointerX = CONFIG.width / 2;
    currentLevel = randomDropLevel();
    lastDropAt = -Infinity;
    gameOver = false;
    accumulator = 0;
    lastFrameAt = 0;
    gameOverElement.hidden = true;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / CONFIG.width, 0, 0, canvas.height / CONFIG.height, 0, 0);
  }

  function render() {
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    drawBoardBackground();
    drawDangerLine();

    for (const body of Composite.allBodies(engine.world)) {
      if (body.level === undefined) continue;
      drawFruit(ctx, body.level, body.position.x, body.position.y, CONFIG.radii[body.level], body.angle);
    }

    if (!gameOver) drawDropGuide();
  }

  function drawBoardBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    gradient.addColorStop(0, '#fffaf0');
    gradient.addColorStop(1, '#f8eddb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    // 轻淡的底部阴影让边界更容易辨认。
    ctx.fillStyle = 'rgba(181, 145, 105, .11)';
    ctx.fillRect(0, CONFIG.height - 18, CONFIG.width, 18);
  }

  function drawDangerLine() {
    ctx.save();
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = 'rgba(226, 105, 91, .78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, CONFIG.dangerLine);
    ctx.lineTo(CONFIG.width - 12, CONFIG.dangerLine);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d77f70';
    ctx.font = '600 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('DANGER', CONFIG.width - 14, CONFIG.dangerLine - 5);
    ctx.restore();
  }

  function drawDropGuide() {
    const radius = CONFIG.radii[currentLevel];
    ctx.save();
    ctx.globalAlpha = CONFIG.previewAlpha;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = '#c9a98b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pointerX, CONFIG.dropY + radius + 8);
    ctx.lineTo(pointerX, CONFIG.height - 22);
    ctx.stroke();
    ctx.setLineDash([]);
    drawFruit(ctx, currentLevel, pointerX, CONFIG.dropY, radius, 0, 0.82);
    ctx.fillStyle = '#b58e6b';
    ctx.beginPath();
    ctx.moveTo(pointerX, CONFIG.dropY + radius + 12);
    ctx.lineTo(pointerX - 5, CONFIG.dropY + radius + 5);
    ctx.lineTo(pointerX + 5, CONFIG.dropY + radius + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function frame(timestamp) {
    if (!lastFrameAt) lastFrameAt = timestamp;
    const elapsed = Math.min(timestamp - lastFrameAt, CONFIG.maxFrameDelta);
    lastFrameAt = timestamp;

    if (!gameOver) {
      accumulator += elapsed;
      while (accumulator >= CONFIG.fixedStep) {
        Engine.update(engine, CONFIG.fixedStep);
        accumulator -= CONFIG.fixedStep;
        processMerges(timestamp);
      }
      checkDanger(timestamp);
    }
    render();
    requestAnimationFrame(frame);
  }

  function onPointerMove(event) {
    if (!gameStarted) return;
    updatePointer(event.clientX);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', (event) => {
    if (!gameStarted) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    updatePointer(event.clientX);
    dropFruit();
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat && gameStarted && !gameOver) {
      event.preventDefault();
      dropFruit();
    }
  });
  restartButton.addEventListener('click', restartGame);
  startButton.addEventListener('click', () => {
    if (startButton.disabled) return;
    gameStarted = true;
    loadingScreen.hidden = true;
    canvas.focus();
  });
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  Events.on(engine, 'collisionStart', handleCollision);

  // 等所有图片请求完成后才允许开始；失败的图片会使用游戏内占位图。
  function updateLoadingProgress(settledCount) {
    const total = CONFIG.images.length;
    const percent = Math.round((settledCount / total) * 100);
    loadingProgress.setAttribute('aria-valuemax', String(total));
    loadingProgress.setAttribute('aria-valuemax', String(total));
    loadingProgress.setAttribute('aria-valuenow', String(settledCount));
    loadingProgressBar.style.width = `${percent}%`;
    loadingCount.textContent = `${settledCount} / ${total}`;
  }

  Promise.all(images.map((image) => new Promise((resolve) => {
    const finish = (loaded) => {
      if (loaded) loadedImageCount += 1;
      else failedImageCount += 1;
      resolve();
    };
    if (image.complete) {
      finish(image.naturalWidth > 0);
      return;
    }
    image.addEventListener('load', () => finish(true), { once: true });
    image.addEventListener('error', () => finish(false), { once: true });
  }).then(() => updateLoadingProgress(loadedImageCount + failedImageCount))))
    .then(() => {
      if (failedImageCount > 0) {
        loadingStatus.textContent = `已加载 ${loadedImageCount} 张图片，${failedImageCount} 张无法加载，将使用占位图。`;
      } else {
        loadingStatus.textContent = '图片已全部加载完成，可以开始游戏啦！';
      }
      startButton.disabled = false;
      startButton.textContent = '开始游戏';
    });

  // 初始化并启动固定步长动画循环。
  resizeCanvas();
  addWalls();
  currentLevel = randomDropLevel();
  requestAnimationFrame(frame);
})();
