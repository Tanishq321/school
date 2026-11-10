import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Circle, Eraser, Highlighter, Minus, PenLine, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react';

/* Inks chosen to sit on ivory paper: no pure primaries. */
const INKS = [
  { name: 'Ink', value: '#1b253d' },
  { name: 'Oxblood', value: '#8e2f28' },
  { name: 'Brass', value: '#9a7440' },
  { name: 'Sapphire', value: '#1f4e8c' },
  { name: 'Emerald', value: '#1f6b52' },
  { name: 'Graphite', value: '#5a5a5a' },
];
const WEIGHTS = [
  { name: 'Fine', value: 3 },
  { name: 'Medium', value: 6 },
  { name: 'Bold', value: 12 },
];
const TOOLS = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'highlighter', label: 'Highlighter', Icon: Highlighter },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
];
const SHAPES = new Set(['line', 'arrow', 'rect', 'ellipse']);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Draw one operation. Coordinates are 0..1 of the board; sizes are in "board units" (1/1000 of width). */
export function drawOp(ctx, op, W, H) {
  const k = W / 1000;
  const P = op.points.map(([x, y]) => [x * W, y * H]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = Math.max(1, op.size * k);
  if (op.tool === 'highlighter') {
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = op.size * k * 3.2;
    ctx.lineCap = 'butt';
  }
  if (op.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = op.size * k * 4;
  }
  if (op.tool === 'pen' || op.tool === 'highlighter' || op.tool === 'eraser') {
    ctx.beginPath();
    if (P.length === 1) {
      ctx.arc(P[0][0], P[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Quadratic curves through midpoints: smooth, ink-like strokes.
      ctx.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length - 1; i += 1) {
        const mx = (P[i][0] + P[i + 1][0]) / 2;
        const my = (P[i][1] + P[i + 1][1]) / 2;
        ctx.quadraticCurveTo(P[i][0], P[i][1], mx, my);
      }
      ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
      ctx.stroke();
    }
  } else if (SHAPES.has(op.tool) && P.length === 2) {
    const [[x1, y1], [x2, y2]] = P;
    ctx.beginPath();
    if (op.tool === 'line' || op.tool === 'arrow') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (op.tool === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const h = Math.max(10, ctx.lineWidth * 4);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
      }
    } else if (op.tool === 'rect') {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else {
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  } else if (op.tool === 'text' && op.text) {
    const px = op.size * k * 5.5;
    ctx.font = `500 ${px}px "Hanken Grotesk Variable", sans-serif`;
    ctx.textBaseline = 'top';
    op.text.split('\n').forEach((line, i) => ctx.fillText(line, P[0][0], P[0][1] + i * px * 1.25));
  }
  ctx.restore();
}

function useBoardSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.min(width, (height * 16) / 9);
      setSize({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function Whiteboard({ client, canDraw, isHost, toastError }) {
  const wrapRef = useRef(null);
  const boardRef = useRef(null);
  const liveRef = useRef(null);
  const draftRef = useRef(null); // my in-progress operation
  const lastSent = useRef(0);
  const sentCount = useRef(0);
  const { w, h } = useBoardSize(wrapRef);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(INKS[0].value);
  const [weight, setWeight] = useState(WEIGHTS[1].value);
  const [opsCount, setOpsCount] = useState(client.board.ops.length);
  const [undo, setUndo] = useState([]); // my op ids, newest last
  const [redo, setRedo] = useState([]); // ops I undid
  const [textAt, setTextAt] = useState(null); // { x, y } in 0..1

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const paintBoard = useCallback(() => {
    const c = boardRef.current;
    if (!c || !w) return;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const op of client.board.ops) drawOp(ctx, op, w, h);
    setOpsCount(client.board.ops.length);
  }, [client, w, h, dpr]);

  const paintLive = useCallback(() => {
    const c = liveRef.current;
    if (!c || !w) return;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const op of client.board.live.values()) if (op.tool !== 'eraser') drawOp(ctx, op, w, h);
    if (draftRef.current && draftRef.current.tool !== 'eraser') drawOp(ctx, draftRef.current, w, h);
  }, [client, w, h, dpr]);

  useEffect(() => {
    paintBoard();
    paintLive();
  }, [paintBoard, paintLive]);

  useEffect(() => {
    let raf = 0;
    const onBoard = ({ detail }) => {
      if (detail.kind === 'changed') {
        if (detail.cleared) {
          setUndo([]);
          setRedo([]);
        }
        paintBoard();
        paintLive();
      } else if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          paintLive();
        });
      }
    };
    client.addEventListener('board', onBoard);
    return () => {
      client.removeEventListener('board', onBoard);
      cancelAnimationFrame(raf);
    };
  }, [client, paintBoard, paintLive]);

  const toBoard = (e) => {
    const r = liveRef.current.getBoundingClientRect();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };

  const sendLive = (force) => {
    const d = draftRef.current;
    if (!d) return;
    const now = performance.now();
    if (!force && now - lastSent.current < 40) return;
    lastSent.current = now;
    if (SHAPES.has(d.tool)) {
      client.boardLive({ id: d.id, tool: d.tool, color: d.color, size: d.size, points: d.points, reset: true });
    } else {
      const delta = d.points.slice(Math.max(0, sentCount.current - 1)).slice(0, 400);
      if (!delta.length) return;
      client.boardLive({ id: d.id, tool: d.tool, color: d.color, size: d.size, points: delta, reset: sentCount.current === 0 });
      sentCount.current = d.points.length;
    }
  };

  const onPointerDown = (e) => {
    if (!canDraw || e.button > 0) return;
    const p = toBoard(e);
    if (tool === 'text') {
      setTextAt({ x: p[0], y: p[1] });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    sentCount.current = 0;
    draftRef.current = { id: newId(), tool, color, size: tool === 'eraser' ? weight * 1.5 : weight, points: SHAPES.has(tool) ? [p, p] : [p] };
    paintLive();
  };

  const onPointerMove = (e) => {
    const d = draftRef.current;
    if (!d) return;
    const p = toBoard(e);
    if (SHAPES.has(d.tool)) d.points = [d.points[0], p];
    else {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0015 || d.points.length >= 4900) return;
      d.points.push(p);
    }
    if (d.tool === 'eraser') {
      // Erasing is previewed directly on the board canvas.
      const ctx = boardRef.current.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOp(ctx, { ...d, points: d.points.slice(-3) }, w, h);
    } else paintLive();
    sendLive(false);
  };

  const commit = async (op) => {
    try {
      const done = await client.boardDraw(op);
      setUndo((u) => [...u.slice(-199), done.id]);
      setRedo([]);
    } catch (err) {
      toastError?.(err.message);
    }
  };

  const onPointerUp = () => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    paintLive();
    const isShape = SHAPES.has(d.tool);
    if (isShape && Math.hypot(d.points[1][0] - d.points[0][0], d.points[1][1] - d.points[0][1]) < 0.004) return;
    commit({ id: d.id, tool: d.tool, color: d.color, size: d.size, points: d.points.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) });
  };

  const doUndo = useCallback(async () => {
    const id = undo[undo.length - 1];
    if (!id) return;
    setUndo((u) => u.slice(0, -1));
    try {
      const removed = await client.boardErase(id);
      if (removed) setRedo((r) => [...r, removed]);
    } catch (err) {
      toastError?.(err.message);
    }
  }, [undo, client, toastError]);

  const doRedo = useCallback(async () => {
    const op = redo[redo.length - 1];
    if (!op) return;
    setRedo((r) => r.slice(0, -1));
    const { author, ...wire } = op;
    void author;
    try {
      await client.boardDraw(wire);
      setUndo((u) => [...u, op.id]);
    } catch (err) {
      toastError?.(err.message);
    }
  }, [redo, client, toastError]);

  useEffect(() => {
    const onKey = (e) => {
      if (!canDraw || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.target.closest?.('textarea,input')) return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, doUndo, doRedo]);

  const submitText = (text) => {
    const at = textAt;
    setTextAt(null);
    if (!text.trim() || !at) return;
    commit({ id: newId(), tool: 'text', color, size: weight, points: [[at.x, at.y]], text: text.slice(0, 500) });
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center" ref={wrapRef} data-testid="whiteboard">
      <div
        className="relative overflow-hidden rounded-[22px] shadow-[0_30px_80px_-30px_rgba(0,0,0,.8),inset_0_0_0_1px_rgba(154,116,64,.35)]"
        style={{
          width: w,
          height: h,
          // Ivory cotton paper with a faint dotted grid, like a good notebook.
          backgroundColor: '#f3efe6',
          backgroundImage: 'radial-gradient(rgba(27,37,61,.13) 0.9px, transparent 1.1px)',
          backgroundSize: `${Math.max(14, w / 48)}px ${Math.max(14, w / 48)}px`,
        }}
        data-ops={opsCount}
      >
        <canvas ref={boardRef} width={w * dpr} height={h * dpr} style={{ width: w, height: h }} className="absolute inset-0" />
        <canvas
          ref={liveRef}
          width={w * dpr}
          height={h * dpr}
          style={{ width: w, height: h, touchAction: 'none', cursor: canDraw ? (tool === 'text' ? 'text' : 'crosshair') : 'default' }}
          className="absolute inset-0"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Shared whiteboard"
          role="img"
          data-testid="board-canvas"
        />
        {textAt && <TextInput at={textAt} w={w} h={h} color={color} weight={weight} onDone={submitText} />}
        {!canDraw && (
          <span className="pointer-events-none absolute right-4 bottom-3 rounded-full bg-night/70 px-3 py-1 text-xs text-vellum/80 backdrop-blur">
            View only. The host can let you draw.
          </span>
        )}
      </div>

      {canDraw && (
        <div className="absolute top-3 left-1/2 flex max-w-[96%] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-vellum/10 bg-night-2/85 p-1.5 shadow-2xl backdrop-blur-md" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              aria-label={label}
              aria-pressed={tool === id}
              title={label}
              className={`flex size-9 shrink-0 items-center justify-center rounded-full transition ${tool === id ? 'bg-brand-300 text-ink' : 'text-vellum/80 hover:bg-vellum/10'}`}
            >
              <Icon size={16} strokeWidth={1.7} />
            </button>
          ))}
          <div className="mx-1 h-6 w-px shrink-0 bg-vellum/15" />
          {INKS.map((ink) => (
            <button
              key={ink.value}
              onClick={() => setColor(ink.value)}
              aria-label={`${ink.name} ink`}
              aria-pressed={color === ink.value}
              title={ink.name}
              className={`mx-1 size-6 shrink-0 rounded-full transition ${color === ink.value ? 'ring-2 ring-brand-300 ring-offset-2 ring-offset-night-2' : 'ring-1 ring-vellum/20'}`}
              style={{ background: ink.value }}
            />
          ))}
          <div className="mx-1 h-6 w-px shrink-0 bg-vellum/15" />
          {WEIGHTS.map((wt) => (
            <button
              key={wt.value}
              onClick={() => setWeight(wt.value)}
              aria-label={`${wt.name} line`}
              aria-pressed={weight === wt.value}
              title={wt.name}
              className={`flex size-9 items-center justify-center rounded-full ${weight === wt.value ? 'bg-vellum/15' : 'hover:bg-vellum/10'}`}
            >
              <span className="rounded-full bg-vellum" style={{ width: 4 + wt.value, height: 4 + wt.value }} />
            </button>
          ))}
          <div className="mx-1 h-6 w-px shrink-0 bg-vellum/15" />
          <button onClick={doUndo} disabled={!undo.length} aria-label="Undo" title="Undo (Ctrl+Z)" className="flex size-9 items-center justify-center rounded-full text-vellum/80 hover:bg-vellum/10 disabled:opacity-30">
            <Undo2 size={16} strokeWidth={1.7} />
          </button>
          <button onClick={doRedo} disabled={!redo.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="flex size-9 items-center justify-center rounded-full text-vellum/80 hover:bg-vellum/10 disabled:opacity-30">
            <Redo2 size={16} strokeWidth={1.7} />
          </button>
          {isHost && (
            <button
              onClick={() => window.confirm('Clear the board for everyone?') && client.boardClear().catch((e) => toastError?.(e.message))}
              aria-label="Clear board"
              title="Clear board"
              className="flex size-9 items-center justify-center rounded-full text-red-300 hover:bg-danger/20"
            >
              <Trash2 size={16} strokeWidth={1.7} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TextInput({ at, w, h, color, weight, onDone: done }) {
  const ref = useRef(null);
  const finished = useRef(false);
  const onDone = (v) => {
    if (finished.current) return; // Enter followed by blur must not place the text twice
    finished.current = true;
    done(v);
  };
  useEffect(() => ref.current?.focus(), []);
  const px = weight * (w / 1000) * 5.5;
  return (
    <textarea
      ref={ref}
      rows={1}
      maxLength={500}
      aria-label="Text to place on the board"
      placeholder="Type, then press Enter"
      className="absolute resize-none border-0 border-b border-dashed border-brand-500 bg-transparent p-0 outline-none placeholder:text-ink/30"
      style={{ left: at.x * w, top: at.y * h, color, font: `500 ${px}px "Hanken Grotesk Variable", sans-serif`, lineHeight: 1.25, minWidth: 160 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onDone(e.currentTarget.value);
        } else if (e.key === 'Escape') onDone('');
      }}
      onBlur={(e) => onDone(e.currentTarget.value)}
    />
  );
}
