#!/usr/bin/env node
/* Renders the magnetic pendulum's basins of attraction to assets/basins-*.png, plus
 * assets/basins.json describing the views (×1, ×10, ×100, ×1000) and, in each, a pair of
 * nearby release points that end over different magnets.
 *
 * Far too slow to compute on a Pi 3 (≈3.5 ms per pixel: ~47 min for 900×900), so it is
 * rendered ahead of time. Uses all cores:   node tools/render-basins.js [size]
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const mp = require("../simulations/magnetic-pendulum.js");

// Basin colours [r, g, b]: one per magnet. Shaded darker the longer the bob took to settle.
const COLORS = [[255, 70, 140], [40, 200, 230], [255, 190, 50]];

if (!isMainThread) {
	const { size, view, rows } = workerData;
	const out = [];
	for (const j of rows) {
		const row = new Uint8Array(size * 2); // magnet, settle time in 1/3 s (capped at 255)
		for (let i = 0; i < size; i++) {
			const x = view.cx + view.half * (2 * (i + 0.5) / size - 1);
			const y = view.cy - view.half * (2 * (j + 0.5) / size - 1);
			const r = mp.settle(x, y);
			row[2 * i] = r.magnet;
			row[2 * i + 1] = Math.min(255, Math.round(r.time * 3));
		}
		out.push([j, row]);
	}
	parentPort.postMessage(out);
	return;
}

async function render (size, view) {
	const n = os.cpus().length;
	const rows = Array.from({ length: n }, () => []);
	for (let j = 0; j < size; j++) rows[j % n].push(j);
	const grid = new Uint8Array(size * size * 2);
	await Promise.all(rows.map((r) => new Promise((resolve, reject) => {
		const w = new Worker(__filename, { workerData: { size, view, rows: r } });
		w.on("message", (res) => { for (const [j, row] of res) grid.set(row, j * size * 2); resolve(); });
		w.on("error", reject);
	})));
	return grid;
}

function toRGB (grid, size) {
	const rgb = new Uint8Array(size * size * 3);
	for (let p = 0; p < size * size; p++) {
		const c = COLORS[grid[2 * p]];
		const t = grid[2 * p + 1] / 3;               // seconds to settle
		const shade = 0.3 + 0.7 * Math.exp(-t / 30); // quick = bright, long chaotic wander = dark
		for (let k = 0; k < 3; k++) rgb[3 * p + k] = Math.round(c[k] * shade);
	}
	return rgb;
}

// minimal PNG writer (8-bit RGB), no dependencies
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png (rgb, w, h) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
	]);
}

// The most intricate spot for the next zoom: the window (a tenth of the view across)
// with the most basin boundaries in it, away from the smooth centre.
function findIntricate (grid, size, view, minRadius) {
	const win = Math.round(size / 10);
	let best = null;
	for (let j = 0; j + win <= size; j += 4) for (let i = 0; i + win <= size; i += 4) {
		const x = view.cx + view.half * (2 * (i + win / 2) / size - 1), y = view.cy - view.half * (2 * (j + win / 2) / size - 1);
		if (Math.hypot(x, y) < minRadius) continue;
		let edges = 0;
		const seen = new Set();
		for (let b = j; b < j + win; b++) for (let a = i; a < i + win; a++) {
			const m = grid[2 * (b * size + a)];
			seen.add(m);
			if (a + 1 < i + win && grid[2 * (b * size + a + 1)] !== m) edges++;
			if (b + 1 < j + win && grid[2 * ((b + 1) * size + a)] !== m) edges++;
		}
		if (seen.size === 3 && (!best || edges > best.edges)) best = { x, y, edges };
	}
	return best;
}

// Two release points `gap` apart (horizontally) inside the view that settle on different magnets.
function findSplitPair (view, gap) {
	for (let k = 0; k < 4000; k++) {
		const a = (k * 0.618034) % 1, b = (k * 0.414214) % 1;
		const x = view.cx + view.half * (a - 0.5), y = view.cy + view.half * (b - 0.5);
		const m1 = mp.settle(x, y).magnet, m2 = mp.settle(x + gap, y).magnet;
		if (m1 !== m2) return [[x, y, m1], [x + gap, y, m2]];
	}
	throw new Error("no split pair found");
}

(async () => {
	const size = Number(process.argv[2]) || 1000;
	const outDir = path.join(__dirname, "..", "assets");
	fs.mkdirSync(outDir, { recursive: true });

	const full = { cx: 0, cy: 0, half: 2.5 };
	const views = [full];
	for (let z = 1; z <= 3; z++) {
		const prev = views[z - 1];
		const probe = await render(300, prev);
		const spot = findIntricate(probe, 300, prev, z === 1 ? 1.3 : 0);
		views.push({ cx: spot.x, cy: spot.y, half: prev.half / 10 });
	}
	const meta = { params: mp.PARAMS, magnets: mp.MAGNETS, colors: COLORS, size, views: [] };
	for (let v = 0; v < views.length; v++) {
		const t0 = Date.now();
		const grid = await render(size, views[v]);
		const file = `basins-${v}.png`;
		fs.writeFileSync(path.join(outDir, file), png(toRGB(grid, size), size, size));
		const counts = [0, 0, 0];
		for (let p = 0; p < size * size; p++) counts[grid[2 * p]]++;
		const gap = views[v].half / 8; // clearly apart in its own view
		meta.views.push({ ...views[v], file, counts, pair: findSplitPair(views[v], gap), gap });
		console.log(`${file}: ${size}×${size}, centre (${views[v].cx.toFixed(5)}, ${views[v].cy.toFixed(5)}), ` +
			`half-width ${views[v].half}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	}
	fs.writeFileSync(path.join(outDir, "basins.json"), JSON.stringify(meta, null, "\t") + "\n");
})();
