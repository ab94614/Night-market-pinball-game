const c = document.getElementById('c'), ctx = c.getContext('2d');
const W = 440, H = 800, CX = 220, CY = 385, RR = 170, R = 9, G = 0.2;
const HV = [2, 4, 6, 8, 10];          // 上方可抽到的數字
const SLOT_N = 12;                    // 下方洞數

let balls = 30, bet = 1;
let paid = 0, dragging = false;
const LIT_COUNT = { 2: 4, 4: 3, 6: 2, 8: 1, 10: 1 };
const TRICKY = [1, 2, 9, 10];
let state = 'idle';                   // idle / rolling / ready / flying / ending
let k = 0, dispVal = 0, chase = 0, rollT = 0, endT = 0;
let lit = new Set();
let flying = [], charge = 0, charging = false, cool = 0, t = 0;
let slotFlash = new Array(SLOT_N).fill(0), popups = [], bumpFlash = [0, 0];
let shake = 0, knockCD = 0;           // 敲機台:震動、冷卻

const msgEl = document.getElementById('msg');
const betShow = document.getElementById('betShow');
function say(s) { msgEl.textContent = s; }
function showBet() { betShow.textContent = bet; }
say('先設定倍數,再按「抽獎」');

const bumpers = [{ x: 92, y: 350, r: 13 }, { x: 318, y: 350, r: 13 }];

// 綠色膠囊柱
const posts = [];
for (let i = 0; i < 9; i++) posts.push({ x: 90 + i * 28, y: 298 + (i % 3 - 1) * 5 });

// 金色小釘
const pins = [];

// 弧形導軌:沿圓弧等距排列的小釘(右側出口 → 弧頂)
const RAIL_R = 150, RAIL_STEP = 9;
for (let a = -56; a >= -92; a -= RAIL_STEP) {
  const rad = a * Math.PI / 180;
  pins.push({ x: CX + RAIL_R * Math.cos(rad), y: CY + RAIL_R * Math.sin(rad), rail: true });   // rail:撞到不算「進入盤面」
}
const ARC_N = pins.length;            // 滑軌釘數量

// ===== 盤面釘子：等距交錯排列(第一排對齊綠色膠囊柱) =====
const ROW_GAP = 26, COL_GAP = 28;
const BUMP_CLEAR = 32;                // 釘子離彈跳器中心的最小距離
const X_MIN = 62, X_MAX = 330;
for (let r = 0; r < 5; r++) {
  const y = 322 + r * ROW_GAP;
  const off = r % 2 ? COL_GAP / 2 : 0;
  for (let x = 90 - COL_GAP * 3 + off; x <= X_MAX; x += COL_GAP) {
    if (x < X_MIN) continue;
    if (y < CY && Math.hypot(x - CX, y - CY) > 150) continue;          // 不超出圓弧
    if (bumpers.some(b => Math.hypot(x - b.x, y - b.y) < BUMP_CLEAR)) continue;  // 避開彈跳器
    pins.push({ x, y });
  }
}
for (const x of [341]) pins.push({ x, y: 306, rail: true });

// 洞口上方一排小釘
for (let i = 1; i < SLOT_N; i++) pins.push({ x: 70 + 23 * i, y: 452 });

// 固定種子隨機(裝飾用)
let seed = 7;
function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
const pile = [];
for (let i = 0; i < 90; i++) pile.push({ x: 140 + rnd() * 170, y: 735 + rnd() * 40 });
const conf = [];
for (let i = 0; i < 40; i++) conf.push({ x: 60 + rnd() * 320, y: 235 + rnd() * 320, col: ['#ff7043', '#66bb6a', '#42a5f5', '#ab47bc'][i % 4], a: rnd() * 3 });

// 音效
let ac;
function beep(f, d, type) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.value = f; g.gain.value = 0.05;
    o.connect(g); g.connect(ac.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.stop(ac.currentTime + d);
  } catch (e) {}
}

let sparks = [], lastTick = 0;
function pinHit(b, p) {
  const spd = Math.hypot(b.vx, b.vy);
  if (spd < 1) return;
  sparks.push({ x: p.x, y: p.y, t: 0 });
  const now = performance.now();
  if (now - lastTick < 35) return;
  lastTick = now;
  beep(1400 + Math.random() * 800, .03, 'square');
}

