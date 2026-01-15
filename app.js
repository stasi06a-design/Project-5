/**
 * BACKEND CONNECTED VERSION
 * - Fetches real robot data from FastAPI backend
 * - Live occupancy grid mapping (robot moves + scans)
 */

// ===== API Configuration =====
const API_URL = "http://127.0.0.1:8000";

// ===== DOM =====
const $ = (id) => document.getElementById(id);

const canvas = $("mapCanvas");
const ctx = canvas.getContext("2d");

const hudPose = $("hudPose");
const hudTemp = $("hudTemp");
const hudMap  = $("hudMap");

const tTime   = $("tTime");
const tUptime = $("tUptime");
const tBatt   = $("tBatt");
const tRssi   = $("tRssi");
const tMode   = $("tMode");

const hazList  = $("hazList");
const hazEmpty = $("hazEmpty");

// Buttons
$("centerBtn").addEventListener("click", () => {
  view.cx = robot.x;
  view.cy = robot.y;
});
$("resetBtn").addEventListener("click", () => {
  grid.fill(-1);
  trail.length = 0;
});
$("ackAllBtn").addEventListener("click", () => {
  hazards = hazards.map(h => ({ ...h, state: "ACKNOWLEDGED" }));
  renderHazards();
});

// Zoom
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const d = Math.sign(e.deltaY);
  view.zoom = clamp(view.zoom - d * 2, 14, 70);
}, { passive:false });

// ===== World =====
const WORLD = { w: 30, h: 18 };
const cellSize = 0.10;
const gridW = Math.floor(WORLD.w / cellSize);
const gridH = Math.floor(WORLD.h / cellSize);

const grid = new Int8Array(gridW * gridH).fill(-1);

const view = { cx: 15, cy: 9, zoom: 28 };

// Robot pose - now updated from API
const robot = { x: 12.5, y: 7.0, yaw: 0.2, v: 0.75, w: 0.35 };
const trail = [];
const trailMax = 260;

const scan = { rays: 120, maxRange: 6.0, step: 0.05 };

const truthObstacles = [
  { x: 0, y: 0, w: WORLD.w, h: 0.2 },
  { x: 0, y: WORLD.h - 0.2, w: WORLD.w, h: 0.2 },
  { x: 0, y: 0, w: 0.2, h: WORLD.h },
  { x: WORLD.w - 0.2, y: 0, w: 0.2, h: WORLD.h },
  { x: 6.0, y: 4.0, w: 5.0, h: 2.4 },
  { x: 16.0, y: 10.0, w: 8.0, h: 2.0 },
  { x: 11.2, y: 12.8, w: 1.8, h: 3.0 }
];

function hitsTruth(px, py){
  for (const r of truthObstacles) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return true;
  }
  return false;
}

// ===== Helpers =====
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function idx(ix, iy){ return iy * gridW + ix; }
function getCell(ix, iy){
  if (ix < 0 || iy < 0 || ix >= gridW || iy >= gridH) return 1;
  return grid[idx(ix, iy)];
}
function setCell(ix, iy, v){
  if (ix < 0 || iy < 0 || ix >= gridW || iy >= gridH) return;
  grid[idx(ix, iy)] = v;
}
function worldToCell(x, y){
  return { ix: Math.floor(x / cellSize), iy: Math.floor(y / cellSize) };
}
function w2s(x, y){
  return {
    x: (x - view.cx) * view.zoom + canvas.width / 2,
    y: (view.cy - y) * view.zoom + canvas.height / 2
  };
}

