import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./App.css";

type Brush = "pencil" | "marker" | "highlighter" | "airbrush";
type Tool = "pen" | "eraser" | "select" | "shape";

type Point = { x: number; y: number };

type StrokeStyle = {
  tool: "pen" | "eraser";
  brush: Brush;
  color: string;
  size: number; // px
};

type ShapeType = "rect" | "ellipse" | "triangle" | "star" | "line" | "pentagon" | "tree" | "umbrella" | "heart";

type StrokeElement = {
  id: string;
  kind: "stroke";
  points: Point[];
  style: StrokeStyle;
  // For airbrush we store dots for deterministic redraw
  dots?: { x: number; y: number; r: number; a: number }[];
};

type ShapeElement = {
  id: string;
  kind: "shape";
  shape: ShapeType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
};

type Element = StrokeElement | ShapeElement;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getCanvasPoint(e: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return { left, top, right, bottom, w: right - left, h: bottom - top };
}

// --- Hit testing for shapes (MVP: shapes only) ---
function hitTestShape(shape: ShapeElement, p: Point): boolean {
  const pad = Math.max(6, shape.size);

  // Line needs distance-to-segment hit testing.
  if (shape.shape === "line") {
    const x1 = shape.x1;
    const y1 = shape.y1;
    const x2 = shape.x2;
    const y2 = shape.y2;
    const px = p.x;
    const py = p.y;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;

    // treat tiny lines as circles
    if (len2 < 1e-6) {
      const ddx = px - x1;
      const ddy = py - y1;
      return ddx * ddx + ddy * ddy <= (pad + 2) * (pad + 2);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const ddx = px - cx;
    const ddy = py - cy;
    return ddx * ddx + ddy * ddy <= (pad + 2) * (pad + 2);
  }

  const r = normalizeRect(shape.x1, shape.y1, shape.x2, shape.y2);
  // expand by a few px so it's easier to click
  const x = p.x;
  const y = p.y;

  // For most shapes we use a forgiving bounding-box hit test (great UX).
  if (shape.shape !== "ellipse") {
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  // ellipse precise hit test
  const cx = r.left + r.w / 2;
  const cy = r.top + r.h / 2;
  const rx = Math.max(1, r.w / 2) + pad;
  const ry = Math.max(1, r.h / 2) + pad;
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

// --- Minimal "tool-like" icons (SVG) ---
function IconButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={"iconBtn" + (active ? " active" : "")}
      onClick={onClick}
      disabled={disabled}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IcPointer() {
  return (
    <Svg>
      <path
        d="M8 4.5L18.5 15l-5.2.3 2.2 6-2.2.9-2.3-6-3.8 3.6V4.5Z"
        fill="rgba(255,255,255,.92)"
        stroke="rgba(255,255,255,.22)"
      />
    </Svg>
  );
}

function IcPencil() {
  return (
    <Svg>
      <path
        d="M6.5 20.8l.7-3.5L17.7 6.9c.7-.7 1.8-.7 2.5 0l.9.9c.7.7.7 1.8 0 2.5L10.7 20.7l-4.2.1Z"
        fill="rgba(255,255,255,.9)"
      />
      <path d="M6.7 20.8l3.6-.6" stroke="rgba(0,0,0,.35)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IcEraser() {
  return (
    <Svg>
      <path
        d="M6.8 17.6 15.9 8.5c.7-.7 1.8-.7 2.5 0l2.2 2.2c.7.7.7 1.8 0 2.5l-6.6 6.6H9.8l-3-2.2Z"
        fill="rgba(255,255,255,.88)"
      />
      <path d="M9.8 19.8h11" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IcRect() {
  return (
    <Svg>
      <rect x="6" y="7" width="16" height="14" rx="3" stroke="rgba(255,255,255,.9)" strokeWidth="2" />
    </Svg>
  );
}

function IcEllipse() {
  return (
    <Svg>
      <ellipse cx="14" cy="14" rx="8" ry="6.5" stroke="rgba(255,255,255,.9)" strokeWidth="2" />
    </Svg>
  );
}

function IcTriangle() {
  return (
    <Svg>
      <path
        d="M14 6.5 22 21H6L14 6.5Z"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function IcStar() {
  return (
    <Svg>
      <path
        d="M14 6.3l2.3 5.1 5.6.6-4.2 3.6 1.2 5.4-4.9-2.8-4.9 2.8 1.2-5.4-4.2-3.6 5.6-.6L14 6.3Z"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function IcLine() {
  return (
    <Svg>
      <path d="M6 20L22 8" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="20" r="1.5" fill="rgba(255,255,255,.9)" />
      <circle cx="22" cy="8" r="1.5" fill="rgba(255,255,255,.9)" />
    </Svg>
  );
}

function IcPentagon() {
  return (
    <Svg>
      <path
        d="M14 5.5l7 5.1-2.7 8.2H9.7L7 10.6l7-5.1Z"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function IcTree() {
  return (
    <Svg>
      <path
        d="M14 5l7 10h-4l4 6H7l4-6H7l7-10Z"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12.2 21h3.6" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IcUmbrella() {
  return (
    <Svg>
      <path
        d="M6 13a8 8 0 0 1 16 0"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M14 13v7" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M14 20c0 1.8 2.5 1.8 2.5 0"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function IcHeart() {
  return (
    <Svg>
      <path
        d="M14 21s-7-4.6-7-9.4C7 8.7 9.1 7 11.2 7c1.4 0 2.4.7 2.8 1.3.4-.6 1.4-1.3 2.8-1.3C19 7 21 8.7 21 11.6 21 16.4 14 21 14 21Z"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}


function IcUndo() {
  return (
    <Svg>
      <path
        d="M11 8.3 6.8 12.5 11 16.7"
        stroke="rgba(255,255,255,.92)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 12.5h9.2c2.7 0 4.8 2 4.8 4.6 0 2.4-1.8 4.2-4.2 4.2"
        stroke="rgba(255,255,255,.6)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function IcRedo() {
  return (
    <Svg>
      <path
        d="M17 8.3 21.2 12.5 17 16.7"
        stroke="rgba(255,255,255,.92)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 12.5H11.8C9.1 12.5 7 14.5 7 17.1c0 2.4 1.8 4.2 4.2 4.2"
        stroke="rgba(255,255,255,.6)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function IcTrash() {
  return (
    <Svg>
      <path
        d="M9.2 9.5h9.6l-.9 12.2c-.1 1-1 1.8-2 1.8h-3.8c-1 0-1.9-.8-2-1.8L9.2 9.5Z"
        fill="rgba(255,255,255,.85)"
      />
      <path d="M8 9.5h12" stroke="rgba(0,0,0,.25)" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 8.2c.4-1 .9-1.7 2.1-1.7h1.8c1.2 0 1.7.7 2.1 1.7" stroke="rgba(255,255,255,.5)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function IcClear() {
  return (
    <Svg>
      <path
        d="M6.5 19.5h15"
        stroke="rgba(255,255,255,.65)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M10.4 18.8 18.8 10.4c.7-.7.7-1.8 0-2.5l-.7-.7c-.7-.7-1.8-.7-2.5 0L7.2 15.6"
        stroke="rgba(255,255,255,.92)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 13.2l1.2.3-.9 1 .2 1.2-1.1-.6-1.1.6.2-1.2-.9-1 1.2-.3.6-1.1.6 1.1Z"
        fill="rgba(255,255,255,.75)"
      />
    </Svg>
  );
}

function IcDownload() {
  return (
    <Svg>
      <path
        d="M14 5.8v10.4"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M10.2 12.8 14 16.7l3.8-3.9"
        stroke="rgba(255,255,255,.9)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.8 20.8h12.4" stroke="rgba(255,255,255,.55)" strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });

  const [tool, setTool] = useState<Tool>("pen");
  const [shapeType, setShapeType] = useState<ShapeType>("rect");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeTypeRef = useRef<ShapeType>("rect");
  useEffect(() => {
    shapeTypeRef.current = shapeType;
  }, [shapeType]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!shapeMenuOpen) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest?.('[data-shape-menu]') || t.closest?.('[data-shape-button]')) return;
      setShapeMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [shapeMenuOpen]);

  useEffect(() => {
    if (tool !== "shape") setShapeMenuOpen(false);
  }, [tool]);


  const [brush, setBrush] = useState<Brush>("pencil");
  const [color, setColor] = useState<string>("#111111");
  const [size, setSize] = useState<number>(6);
  
  const strokeStyle: StrokeStyle = useMemo(
    () => ({ tool: tool === "eraser" ? "eraser" : "pen", brush, color, size }),
    [tool, brush, color, size]
  );

  const [elements, setElements] = useState<Element[]>([]);
  const [history, setHistory] = useState<Element[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ----- UI layout (pin + peek) -----
  const [leftPinned, setLeftPinned] = useState<boolean>(true);
  const [leftPeek, setLeftPeek] = useState<boolean>(false);
  const [leftInteracting, setLeftInteracting] = useState<boolean>(false);

  const activeStrokeRef = useRef<StrokeElement | null>(null);
  const activeShapeRef = useRef<ShapeElement | null>(null);
  const dragRef = useRef<{
    mode: "none" | "move";
    id: string;
    start: Point;
    orig: { x1: number; y1: number; x2: number; y2: number };
  }>({ mode: "none", id: "", start: { x: 0, y: 0 }, orig: { x1: 0, y1: 0, x2: 0, y2: 0 } });

  const rafRef = useRef<number | null>(null);

  // ----- Persistence -----
  const STORAGE_KEY = "whiteboard:vector:v1";

  function deepCloneScene(scene: Element[]): Element[] {
    // structuredClone is supported in modern browsers; fallback to JSON for safety
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sc = (globalThis as any).structuredClone;
    if (typeof sc === "function") return sc(scene);
    return JSON.parse(JSON.stringify(scene)) as Element[];
  }

  function pushHistory(nextScene: Element[]) {
    const snapshot = deepCloneScene(nextScene);
    setHistory((prev) => {
      const base = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : [];
      base.push(snapshot);
      return base;
    });
    setHistoryIndex(() => {
      const baseLen = historyIndex >= 0 ? history.slice(0, historyIndex + 1).length : 0;
      return baseLen; // after push, index == baseLen
    });
    // persist immediately
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene: snapshot, historyIndex: (historyIndex >= 0 ? historyIndex + 1 : 0) }));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { scene?: Element[]; historyIndex?: number };
      if (Array.isArray(parsed.scene)) {
        setElements(parsed.scene);
        // Seed history with one state so undo isn't weird after reload
        setHistory([deepCloneScene(parsed.scene)]);
        setHistoryIndex(0);
        setSelectedId(null);
        requestRedraw(parsed.scene, null, null);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Canvas setup (resize + DPR) -----
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));

      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      sizeRef.current = { w, h, dpr };
      requestRedraw(elements, activeStrokeRef.current, activeShapeRef.current);
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    resize();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  function getCtx(): CanvasRenderingContext2D | null {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }

  // --- Drawing styles ---
  function applyStrokeStyle(ctx: CanvasRenderingContext2D, s: StrokeStyle) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;

    if (s.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = s.size * 1.25;
      return;
    }

    ctx.strokeStyle = s.color;
    switch (s.brush) {
      case "pencil":
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.lineWidth = s.size;
        break;
      case "marker":
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = s.size * 1.35;
        break;
      case "highlighter":
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = s.size * 2.2;
        break;
      case "airbrush":
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = s.size;
        break;
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, el: StrokeElement) {
    const pts = el.points;
    if (pts.length === 0) return;

    if (el.style.tool === "pen" && el.style.brush === "airbrush") {
      // Deterministic redraw based on stored dots
      const dots = el.dots ?? [];
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = el.style.color;
      for (const d of dots) {
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    applyStrokeStyle(ctx, el.style);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement) {
    const r = normalizeRect(el.x1, el.y1, el.x2, el.y2);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = el.color;
    ctx.lineWidth = Math.max(1, el.size);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const cx = r.left + r.w / 2;
    const cy = r.top + r.h / 2;

    if (el.shape === "line") {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (el.shape === "rect") {
      ctx.strokeRect(r.left, r.top, r.w, r.h);
      ctx.restore();
      return;
    }

    if (el.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, r.w / 2), Math.max(1, r.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (el.shape === "triangle") {
      const x1 = r.left + r.w / 2;
      const y1 = r.top;
      const x2 = r.left;
      const y2 = r.bottom;
      const x3 = r.right;
      const y3 = r.bottom;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (el.shape === "pentagon") {
      const rad = Math.max(6, Math.min(r.w, r.h) / 2);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (el.shape === "star") {
      // 5-point star
      const outer = Math.max(6, Math.min(r.w, r.h) / 2);
      const inner = outer * 0.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? outer : inner;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (el.shape === "tree") {
      // Simple Christmas tree: big triangle + small trunk
      const trunkH = Math.max(6, r.h * 0.18);
      const trunkW = Math.max(6, r.w * 0.18);
      const topY = r.top;
      const baseY = r.bottom - trunkH;
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(r.left, baseY);
      ctx.lineTo(r.right, baseY);
      ctx.closePath();
      ctx.stroke();

      const tx = cx - trunkW / 2;
      const ty = baseY;
      ctx.strokeRect(tx, ty, trunkW, trunkH);
      ctx.restore();
      return;
    }

    
if (el.shape === "umbrella") {
  // Umbrella: stable canopy + scallops + handle that stays inside the bounding box
  const x = r.left;
  const y = r.top;
  const w = Math.max(12, r.w);
  const h = Math.max(12, r.h);

  const left = x + w * 0.12;
  const right = x + w * 0.88;
  const top = y + h * 0.10;
  const canopyBottom = y + h * 0.55;
  const scallopDepth = Math.min(h * 0.09, (right - left) * 0.07);

  // Canopy top (a smooth arc-like curve)
  ctx.beginPath();
  ctx.moveTo(left, canopyBottom);
  ctx.quadraticCurveTo(cx, top, right, canopyBottom);

  // Scalloped bottom edge (connected, not separate strokes)
  const scallops = 4;
  const seg = (right - left) / scallops;
  for (let i = 0; i < scallops; i++) {
    const x0 = left + i * seg;
    const x1 = x0 + seg;
    const xm = (x0 + x1) / 2;
    ctx.quadraticCurveTo(xm, canopyBottom + scallopDepth, x1, canopyBottom);
  }
  ctx.stroke();

  // Center rib
  ctx.beginPath();
  ctx.moveTo(cx, top + h * 0.06);
  ctx.lineTo(cx, canopyBottom);
  ctx.stroke();

  // Handle stem
  const stemTop = canopyBottom;
  const stemBottom = y + h * 0.86;
  ctx.beginPath();
  ctx.moveTo(cx, stemTop);
  ctx.lineTo(cx, stemBottom);
  ctx.stroke();

  // Hook (J-shape) — smooth arc that stays inside the box
  const hookR = Math.min(w, h) * 0.12;
  const hookCx = cx + hookR;
  const hookCy = Math.min(y + h * 0.94, stemBottom + hookR);
  ctx.beginPath();
  ctx.arc(hookCx, hookCy, hookR, Math.PI, Math.PI * 1.55, false);
  ctx.stroke();

  ctx.restore();
  return;
}

    
if (el.shape === "heart") {
  // Heart: smoother "classic" heart (no pointy cat-ears), stable in any drag direction
  const x = r.left;
  const y = r.top;
  const w = Math.max(12, r.w);
  const h = Math.max(12, r.h);

  const cx2 = x + w / 2;
  const bottomY = y + h;
  const topY = y + h * 0.30;
  const dipY = y + h * 0.22;

  ctx.beginPath();
  // Start at bottom point
  ctx.moveTo(cx2, bottomY);

  // Left side up to left lobe
  ctx.bezierCurveTo(
    x + w * 0.05,
    y + h * 0.75,
    x,
    y + h * 0.50,
    x + w * 0.25,
    topY
  );

  // Left lobe to top dip
  ctx.bezierCurveTo(
    x + w * 0.20,
    y + h * 0.06,
    cx2 - w * 0.18,
    y + h * 0.06,
    cx2,
    dipY
  );

  // Top dip to right lobe
  ctx.bezierCurveTo(
    cx2 + w * 0.18,
    y + h * 0.06,
    x + w * 0.80,
    y + h * 0.06,
    x + w * 0.75,
    topY
  );

  // Right side back to bottom point
  ctx.bezierCurveTo(
    x + w,
    y + h * 0.50,
    x + w * 0.95,
    y + h * 0.75,
    cx2,
    bottomY
  );

  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  return;
}

    ctx.restore();
  }

  function drawSelection(ctx: CanvasRenderingContext2D, el: ShapeElement) {
    const r = normalizeRect(el.x1, el.y1, el.x2, el.y2);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeRect(r.left - 3, r.top - 3, r.w + 6, r.h + 6);
    ctx.setLineDash([]);
    // tiny handles
    const s = 6;
    const handles: Point[] = [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: r.left, y: r.bottom },
    ];
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    for (const h of handles) {
      ctx.beginPath();
      ctx.rect(h.x - s / 2, h.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw(scene: Element[], activeStroke: StrokeElement | null, activeShape: ShapeElement | null) {
    const ctx = getCtx();
    if (!ctx) return;
    const { w, h } = sizeRef.current;

    // Clear to transparent; the paper background is handled by CSS on the stage.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w * sizeRef.current.dpr, h * sizeRef.current.dpr);
    ctx.restore();

    // Draw scene
    for (const el of scene) {
      if (el.kind === "stroke") drawStroke(ctx, el);
      else drawShape(ctx, el);
    }
    // Active previews
    if (activeStroke) drawStroke(ctx, activeStroke);
    if (activeShape) drawShape(ctx, activeShape);

    // Selection overlay
    if (selectedId) {
      const found = scene.find((e) => e.kind === "shape" && e.id === selectedId) as ShapeElement | undefined;
      if (found) drawSelection(ctx, found);
    }
  }

  function requestRedraw(scene: Element[], activeStroke: StrokeElement | null, activeShape: ShapeElement | null) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      redraw(scene, activeStroke, activeShape);
      rafRef.current = null;
    });
  }

  // --- Airbrush dot generation ---
  function addAirbrushDots(stroke: StrokeElement, from: Point, to: Point) {
    const d = dist(from, to);
    const steps = Math.max(1, Math.floor(d / 2));
    const radius = Math.max(2, stroke.style.size);
    const dots = stroke.dots ?? (stroke.dots = []);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const count = Math.floor(radius * 1.6);
      for (let j = 0; j < count; j++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const dx = Math.cos(ang) * r;
        const dy = Math.sin(ang) * r;
        const dotSize = Math.max(1, Math.random() * (radius / 3));
        dots.push({ x: x + dx, y: y + dy, r: dotSize, a: 0.20 });
      }
    }
  }

  // ----- Input handling -----
  function onPointerDown(e: PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = getCanvasPoint(e, canvas);

    if (tool === "select") {
      // hit test shapes from topmost
      const shapes = elements.filter((el) => el.kind === "shape") as ShapeElement[];
      const hit = [...shapes].reverse().find((s) => hitTestShape(s, p));
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = {
          mode: "move",
          id: hit.id,
          start: p,
          orig: { x1: hit.x1, y1: hit.y1, x2: hit.x2, y2: hit.y2 },
        };
      } else {
        setSelectedId(null);
        dragRef.current.mode = "none";
      }
      requestRedraw(elements, activeStrokeRef.current, activeShapeRef.current);
      return;
    }

    if (tool === "shape") {
      setSelectedId(null);
      const sh: ShapeElement = {
        id: makeId(),
        kind: "shape",
        shape: shapeTypeRef.current,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        color,
        size,
      };
      activeShapeRef.current = sh;
      requestRedraw(elements, null, sh);
      return;
    }

    // pen / eraser
    const st: StrokeElement = {
      id: makeId(),
      kind: "stroke",
      points: [p],
      style: {
        tool: tool === "eraser" ? "eraser" : "pen",
        brush,
        color,
        size,
      },
      dots: tool === "eraser" || brush !== "airbrush" ? undefined : [],
    };
    activeStrokeRef.current = st;
    if (st.style.tool === "pen" && st.style.brush === "airbrush") {
      addAirbrushDots(st, p, p);
    }
    requestRedraw(elements, st, null);
  }

  function onPointerMove(e: PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = getCanvasPoint(e, canvas);

    // Move selected shape
    if (tool === "select" && dragRef.current.mode === "move") {
      const dx = p.x - dragRef.current.start.x;
      const dy = p.y - dragRef.current.start.y;
      const id = dragRef.current.id;
      const next = elements.map((el) => {
        if (el.kind !== "shape" || el.id !== id) return el;
        return {
          ...el,
          x1: dragRef.current.orig.x1 + dx,
          y1: dragRef.current.orig.y1 + dy,
          x2: dragRef.current.orig.x2 + dx,
          y2: dragRef.current.orig.y2 + dy,
        };
      });
      requestRedraw(next, null, null);
      return;
    }

    // Shape preview
    if (tool === "shape" && activeShapeRef.current) {
      activeShapeRef.current = { ...activeShapeRef.current, x2: p.x, y2: p.y };
      requestRedraw(elements, null, activeShapeRef.current);
      return;
    }

    // Stroke preview
    if ((tool === "pen" || tool === "eraser") && activeStrokeRef.current) {
      const st = activeStrokeRef.current;
      const last = st.points[st.points.length - 1];
      st.points.push(p);
      if (st.style.tool === "pen" && st.style.brush === "airbrush") {
        addAirbrushDots(st, last, p);
      }
      requestRedraw(elements, st, null);
    }
  }

  function onPointerUp(e: PointerEvent) {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    // Commit move
    if (tool === "select" && dragRef.current.mode === "move") {
      dragRef.current.mode = "none";
      // commit moved scene
      const id = selectedId;
      if (id) {
        const committed = elements.map((el) => {
          if (el.kind !== "shape" || el.id !== id) return el;
          // values are already updated in preview, but elements state isn't
          // so we need to read the current preview by recomputing from dragRef
          // However, easiest: just trigger a no-op push after syncing state.
          return el;
        });
        // Sync state from last redraw by recomputing with last pointer location
        const p = getCanvasPoint(e, canvasRef.current!);
        const dx = p.x - dragRef.current.start.x;
        const dy = p.y - dragRef.current.start.y;
        const next = committed.map((el) => {
          if (el.kind !== "shape" || el.id !== id) return el;
          return {
            ...el,
            x1: dragRef.current.orig.x1 + dx,
            y1: dragRef.current.orig.y1 + dy,
            x2: dragRef.current.orig.x2 + dx,
            y2: dragRef.current.orig.y2 + dy,
          };
        });
        setElements(next);
        pushHistory(next);
        requestRedraw(next, null, null);
      }
      return;
    }

    // Commit shape
    if (tool === "shape" && activeShapeRef.current) {
      const sh = activeShapeRef.current;
      activeShapeRef.current = null;
      const next = [...elements, sh];
      setElements(next);
      pushHistory(next);
      requestRedraw(next, null, null);
      return;
    }

    // Commit stroke
    if ((tool === "pen" || tool === "eraser") && activeStrokeRef.current) {
      const st = activeStrokeRef.current;
      activeStrokeRef.current = null;
      const next = [...elements, st];
      setElements(next);
      pushHistory(next);
      requestRedraw(next, null, null);
    }
  }

  function bindPointerEvents() {
    const canvas = canvasRef.current;
    if (!canvas) return () => {};
    const down = (e: PointerEvent) => onPointerDown(e);
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = (e: PointerEvent) => onPointerUp(e);
    const cancel = (e: PointerEvent) => onPointerUp(e);

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
    };
  }

  useEffect(() => {
    return bindPointerEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, brush, color, size, elements, selectedId]);

  // ----- Undo/Redo based on scene snapshots -----
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  function undo() {
    if (!canUndo) return;
    const nextIndex = historyIndex - 1;
    const snap = history[nextIndex];
    if (!snap) return;
    setHistoryIndex(nextIndex);
    setElements(snap);
    setSelectedId(null);
    requestRedraw(snap, null, null);
  }

  function redo() {
    if (!canRedo) return;
    const nextIndex = historyIndex + 1;
    const snap = history[nextIndex];
    if (!snap) return;
    setHistoryIndex(nextIndex);
    setElements(snap);
    setSelectedId(null);
    requestRedraw(snap, null, null);
  }

  function clearBoard() {
    setSelectedId(null);
    setElements([]);
    setHistory([[]]);
    setHistoryIndex(0);
    requestRedraw([], null, null);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene: [], historyIndex: 0 }));
    } catch {
      // ignore
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    const next = elements.filter((el) => el.id !== selectedId);
    setSelectedId(null);
    setElements(next);
    pushHistory(next);
    requestRedraw(next, null, null);
  }

  async function exportPNG() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (!blob) return;
    // replaceAll isn't available in older TS lib targets; keep it compatible
    const ts = new Date().toISOString().slice(0, 19).split(":").join("-");
    downloadBlob(blob, `whiteboard-${ts}.png`);
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (!isMod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex, history, selectedId, elements]);

  // Initial history seed (first render)
  useEffect(() => {
    if (historyIndex === -1 && history.length === 0) {
      setHistory([[]]);
      setHistoryIndex(0);
      requestRedraw([], null, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusToolLabel = useMemo(() => {
    if (tool === "eraser") return "eraser";
    if (tool === "pen") return brush;
    if (tool === "shape") return shapeType;
    return tool;
  }, [tool, brush, shapeType]);

  const leftOpen = leftPinned || leftPeek;

  return (
    <div className="app">
      <div className="stage" ref={containerRef}>
        <div className="paper" aria-hidden="true" />
        <canvas ref={canvasRef} className="canvas" />

        {/* Left edge hover hotspot for peek */}
        {!leftPinned && !leftOpen && (
          <div
            className="edgeHotspot left"
            onMouseEnter={() => setLeftPeek(true)}
            aria-hidden="true"
          />
        )}


        {/* Left tool dock (tools only) */}
        <nav
          className={"dock dockLeft " + (leftOpen ? "open" : "closed")}
          aria-label="Tools"
          onMouseEnter={() => {
            setLeftInteracting(true);
            if (!leftPinned) setLeftPeek(true);
          }}
          onMouseLeave={() => {
            setLeftInteracting(false);
            if (!leftPinned) setLeftPeek(false);
          }}
        >
          <button
            className="dockHandle"
            type="button"
            title={leftPinned ? "Unpin dock" : "Pin dock"}
            onClick={() => {
              setLeftPinned((p) => !p);
              setLeftPeek(false);
            }}
          >
            <span className={"chev " + (leftOpen ? "open" : "")}>▸</span>
          </button>

          <div className="dockGroup">
            <IconButton title="Select / Move" active={tool === "select"} onClick={() => { setTool("select"); setShapeMenuOpen(false); }}
              ><IcPointer /></IconButton>
            <IconButton title="Pen" active={tool === "pen"} onClick={() => { setTool("pen"); setShapeMenuOpen(false); }}
              ><IcPencil /></IconButton>
            <IconButton title="Eraser" active={tool === "eraser"} onClick={() => { setTool("eraser"); setShapeMenuOpen(false); }}
              ><IcEraser /></IconButton>
            <div className="shapeToolWrap">
              <button
                className={"iconBtn" + (tool === "shape" ? " active" : "")}
                title="Shapes"
                type="button"
                data-shape-button
                onClick={() => {
                  setTool("shape");
                  setShapeMenuOpen((o) => !o);
                }}
              >
                {shapeType === "rect" ? (
                  <IcRect />
                ) : shapeType === "ellipse" ? (
                  <IcEllipse />
                ) : shapeType === "triangle" ? (
                  <IcTriangle />
                ) : (
                  <IcStar />
                )}
              </button>

              {shapeMenuOpen && tool === "shape" && (
                <div className="shapeMenuPop" data-shape-menu>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "rect" ? " active" : "")}
                    title="Rectangle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "rect";
                      setShapeType("rect");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcRect />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "ellipse" ? " active" : "")}
                    title="Circle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "ellipse";
                      setShapeType("ellipse");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcEllipse />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "line" ? " active" : "")}
                    title="Line"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "line";
                      setShapeType("line");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcLine />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "triangle" ? " active" : "")}
                    title="Triangle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "triangle";
                      setShapeType("triangle");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcTriangle />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "star" ? " active" : "")}
                    title="Star"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "star";
                      setShapeType("star");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcStar />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "pentagon" ? " active" : "")}
                    title="Pentagon"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "pentagon";
                      setShapeType("pentagon");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcPentagon />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "heart" ? " active" : "")}
                    title="Heart"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "heart";
                      setShapeType("heart");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcHeart />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "umbrella" ? " active" : "")}
                    title="Umbrella"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "umbrella";
                      setShapeType("umbrella");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcUmbrella />
                  </button>
                  <button
                    type="button"
                    className={"shapeBtnPop" + (shapeType === "tree" ? " active" : "")}
                    title="Christmas tree"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      shapeTypeRef.current = "tree";
                      setShapeType("tree");
                      setShapeMenuOpen(false);
                    }}
                  >
                    <IcTree />
                  </button>
                </div>
              )}
            </div>
          </div>

          {leftOpen && (
            <div className="dockPanel" aria-label="Tool settings">
              {tool === "pen" && (
                <>
                  <div className="miniLabel">
                    <div className="miniTitle">Brush</div>
                    <select className="miniSelect" value={brush} onChange={(e) => setBrush(e.target.value as Brush)}>
                      <option value="pencil">Pencil</option>
                      <option value="marker">Marker</option>
                      <option value="highlighter">Highlighter</option>
                      <option value="airbrush">Airbrush</option>
                    </select>
                  </div>

                  <div className="miniLabel">
                    <div className="miniTitle">Color</div>
                    <input className="colorWell" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                  </div>

                  <div className="miniLabel">
                    <div className="miniTitle">Size</div>
                    <input
                      className="sizeSlider"
                      type="range"
                      min={2}
                      max={72}
                      step={1}
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    />
                    <div className="miniValue">{size}px</div>
                  </div>
                </>
              )}

              {tool === "eraser" && (
                <>
                  <div className="miniLabel">
                    <div className="miniTitle">Eraser</div>
                    <input
                      className="sizeSlider"
                      type="range"
                      min={4}
                      max={96}
                      step={1}
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    />
                    <div className="miniValue">{size}px</div>
                  </div>
                </>
              )}

              {tool === "shape" && (
                <>
                  <div className="miniLabel">
                    <div className="miniTitle">Stroke</div>
                    <input className="colorWell" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                  </div>

                  <div className="miniLabel">
                    <div className="miniTitle">Width</div>
                    <input
                      className="sizeSlider"
                      type="range"
                      min={1}
                      max={48}
                      step={1}
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    />
                    <div className="miniValue">{size}px</div>
                  </div>
                </>
              )}

              {tool === "select" && (
                <>
                  <div className="miniLabel">
                    <div className="miniTitle">Selection</div>
                    <IconButton title="Delete selected (Del)" disabled={!selectedId} onClick={deleteSelected}>
                      <IcTrash />
                    </IconButton>
                    <div className="miniValue">{selectedId ? "1 selected" : "None"}</div>
                  </div>
                </>
              )}
            </div>
          )}


          {!leftOpen && (
            <div className="dockTab" aria-hidden="true">
              <div className="dockTabDot" />
            </div>
          )}
        </nav>

        {/* Top-right global actions */}
        <div className="actions" aria-label="Actions">
          <IconButton title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}><IcUndo /></IconButton>
          <IconButton title="Redo (Ctrl/Cmd+Y)" disabled={!canRedo} onClick={redo}><IcRedo /></IconButton>
          <IconButton title="Clear board" onClick={clearBoard}><IcClear /></IconButton>
          <IconButton title="Export PNG" onClick={exportPNG}><IcDownload /></IconButton>
        </div>

        {/* Bottom full-width inspector (contextual) */}
      </div>
    </div>
  );
}