// ---------- 倍數 ----------
function setBet(v) {
  if (state !== 'idle' && state !== 'ready') { say('彈珠飛行中,不能改倍數'); return; }
  bet = Math.max(1, Math.min(99, balls, v));
  showBet();
}
document.getElementById('bMinus10').onclick = () => setBet(bet - 10);
document.getElementById('bMinus').onclick = () => setBet(bet - 1);
document.getElementById('bPlus').onclick = () => setBet(bet + 1);
document.getElementById('bPlus10').onclick = () => setBet(bet + 10);
document.getElementById('bMax').onclick = () => setBet(Math.min(99, balls));

// ---------- 音效 ----------
function winSound() {
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
    setTimeout(() => { beep(f, .22, 'triangle'); beep(f * 2, .1, 'sine'); }, i * 110));
}
function loseSound() {
  [392, 330, 262, 196].forEach((f, i) =>
    setTimeout(() => beep(f, .25, 'sawtooth'), i * 150));
}

// ---------- 投幣 / 投彈珠 ----------
let coinAnims = [], ballAnims = [];

function insertCoin() {
  balls += 10;
  coinAnims.push({ t: 0 });
  popups.push({ x: 80, y: 40, text: '+10', t: 0, col: '#fbc02d' });
  say('叮!投入硬幣,+10 粒彈珠');
  beep(1568, .08, 'triangle');
  setTimeout(() => beep(300, .06, 'square'), 200);
  setTimeout(() => beep(2093, .25, 'triangle'), 260);
}

function insertBall() {
  if (state !== 'idle' && state !== 'ready') { say('彈珠飛行中,不能改倍數'); return; }
  if (bet >= balls) { say('彈珠不夠,請先投幣'); beep(150, .08, 'square'); return; }
  bet++; showBet();
  ballAnims.push({ t: 0 });
  popups.push({ x: 350, y: 40, text: '倍數 +1', t: 0, col: '#fff3cf' });
  say('投入 1 粒,倍數 ×' + bet);
  beep(220, .08, 'triangle');
  setTimeout(() => beep(150, .08, 'triangle'), 150);
}
document.getElementById('coin').onclick = insertCoin;

// ---------- 抽獎 ----------
function startDraw() {
  if (state !== 'idle') { say(state === 'ready' ? '已抽完,請拉拉桿發射' : '請稍候…'); return; }
  if (balls < 1) { say('沒有彈珠了,請投幣'); return; }
  lit.clear(); k = 0; rollT = 0;
  state = 'rolling';
  say('抽獎中…(發射前都可以調整投入顆數)');
}
document.getElementById('draw').onclick = startDraw;

function finishDraw() {
  const idx = Math.floor(Math.random() * HV.length);
  k = HV[idx]; chase = idx; dispVal = k;
  if (k === 10) {
    lit = new Set([TRICKY[Math.floor(Math.random() * TRICKY.length)]]);
  } else {
    const all = [...Array(SLOT_N).keys()];
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    lit = new Set(all.slice(0, LIT_COUNT[k]));
  }
  state = 'ready';
  say('抽到 ' + k + ' 粒!亮 ' + lit.size + ' 顆燈,可調整顆數後拉拉桿發射');
  beep(1000, .2); setTimeout(() => beep(1400, .25), 150);
  setTimeout(() => beep(220, .08, 'triangle'), 450);
  setTimeout(() => beep(150, .08, 'triangle'), 600);
}

// ---------- 待發射彈珠 ----------
let q = null, gateAmt = 0, dropX = null;
const trayY = x => 540 + (x - 60) * 0.0276;