function fmtTime(ms){
  return new Date(ms).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

// ===== API Fetch Function =====
async function fetchRobotStatus() {
  try {
    const response = await fetch(`${API_URL}/status`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch robot status:", error);
    return null;
  }
}

// ===== Update from API =====
async function updateFromAPI() {
  const data = await fetchRobotStatus();
  
  if (data) {
    // Update robot position from API
    robot.x = data.position.x;
    robot.y = data.position.y;
    
    // Update rotation (convert degrees to radians if needed)
    robot.yaw = data.rotation * (Math.PI / 180); // if API sends degrees
    // robot.yaw = data.rotation; // if API sends radians
    
    // Update temperature display
    hudTemp.textContent = `${data.temperature.toFixed(1)} °C`;
    
    // Update battery
    tBatt.textContent = `${data.battery_percentage}%`;
    
    // Update timestamp
    tTime.textContent = fmtTime(Date.now());
    
    // Add to trail
    trail.push({ x: robot.x, y: robot.y });
    if (trail.length > trailMax) trail.shift();
  }
}

// ===== Telemetry (local demo values for fields not in API) =====
const bootMs = Date.now();
let telemetry = {
  uptimeSeconds: 0,
  wifiRssi: -55,
  mode: "PATROL"
};

function updateLocalTelemetry(){
  telemetry.uptimeSeconds = Math.floor((Date.now() - bootMs) / 1000);
  tUptime.textContent = `${Math.floor(telemetry.uptimeSeconds/60)}m`;
  tRssi.textContent = `${telemetry.wifiRssi} dBm`;
  tMode.textContent = telemetry.mode;
}

// ===== Hazards =====
let hazards = [
  {
    id: 1,
    corr: "THERM-001",
    title: "Thermal Hotspot Detected",
    severity: "HIGH",
    state: "DETECTED",
    detectedMs: Date.now() - 2 * 60 * 1000,
    pos: { x: 22.0, y: 6.8 }
  }
];

function sevBadge(sev){
  const s = String(sev).toUpperCase();
  const cls = s === "HIGH" ? "high" : s === "MEDIUM" ? "medium" : "low";
  return `<span class="badge ${cls}">${s}</span>`;
}
function esc(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
function ageLabel(ms){
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec/60)}m`;
}

function renderHazards(){
  hazEmpty.hidden = hazards.length !== 0;
  hazList.innerHTML = hazards.map(h => {
    const pos = h.pos ? `x:${h.pos.x.toFixed(1)} y:${h.pos.y.toFixed(1)}` : "pos:—";
    return `
      <div class="item">
        <div class="left">
          <div class="title">${esc(h.title)}</div>
          <div class="meta">${esc(h.corr)} • ${esc(h.state)} • ${pos} • age:${ageLabel(h.detectedMs)}</div>
        </div>
        ${sevBadge(h.severity)}
      </div>
    `;
  }).join("");
}

// ===== Mapping =====
function scanAndUpdateMap(){
  for (let i = 0; i < scan.rays; i++){
    const a = robot.yaw + (i / scan.rays) * Math.PI * 2;

    for (let d = 0; d <= scan.maxRange; d += scan.step){
      const px = robot.x + Math.cos(a) * d;
      const py = robot.y + Math.sin(a) * d;

      if (px < 0 || py < 0 || px > WORLD.w || py > WORLD.h){
        const cx = clamp(px, 0, WORLD.w - 0.001);
        const cy = clamp(py, 0, WORLD.h - 0.001);
        const c = worldToCell(cx, cy);
        setCell(c.ix, c.iy, 1);
        break;
      }

      const c = worldToCell(px, py);

      if (hitsTruth(px, py)){
        setCell(c.ix, c.iy, 1);
        break;
      } else {
        if (getCell(c.ix, c.iy) !== 1) setCell(c.ix, c.iy, 0);
      }
    }
  }
}

let mapImg = ctx.createImageData(gridW, gridH);
let off = document.createElement("canvas");
off.width = gridW; off.height = gridH;
let offCtx = off.getContext("2d", { willReadFrequently: true });

function renderMap(){
  const data = mapImg.data;
  let unk=0, free=0, wall=0;

  for (let i = 0; i < grid.length; i++){
    const v = grid[i];
    const p = i * 4;
    if (v === -1){
      unk++;
      data[p]=20; data[p+1]=20; data[p+2]=20; data[p+3]=255;
    } else if (v === 0){
      free++;
      data[p]=52; data[p+1]=52; data[p+2]=52; data[p+3]=255;
    } else {
      wall++;
      data[p]=210; data[p+1]=210; data[p+2]=210; data[p+3]=255;
    }
  }
  hudMap.textContent = `unknown:${unk} free:${free} wall:${wall}`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tl = w2s(0, WORLD.h);
  const br = w2s(WORLD.w, 0);

  offCtx.putImageData(mapImg, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.imageSmoothingEnabled = true;

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

  if (trail.length > 1){
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,176,0,0.30)";
    ctx.beginPath();
    const p0 = w2s(trail[0].x, trail[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i=1;i<trail.length;i++){
      const p = w2s(trail[i].x, trail[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  const rp = w2s(robot.x, robot.y);
  ctx.fillStyle = "rgba(255,176,0,0.95)";
  ctx.beginPath();
  ctx.arc(rp.x, rp.y, 10, 0, Math.PI*2);
  ctx.fill();

  const hx = rp.x + Math.cos(robot.yaw) * 18;
  const hy = rp.y - Math.sin(robot.yaw) * 18;
  ctx.strokeStyle = "rgba(255,176,0,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rp.x, rp.y);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.lineWidth = 1;

  const deg = (robot.yaw * 180) / Math.PI;
  hudPose.textContent = `x:${robot.x.toFixed(1)} y:${robot.y.toFixed(1)} θ:${deg.toFixed(0)}°`;
}

// ===== Main Loop =====
let lastT = performance.now();
renderHazards();

// Fetch from API every 500ms
setInterval(updateFromAPI, 500);

// Initial fetch
updateFromAPI();

(function loop(t){
  lastT = t;

  scanAndUpdateMap();
  renderMap();
  updateLocalTelemetry();

  requestAnimationFrame(loop);
})(lastT);