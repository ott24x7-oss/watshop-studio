import {
	ArrowUpRight,
	Eraser,
	Highlighter,
	MousePointer2,
	Pencil,
	Square,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Tool = "cursor" | "pen" | "highlighter" | "arrow" | "rect";

type Stroke =
	| { kind: "freehand"; tool: "pen" | "highlighter"; color: string; size: number; points: { x: number; y: number }[] }
	| { kind: "shape"; tool: "arrow" | "rect"; color: string; size: number; from: { x: number; y: number }; to: { x: number; y: number } };

const COLORS = [
	{ name: "red", value: "#FF4D4F" },
	{ name: "yellow", value: "#FACC15" },
	{ name: "green", value: "#34C77B" },
	{ name: "blue", value: "#5B8DEF" },
	{ name: "white", value: "#FFFFFF" },
];

const PEN_SIZE = 3;
const HIGHLIGHT_SIZE = 18;
const SHAPE_SIZE = 4;

/**
 * Full-screen transparent overlay for marking up the screen during a recording.
 * The Electron BrowserWindow is in click-through mode by default; the renderer
 * flips it off when the cursor is over the toolbar or actively drawing.
 */
export function AnnotationOverlay() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [tool, setTool] = useState<Tool>("pen");
	const [color, setColor] = useState(COLORS[0].value);
	const drawingRef = useRef<Stroke | null>(null);

	// ─── Canvas sizing & redraw ─────────────────────────────────────────
	useEffect(() => {
		const resize = () => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = window.innerWidth * dpr;
			canvas.height = window.innerHeight * dpr;
			canvas.style.width = `${window.innerWidth}px`;
			canvas.style.height = `${window.innerHeight}px`;
			redraw();
		};
		resize();
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		redraw();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [strokes]);

	const redraw = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		const all = drawingRef.current ? [...strokes, drawingRef.current] : strokes;
		for (const s of all) drawStroke(ctx, s);
	};

	const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
		ctx.save();
		ctx.strokeStyle = s.color;
		ctx.fillStyle = s.color;
		ctx.lineWidth = s.size;
		if (s.kind === "freehand") {
			if (s.tool === "highlighter") ctx.globalAlpha = 0.35;
			ctx.beginPath();
			const pts = s.points;
			if (pts.length < 2) {
				if (pts.length === 1) {
					ctx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
					ctx.fill();
				}
			} else {
				ctx.moveTo(pts[0].x, pts[0].y);
				for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
				ctx.stroke();
			}
		} else if (s.kind === "shape" && s.tool === "rect") {
			ctx.strokeRect(s.from.x, s.from.y, s.to.x - s.from.x, s.to.y - s.from.y);
		} else if (s.kind === "shape" && s.tool === "arrow") {
			drawArrow(ctx, s.from, s.to, s.size);
		}
		ctx.restore();
	};

	const drawArrow = (
		ctx: CanvasRenderingContext2D,
		from: { x: number; y: number },
		to: { x: number; y: number },
		size: number,
	) => {
		const headLength = Math.max(12, size * 4);
		const angle = Math.atan2(to.y - from.y, to.x - from.x);
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(to.x, to.y);
		ctx.lineTo(
			to.x - headLength * Math.cos(angle - Math.PI / 6),
			to.y - headLength * Math.sin(angle - Math.PI / 6),
		);
		ctx.lineTo(
			to.x - headLength * Math.cos(angle + Math.PI / 6),
			to.y - headLength * Math.sin(angle + Math.PI / 6),
		);
		ctx.closePath();
		ctx.fill();
	};

	// ─── Mouse pass-through control ─────────────────────────────────────
	const setPassthrough = (passthrough: boolean) => {
		window.electronAPI?.annotationSetMousePassthrough?.(passthrough).catch(() => {});
	};

	// When tool === "cursor", the entire canvas is click-through.
	// Otherwise the canvas captures mouse events to draw.
	useEffect(() => {
		setPassthrough(tool === "cursor");
	}, [tool]);

	// ─── Drawing handlers ───────────────────────────────────────────────
	const onCanvasDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (tool === "cursor") return;
		const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
		const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		if (tool === "pen" || tool === "highlighter") {
			drawingRef.current = {
				kind: "freehand",
				tool,
				color,
				size: tool === "highlighter" ? HIGHLIGHT_SIZE : PEN_SIZE,
				points: [point],
			};
		} else if (tool === "arrow" || tool === "rect") {
			drawingRef.current = {
				kind: "shape",
				tool,
				color,
				size: SHAPE_SIZE,
				from: point,
				to: point,
			};
		}
		redraw();
	};

	const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!drawingRef.current) return;
		const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
		const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const d = drawingRef.current;
		if (d.kind === "freehand") d.points.push(point);
		else d.to = point;
		redraw();
	};

	const finalizeStroke = () => {
		if (!drawingRef.current) return;
		const finished = drawingRef.current;
		drawingRef.current = null;
		setStrokes((prev) => [...prev, finished]);
	};

	const clearAll = () => setStrokes([]);
	const undo = () => setStrokes((prev) => prev.slice(0, -1));
	const close = () => window.electronAPI?.annotationClose?.();

	// ─── Render ─────────────────────────────────────────────────────────
	const cursorClass =
		tool === "cursor"
			? "cursor-default"
			: tool === "pen" || tool === "highlighter"
				? "cursor-crosshair"
				: "cursor-crosshair";

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				width: "100vw",
				height: "100vh",
				background: "transparent",
				overflow: "hidden",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}
		>
			<canvas
				ref={canvasRef}
				className={cursorClass}
				style={{ position: "absolute", inset: 0, pointerEvents: tool === "cursor" ? "none" : "auto" }}
				onMouseDown={onCanvasDown}
				onMouseMove={onCanvasMove}
				onMouseUp={finalizeStroke}
				onMouseLeave={finalizeStroke}
			/>

			{/* Toolbar — always captures mouse */}
			<div
				style={{
					position: "absolute",
					top: 16,
					left: "50%",
					transform: "translateX(-50%)",
					display: "flex",
					alignItems: "center",
					gap: 4,
					padding: "6px 8px",
					background: "rgba(15, 31, 26, 0.92)",
					backdropFilter: "blur(20px)",
					WebkitBackdropFilter: "blur(20px)",
					border: "1px solid rgba(244,241,234,0.10)",
					borderRadius: 12,
					boxShadow: "0 12px 30px -10px rgba(0,0,0,0.5)",
					pointerEvents: "auto",
					fontFamily:
						"Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
				}}
				onMouseEnter={() => setPassthrough(false)}
				onMouseLeave={() => setPassthrough(tool === "cursor")}
			>
				{/* Tools */}
				<ToolBtn icon={<MousePointer2 size={16} />} active={tool === "cursor"} onClick={() => setTool("cursor")} title="Click-through (no drawing)" />
				<ToolBtn icon={<Pencil size={16} />} active={tool === "pen"} onClick={() => setTool("pen")} title="Pen" />
				<ToolBtn icon={<Highlighter size={16} />} active={tool === "highlighter"} onClick={() => setTool("highlighter")} title="Highlighter" />
				<ToolBtn icon={<ArrowUpRight size={16} />} active={tool === "arrow"} onClick={() => setTool("arrow")} title="Arrow" />
				<ToolBtn icon={<Square size={16} />} active={tool === "rect"} onClick={() => setTool("rect")} title="Rectangle" />

				<Divider />

				{/* Colors */}
				{COLORS.map((c) => (
					<button
						key={c.value}
						onClick={() => setColor(c.value)}
						title={c.name}
						style={{
							width: 22,
							height: 22,
							borderRadius: "50%",
							background: c.value,
							border: color === c.value
								? "2px solid #fff"
								: "2px solid rgba(244,241,234,0.20)",
							boxShadow: color === c.value ? "0 0 0 2px rgba(52,199,123,0.5)" : "none",
							cursor: "pointer",
							padding: 0,
							flexShrink: 0,
						}}
					/>
				))}

				<Divider />

				{/* Actions */}
				<ToolBtn icon={<Eraser size={16} />} onClick={undo} title="Undo last" />
				<ToolBtn icon={<Trash2 size={16} />} onClick={clearAll} title="Clear all" danger />
				<ToolBtn icon={<X size={16} />} onClick={close} title="Close annotations" />
			</div>
		</div>
	);
}

function ToolBtn({
	icon,
	active = false,
	danger = false,
	onClick,
	title,
}: {
	icon: React.ReactNode;
	active?: boolean;
	danger?: boolean;
	onClick: () => void;
	title: string;
}) {
	return (
		<button
			onClick={onClick}
			title={title}
			style={{
				width: 30,
				height: 30,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				borderRadius: 8,
				background: active ? "rgba(52,199,123,0.20)" : "transparent",
				border: "none",
				color: active ? "#5DE89B" : danger ? "#FF6B6B" : "#F4F1EA",
				cursor: "pointer",
				flexShrink: 0,
				transition: "background 0.12s",
			}}
			onMouseEnter={(e) => {
				if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,241,234,0.08)";
			}}
			onMouseLeave={(e) => {
				if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
			}}
		>
			{icon}
		</button>
	);
}

function Divider() {
	return <div style={{ width: 1, height: 18, background: "rgba(244,241,234,0.10)", margin: "0 4px" }} />;
}