function updateQueue() {
  if (!q && !flying.length && balls > 0) {
    if (dropX !== null && (state === 'ending' || state === 'idle')) {
      q = { x: dropX, y: 500, vx: 0, vy: 2, phase: 'drop' }; dropX = null;
    } else if (state === 'idle' || state === 'rolling' || state === 'ready') {
      q = { x: 70 + 23 * Math.floor(Math.random() * SLOT_N) + 11.5, y: 500, vx: 0, vy: 2, phase: 'drop' };
    }
  }

  if (q) {
    const ty = trayY(q.x) - R + 1;
    if (q.phase === 'drop') {
      q.vy += .35; q.y += q.vy;
      if (q.y >= ty) {
        q.y = ty;
        if (q.vy > 1.5) { beep(180, .06, 'triangle'); q.vy = -q.vy * .35; }
        else { q.vy = 0; q.phase = 'roll'; }
      }
    } else if (q.phase === 'roll') {
      q.vx = Math.min(q.vx + .08, 2.5); q.x += q.vx; q.y = trayY(q.x) - R + 1;
      if (q.x >= 336) { q.x = 336; q.vx = 0; q.phase = 'wait'; beep(400, .04, 'triangle'); }
    } else if (q.phase === 'wait') {
      if (state === 'ready' && gateAmt > .9) q.phase = 'enter';
    } else if (q.phase === 'enter') {
      q.x += 2.6;
      if (q.x < 358) q.y = trayY(q.x) - R + 1;
      else q.y += (548 - q.y) * .3;
      if (q.x >= 374) { q.x = 374; q.y = 548; q.phase = 'lane'; beep(220, .08, 'triangle'); }
    }
  }
  const want = q && (q.phase === 'enter' || (q.phase === 'wait' && state === 'ready')) ? 1 : 0;
  gateAmt += (want - gateAmt) * .15;
}

// ---------- 發射 ----------
const fire = document.getElementById('fire');
function startCharge() { charging = true; }
function launch() {
  if (state === 'idle') { say('請先按「抽獎」'); return; }
  if (state === 'rolling') { say('抽獎中,請稍候'); return; }
  if (state !== 'ready' || cool > 0 || flying.length) return;
  if (!q || q.phase !== 'lane') { say('彈珠還在滾動,請稍等'); return; }
  if (balls < 1) { say('沒有彈珠了,請投幣'); return; }
  if (bet > balls) { bet = balls; showBet(); }
  balls -= bet; paid = bet;
  cool = 25; state = 'flying';
// 力道曲線:拉一點點 ≈ 剛好能出軌道,拉到底 = 很大力
const power = 10.5 + Math.pow(charge, 1.5) * 4;   // 範圍 10.5 ~ 14.5
flying.push({ x: 374, y: 548, vx: 0, vy: -power, still: 0, far: 374 });
  q = null;
  beep(300 + charge * 300, .12, 'triangle'); say('發射!投入 ' + bet + ' 粒');
}
function release() {
  if (!charging) return;
  charging = false; dragging = false;
  launch();
  charge = 0;
}
fire.addEventListener('pointerdown', e => { e.preventDefault(); startCharge(); });
window.addEventListener('pointerup', release);
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startCharge(); } });
window.addEventListener('keyup', e => { if (e.code === 'Space') release(); });

//敲機台力道
function knock() {
  if (knockCD > 0) return;
  knockCD = 30; shake = 20;                                  // 畫面震動加強
  beep(120, .15, 'sawtooth'); setTimeout(() => beep(90, .12, 'square'), 90);
  if (!flying.length) { say('咚!敲了一下機台(目前沒有飛行中的彈珠)'); return; }
  for (const b of flying) {
    b.vx += (Math.random() - .5) * 12;                       // 左右力道:5 → 12
    b.vy = Math.min(b.vy, 0) - (5 + Math.random() * 3);      // 向上力道:2~3.5 → 5~8,並且先清掉往下的速度
    b.y -= 4;                                                // 先往上挪一點,直接脫離釘子的夾縫
    b.still = 0;
  }
  say('咚!用力敲機台,彈珠被震開了');
}
window.addEventListener('keydown', e => { if (e.code === 'KeyK') knock(); });

// ---------- 拉桿 ----------
const LEVER_X = 374, LEVER_Y0 = 585, LEVER_LEN = 60;
function canvasPos(e) {
  const r = c.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
c.addEventListener('pointerdown', e => {
  const p = canvasPos(e);
  if (Math.abs(p.x - LEVER_X) < 24 && p.y > 560 && p.y < LEVER_Y0 + LEVER_LEN + 25) {
    e.preventDefault();
    dragging = true; charging = true;
    charge = Math.max(0, Math.min(1, (p.y - LEVER_Y0) / LEVER_LEN));
  }
});
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  const p = canvasPos(e);
  charge = Math.max(0, Math.min(1, (p.y - LEVER_Y0) / LEVER_LEN));
});

// 畫面上的按鈕
c.addEventListener('click', e => {
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
  if (Math.hypot(x - 135, y - 622) < 24) startDraw();
  if (x > 50 && x < 110 && y > 40 && y < 140) insertCoin();
  if (x > 310 && x < 390 && y > 35 && y < 145) insertBall();
  if (x > 45 && x < 125 && y > 655 && y < 687) knock();               // 敲機台按鈕
});

// 重新開始
document.getElementById('reset').onclick = () => {
balls = 30; bet = 1; showBet(); flying = []; lit.clear(); k = 0; state = 'idle'; charge = 0;
paid = 0; charging = false; dragging = false;
  q = null; gateAmt = 0; dropX = null;
  say('已重新開始,送你 30 粒');
};

// ---------- 物理 ----------
function hitPoint(b, px, py, pr, rest) {
  const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), m = R + pr;
  if (d < m && d > 0) {
    const nx = dx / d, ny = dy / d;
    b.x = px + nx * m; b.y = py + ny * m;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {
      b.vx -= (1 + rest) * dot * nx; b.vy -= (1 + rest) * dot * ny;
      b.vx += (Math.random() - .5) * .3;
      return true;
    }
  }
  return false;
}
function hitSeg(b, x, y1, y2, pr, rest) { return hitPoint(b, x, Math.max(y1, Math.min(y2, b.y)), pr, rest); }

function stepBall(b) {
  b.vy += G / 4; b.x += b.vx / 4; b.y += b.vy / 4;
  if (b.y < CY) {
    const dx = b.x - CX, dy = b.y - CY, d = Math.hypot(dx, dy);
    if (d > RR + 5 - R) {
      const nx = dx / d, ny = dy / d;
      b.x = CX + nx * (RR + 5 - R); b.y = CY + ny * (RR + 5 - R);
      const dot = b.vx * nx + b.vy * ny;
      if (dot > 0) { b.vx -= 1.5 * dot * nx; b.vy -= 1.5 * dot * ny; }
      const tx = -ny, ty = nx;
      const tan = b.vx * tx + b.vy * ty;
      b.vx -= tan * .02 * tx; b.vy -= tan * .02 * ty;
      b.vx *= .97; b.vy *= .97;

    }
  } else {
if (b.x < 52) { b.x = 52; b.vx = Math.abs(b.vx) * .4 + .4; }
    if (b.x > 388) { b.x = 388; b.vx = -Math.abs(b.vx) * .4; }
  }
  hitSeg(b, 358, 322, 556, 2.5, .4);

  // 左牆邊微微往右推(y 340 起就生效)
if (b.x < 90 && b.y > 300 && b.y < 470) b.vx += 0.03;

  // 下方左右斜牆(和畫面一致:左 50→70,右 358→346)
  if (b.x < 358 && b.y > 430) {
    const f = Math.max(0, Math.min(1, (b.y - 430) / 40));
    const lo = 50 + R + f * 20;
    const hi = 358 - R - f * 12;
    if (b.x < lo) { b.x = lo; b.vx = Math.abs(b.vx) * .6 + 1.4; }
    if (b.x > hi) { b.x = hi; b.vx = -Math.abs(b.vx) * .4 - .05; }
  }


  if (b.x < 358) {
    for (const p of pins) if (hitPoint(b, p.x, p.y, 2.5, .6)) { pinHit(b, p); if (!p.rail && p.x < 300) b.played = true; }
    for (const p of posts) if (hitSeg(b, p.x, p.y - 4, p.y + 4, 4, .5) && p.x < 300) b.played = true;
    bumpers.forEach((bp, i) => { if (hitPoint(b, bp.x, bp.y, bp.r, 1.1)) { if (bp.x < 300) b.played = true; bumpFlash[i] = 10; beep(700 + i * 200, .05); } });
    if (b.y > 440) for (let i = 0; i <= SLOT_N; i++) hitSeg(b, 70 + 23 * i, 470, 535, 2.5, .35);
  }
}

function endRound(text) {
  state = 'ending'; endT = 100; say(text);
}

function update() {
  t++; if (cool > 0) cool--;
  if (shake > 0) shake--; if (knockCD > 0) knockCD--;
  updateQueue();
  if (charging && !dragging) charge = Math.min(1, charge + .02);

  if (state === 'rolling') {
    rollT++;
    const speed = rollT < 40 ? 3 : rollT < 60 ? 6 : 10;
    if (rollT % speed === 0) { chase = (chase + 1) % HV.length; dispVal = HV[chase]; beep(500 + chase * 80, .05); }
    if (rollT >= 75) finishDraw();
  }
  if (state === 'ending') {
    endT--;
    if (endT <= 0) { lit.clear(); k = 0; state = 'idle'; if (bet > balls) { bet = Math.max(1, balls); showBet(); } }
  }

  for (const b of flying) {
    for (let s = 0; s < 4; s++) stepBall(b);
    if (Math.hypot(b.vx, b.vy) < .4) b.still++; else b.still = 0;
    if (b.still > 25) { b.vx = (Math.random() - .5) * 3; b.vy = -1.5; b.still = 0; }
    if (b.x < b.far) b.far = b.x;                    // 記錄球最左飛到哪裡
    // 力道不夠:沒繞過弧頂、也沒撞到盤面上任何釘子/柱子/彈跳器(撞過就算已經在玩了)
    const weak = !b.played && b.far > 310;

    // 退回:掉回發射軌道,或是掉在軌道牆旁邊(盤面這一側)但根本沒繞上去
if (b.x > 358 && b.vy > 0 && b.y >= 552) {
     b.dead = true; state = 'ready'; balls += paid; paid = 0; say('力道不夠,彈珠退回,再拉一次'); q = { x: 374, y: 548, vx: 0, vy: 0, phase: 'lane' };

    } else if (b.x > 70 && b.x < 346 && b.y > 512) {
      const i = Math.min(SLOT_N - 1, Math.floor((b.x - 70) / 23));
      b.dead = true; slotFlash[i] = 40; dropX = 70 + 23 * i + 11.5;
      if (lit.has(i)) {
        const win = k * bet;
        balls += win;
        popups.push({ x: b.x, y: 500, text: '+' + win, t: 0, col: '#e53935' });
        winSound();
        endRound('中獎!' + k + ' 粒 × ' + bet + ' 倍 = 吐出 ' + win + ' 粒');
      } else {
        popups.push({ x: b.x, y: 500, text: '槓', t: 0, col: '#555' });
        loseSound();
        endRound('沒中,損失 ' + bet + ' 粒');
      }
    } else if (b.y > 552 && b.x <= 358) {
      b.dead = true; beep(150, .15, 'sawtooth'); endRound('掉到邊溝了…');
    }
  }
  flying = flying.filter(b => !b.dead);
  slotFlash = slotFlash.map(v => Math.max(0, v - 1));
  bumpFlash = bumpFlash.map(v => Math.max(0, v - 1));
  popups.forEach(p => { p.t++; p.y -= .8; });
  popups = popups.filter(p => p.t < 60);
  coinAnims.forEach(a => a.t++); coinAnims = coinAnims.filter(a => a.t < 26);
  ballAnims.forEach(a => a.t++); ballAnims = ballAnims.filter(a => a.t < 18);
  sparks.forEach(s => s.t++); sparks = sparks.filter(s => s.t < 8);
}

// ---------- 繪圖工具 ----------
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(x, y, w, h, d) {
  const s = SEG[d], kk = 3;
  const sg = { a: [x, y, w, kk], b: [x + w - kk, y, kk, h / 2], c: [x + w - kk, y + h / 2, kk, h / 2], d: [x, y + h - kk, w, kk], e: [x, y + h / 2, kk, h / 2], f: [x, y, kk, h / 2], g: [x, y + h / 2 - kk / 2, w, kk] };
  for (const key of 'abcdefg') { ctx.fillStyle = s.includes(key) ? '#ff2a2a' : '#3a0a0a'; ctx.fillRect(...sg[key]); }
}
function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function ball(x, y, r) {
  const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
  g.addColorStop(0, '#fff'); g.addColorStop(.6, '#b0b8c0'); g.addColorStop(1, '#667');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
function star(x, y, r, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .55 : r; ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - 6, y - 2, 4, 0, 7); ctx.arc(x + 6, y - 2, 4, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x - 6, y - 2, 1.8, 0, 7); ctx.arc(x + 6, y - 2, 1.8, 0, 7); ctx.fill();
  ctx.strokeStyle = '#c2185b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y + 4, 5, .1, Math.PI - .1); ctx.stroke();
}
function squareFace(x, y, s) {
  ctx.fillStyle = '#fff176'; ctx.strokeStyle = '#c9a800'; ctx.lineWidth = 2;
  ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
  for (const dx of [-9, 9]) { ctx.beginPath(); ctx.arc(x + dx, y - 6, 8, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#29b6f6';
  for (const dx of [-9, 9]) { ctx.beginPath(); ctx.arc(x + dx, y - 6, 4, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#222';
  for (const dx of [-9, 9]) { ctx.beginPath(); ctx.arc(x + dx, y - 6, 1.8, 0, 7); ctx.fill(); }
  ctx.strokeStyle = '#8d3b00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y + 4, 11, .15, Math.PI - .15); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 3, y + 12, 3, 5); ctx.fillRect(x + 1, y + 12, 3, 5);
}

// ---------- 畫面 ----------
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake * .6, (Math.random() - .5) * shake * .6);
  ctx.clearRect(-20, -20, W + 40, H + 40);
  ctx.fillStyle = '#d9b98a'; ctx.fillRect(-20, -20, W + 40, H + 40);

  // 木紋色外框
  const rg = ctx.createLinearGradient(0, 0, W, 0);
  ['#8d6e3f', '#b08d57', '#8d6e3f'].forEach((cl, i) => rg.addColorStop(i / 2, cl));
  ctx.fillStyle = rg; ctx.fillRect(15, 10, 410, 700);
  ctx.strokeStyle = '#5d4524'; ctx.lineWidth = 3; ctx.strokeRect(16.5, 11.5, 407, 697);
  // 大底
  ctx.fillStyle = '#e8d2a6'; ctx.fillRect(35, 20, 370, 680);

  // 上方面板
  ctx.fillStyle = '#f3e3c3'; ctx.fillRect(35, 20, 370, 180);
  ctx.fillStyle = '#b0b8c0'; rr(50, 40, 60, 100, 4); ctx.fill();
  ctx.fillStyle = '#222'; ctx.fillRect(70, 52, 20, 4);

  // 黃色說明板
  ctx.fillStyle = '#e6c84c'; rr(120, 35, 170, 140, 4); ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#d32f2f'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('夜市彈珠台', 205, 58);
  ctx.fillStyle = '#c62828'; ctx.font = '10px sans-serif';
  ctx.fillText('請投10元 換10粒彈珠', 205, 74);

  // 數字顯示
  const showNum = (state === 'rolling') ? dispVal : k;
  ctx.fillStyle = '#000'; ctx.fillRect(190, 82, 32, 28);
  digit(194, 86, 11, 20, Math.floor(showNum / 10) % 10);
  digit(208, 86, 11, 20, showNum % 10);

  // 獎項燈
  const hx = [145, 175, 205, 235, 265];
  hx.forEach((x, i) => {
    let on = false;
    if (state === 'rolling') on = (i === chase);
    else if (k > 0) on = (HV[i] === k && t % 14 < 9);
    ctx.fillStyle = on ? '#ff5252' : '#7b1230';
    ctx.beginPath(); ctx.arc(x, 135, 9, 0, 7); ctx.fill();
    if (on) { ctx.shadowColor = '#ff5252'; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
    ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#7b1230'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(HV[i] + '粒', x, 162);
  });

  // 剩餘 / 倍數
  ctx.fillStyle = '#333'; ctx.font = 'bold 14px sans-serif';
  const remain = balls;
  ctx.fillText('剩 ' + remain + ' 粒　倍數 ×' + bet, 205, 190);

  // 出珠口
  ctx.fillStyle = '#a8803a'; rr(310, 35, 80, 110, 14); ctx.fill();
  ctx.strokeStyle = '#6d4c1a'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#2e1f06'; ctx.beginPath(); ctx.arc(350, 105, 14, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff3cf'; ctx.font = 'bold 10px sans-serif';
  ctx.fillText('點一下 倍數+1', 350, 58);
  ctx.fillText('(押 1 粒)', 350, 72);

  // 硬幣掉進投幣孔
  coinAnims.forEach(a => {
    ctx.save();
    ctx.beginPath(); ctx.rect(40, 0, 80, 55); ctx.clip();
    const cy = 18 + a.t * 1.8, sx = Math.abs(Math.cos(a.t * .5)) * 8 + 2;
    ctx.fillStyle = '#fdd835'; ctx.strokeStyle = '#c79100'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(80, cy, sx, 9, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (a.t > 20) { ctx.fillStyle = '#fff59d'; ctx.fillRect(70, 52, 20, 4); }
  });

  // 彈珠掉進出珠口
  ballAnims.forEach(a => {
    const p = a.t / 18, by = 72 + p * 33, rad = 7 * (1 - p * .7);
    ball(350, by, Math.max(2, rad));
    if (a.t > 14) {
      ctx.strokeStyle = '#fff59d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(350, 105, 16, 0, 7); ctx.stroke();
    }
  });

  // 遊戲區底色(左右對稱:x = 50 / 390)
  ctx.save();
  ctx.beginPath(); ctx.moveTo(50, 556); ctx.lineTo(50, CY); ctx.arc(CX, CY, RR, Math.PI, 0); ctx.lineTo(390, 556); ctx.closePath();
  ctx.fillStyle = '#fff176'; ctx.fill(); ctx.clip();
  conf.forEach(p => { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col; ctx.fillRect(-3, -2, 6, 4); ctx.restore(); });
  ctx.fillStyle = '#4caf50'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('夜市彈珠台', CX - 20, 275);
  star(120, 400, 45, '#f48fb1');
  squareFace(260, 390, 70);
  ctx.restore();

  // 發射軌道
  ctx.fillStyle = '#fff8e1'; ctx.fillRect(356, 322, 4, 244);
  ctx.fillStyle = '#aaa'; ctx.fillRect(356, 322, 1, 244);

  // 弧形外壁(直線段接在圓弧端點:x = 46 / 394)
  ctx.strokeStyle = '#c8a96a'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(46, 556); ctx.lineTo(46, CY); ctx.arc(CX, CY, RR + 4, Math.PI, 0); ctx.lineTo(394, 556); ctx.stroke();

  // 綠色膠囊柱
  for (const p of posts) {
    ctx.fillStyle = '#43a047'; rr(p.x - 3, p.y - 8, 6, 16, 3); ctx.fill();
    ctx.fillStyle = '#a5d6a7'; ctx.fillRect(p.x - 1.5, p.y - 5, 1.5, 8);
  }
  // 金色小釘
  for (const p of pins) {
    ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe082'; ctx.beginPath(); ctx.arc(p.x - .7, p.y - .7, 1, 0, 7); ctx.fill();
  }
  for (const s of sparks) {
    ctx.strokeStyle = 'rgba(255,245,157,' + (1 - s.t / 8) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 4 + s.t * 1.3, 0, 7); ctx.stroke();
  }

  // 彈跳器
  bumpers.forEach((b, i) => {
    ctx.fillStyle = bumpFlash[i] > 0 ? '#fff59d' : (i ? '#f4511e' : '#ec407a');
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  });

  // 兩側封牆(左側從外壁 x=46 一路貼齊)
  ctx.fillStyle = '#c8a96a';
  ctx.beginPath(); ctx.moveTo(46, 400); ctx.lineTo(50, 400); ctx.lineTo(50, 430); ctx.lineTo(70, 470); ctx.lineTo(70, 540); ctx.lineTo(50, 556); ctx.lineTo(46, 556); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(358, 430); ctx.lineTo(346, 470); ctx.lineTo(346, 536); ctx.lineTo(358, 536); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#8d6e3f'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(50, 430); ctx.lineTo(70, 470); ctx.lineTo(70, 540); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(358, 430); ctx.lineTo(346, 470); ctx.lineTo(346, 536); ctx.stroke();

  // 12 個洞 + 燈號
  for (let i = 0; i < SLOT_N; i++) {
    const x = 70 + i * 23;
    const isLit = lit.has(i);
    ctx.fillStyle = slotFlash[i] > 0 ? '#ff8a65' : (isLit ? '#7a1f1f' : '#2b2b2b');
    ctx.fillRect(x + 3, 485, 17, 50);

    let lampOn = false;
    if (state === 'rolling') lampOn = (Math.floor(t / 4) + i) % 5 === 0;
    else if (isLit) lampOn = (state === 'ending') ? (t % 8 < 5) : true;
    ctx.fillStyle = lampOn ? '#ff3b3b' : '#4a1010';
    ctx.beginPath(); ctx.arc(x + 11, 478, 5, 0, 7); ctx.fill();
    if (lampOn) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0; }
  }
  for (let i = 0; i <= SLOT_N; i++) { ctx.fillStyle = '#d4a017'; ctx.fillRect(70 + 23 * i - 1.5, 470, 3, 65); }

  // 底部斜板
  ctx.fillStyle = '#cfd8dc'; ctx.beginPath(); ctx.moveTo(60, 540); ctx.lineTo(60, 552); ctx.lineTo(358, 556); ctx.lineTo(358, 548); ctx.closePath(); ctx.fill();

  // 柵欄
  ctx.save();
  ctx.beginPath(); ctx.rect(344, 536, 16, 20); ctx.clip();
  const gy = -gateAmt * 20;
  ctx.strokeStyle = '#8d6e3f'; ctx.lineWidth = 2;
  for (const gx of [348, 352, 356]) { ctx.beginPath(); ctx.moveTo(gx, 537 + gy); ctx.lineTo(gx, 557 + gy); ctx.stroke(); }
  ctx.fillStyle = '#8d6e3f'; ctx.fillRect(346, 540 + gy, 12, 2); ctx.fillRect(346, 551 + gy, 12, 2);
  ctx.restore();

  // 待發射的彈珠
  if (q) {
    const by = q.phase === 'lane' ? Math.min(548 + charge * 6, 553) : q.y;
    ball(q.x, by, R);
  }

  // 飛行中的彈珠
  for (const b of flying) ball(b.x, b.y, R);

  // 飄字
  popups.forEach(p => { ctx.globalAlpha = 1 - p.t / 60; ctx.fillStyle = p.col; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.text, p.x, p.y); ctx.globalAlpha = 1; });

  // 下方面板
  ctx.fillStyle = '#f3e3c3'; ctx.fillRect(35, 566, 370, 130);
  ctx.fillStyle = '#d32f2f'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('按這裡抽倍數', 135, 590);
  const canDraw = state === 'idle';
  ctx.fillStyle = '#e65100'; ctx.beginPath(); ctx.arc(135, 624, 22, 0, 7); ctx.fill();
  ctx.fillStyle = canDraw ? '#ffa726' : '#bdbdbd'; ctx.beginPath(); ctx.arc(135, 622, 18, 0, 7); ctx.fill();

  // 敲機台按鈕
  ctx.fillStyle = knockCD > 0 ? '#bdbdbd' : '#8d6e3f'; rr(45, 655, 80, 32, 8); ctx.fill();
  ctx.strokeStyle = '#5d4524'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('敲機台', 85, 676);

  // 蓄力條
  ctx.fillStyle = '#ddd'; ctx.fillRect(215, 610, 120, 14);
  ctx.fillStyle = charge > .8 ? '#e53935' : '#43a047'; ctx.fillRect(215, 610, 120 * charge, 14);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(215, 610, 120, 14);
  ctx.fillStyle = '#555'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('發射力道', 275, 645);
  ctx.fillText(state === 'ready' ? '往下拉右邊拉桿' : (state === 'idle' ? '請先抽獎' : ''), 275, 665);

  // 拉桿
  const ky = LEVER_Y0 + charge * LEVER_LEN;
  ctx.fillStyle = '#555'; rr(LEVER_X - 4, 556, 8, LEVER_Y0 + LEVER_LEN - 556 + 14, 4); ctx.fill();
  ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(LEVER_X, 556);
  for (let i = 1; i <= 6; i++) ctx.lineTo(LEVER_X + (i % 2 ? 7 : -7), 556 + (ky - 556) * i / 6);
  ctx.stroke();
  ctx.fillStyle = dragging ? '#ffca28' : '#fbc02d';
  ctx.beginPath(); ctx.arc(LEVER_X, ky, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = '#c79100'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#fff59d'; ctx.beginPath(); ctx.arc(LEVER_X - 4, ky - 4, 4, 0, 7); ctx.fill();
  ctx.fillStyle = '#555'; ctx.font = '11px sans-serif'; ctx.fillText('拉桿', LEVER_X, 678);

  // 彈珠盤
  ctx.fillStyle = '#b0bec5'; rr(120, 705, 200, 85, 20); ctx.fill();
  ctx.fillStyle = '#78909c'; rr(130, 715, 180, 70, 16); ctx.fill();
  pile.slice(0, Math.min(90, balls * 3)).forEach(p => ball(p.x, p.y + 5, 6));

  ctx.restore();   // 對應 draw() 開頭的 ctx.save()
}

function loop() { update(); draw(); requestAnimationFrame(loop); }
showBet();
loop();