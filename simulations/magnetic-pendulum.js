/* Magnetic pendulum: a bob swinging over three magnets, with friction.
 * It always comes to rest over one of the magnets, but which one depends on where it was
 * released so sensitively that the map of outcomes ("basins of attraction") is a fractal.
 *
 * Small-angle model in the plane of the bob, magnets at height h below it:
 *   r̈ = −k r − b ṙ + Σᵢ (rᵢ − r) / (|rᵢ − r|² + h²)^{3/2}
 * The physics here is allocation-free scalar code: it runs once per pixel.
 */
(function (root) {
	const PARAMS = { k: 0.5, b: 0.15, h: 0.25, dt: 0.02, maxTime: 80 };
	const MAGNETS = [0, 1, 2].map((i) => {
		const a = Math.PI / 2 + (2 * Math.PI * i) / 3;
		return [Math.cos(a), Math.sin(a)];
	});
	const [M0, M1, M2] = MAGNETS;

	// acceleration at (x, y) with velocity (vx, vy); writes into out[0..1]
	function accel (x, y, vx, vy, p, out) {
		const h2 = p.h * p.h;
		let ax = -p.k * x - p.b * vx, ay = -p.k * y - p.b * vy;
		let dx = M0[0] - x, dy = M0[1] - y, d = dx * dx + dy * dy + h2, f = 1 / (d * Math.sqrt(d));
		ax += dx * f; ay += dy * f;
		dx = M1[0] - x; dy = M1[1] - y; d = dx * dx + dy * dy + h2; f = 1 / (d * Math.sqrt(d));
		ax += dx * f; ay += dy * f;
		dx = M2[0] - x; dy = M2[1] - y; d = dx * dx + dy * dy + h2; f = 1 / (d * Math.sqrt(d));
		ax += dx * f; ay += dy * f;
		out[0] = ax; out[1] = ay;
	}

	// One RK4 step of the state s = [x, y, vx, vy] (a Float64Array), in place.
	const k1 = new Float64Array(2), k2 = new Float64Array(2), k3 = new Float64Array(2), k4 = new Float64Array(2);
	function rk4 (s, h, p) {
		const [x, y, vx, vy] = s;
		accel(x, y, vx, vy, p, k1);
		const x2 = x + vx * h / 2, y2 = y + vy * h / 2, vx2 = vx + k1[0] * h / 2, vy2 = vy + k1[1] * h / 2;
		accel(x2, y2, vx2, vy2, p, k2);
		const x3 = x + vx2 * h / 2, y3 = y + vy2 * h / 2, vx3 = vx + k2[0] * h / 2, vy3 = vy + k2[1] * h / 2;
		accel(x3, y3, vx3, vy3, p, k3);
		const x4 = x + vx3 * h, y4 = y + vy3 * h, vx4 = vx + k3[0] * h, vy4 = vy + k3[1] * h;
		accel(x4, y4, vx4, vy4, p, k4);
		s[0] = x + (h / 6) * (vx + 2 * vx2 + 2 * vx3 + vx4);
		s[1] = y + (h / 6) * (vy + 2 * vy2 + 2 * vy3 + vy4);
		s[2] = vx + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
		s[3] = vy + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
	}

	// Which magnet a bob released at rest at (x0, y0) ends up over, and how long it took.
	const s = new Float64Array(4);
	function settle (x0, y0, p = PARAMS) {
		s[0] = x0; s[1] = y0; s[2] = 0; s[3] = 0;
		const steps = p.maxTime / p.dt;
		let calm = 0;
		for (let n = 0; n < steps; n++) {
			rk4(s, p.dt, p);
			// captured: slow and close to a magnet for a while
			const v2 = s[2] * s[2] + s[3] * s[3];
			const m = nearest(s[0], s[1]);
			const dx = MAGNETS[m][0] - s[0], dy = MAGNETS[m][1] - s[1];
			if (v2 < 0.01 && dx * dx + dy * dy < 0.04) {
				if (++calm > 25) return { magnet: m, time: n * p.dt };
			} else calm = 0;
		}
		return { magnet: nearest(s[0], s[1]), time: p.maxTime };
	}

	function nearest (x, y) {
		let best = 0, bd = Infinity;
		for (let i = 0; i < 3; i++) {
			const d = (MAGNETS[i][0] - x) ** 2 + (MAGNETS[i][1] - y) ** 2;
			if (d < bd) { bd = d; best = i; }
		}
		return best;
	}

	// total mechanical energy: kinetic + spring + magnetic potential (−1/√(d²+h²) per magnet)
	function energy (state, p = PARAMS) {
		const [x, y, vx, vy] = state;
		let e = 0.5 * (vx * vx + vy * vy) + 0.5 * p.k * (x * x + y * y);
		for (const [mx, my] of MAGNETS) e -= 1 / Math.sqrt((mx - x) ** 2 + (my - y) ** 2 + p.h * p.h);
		return e;
	}

	// ---- the "basins" simulation: pre-rendered basin maps (tools/render-basins.js) with
	// live trajectories drawn over them ----
	const toCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
	const NAMES = ["magenta", "cyan", "gold"];

	class Basins {
		constructor ({ file = (f) => f } = {}) {
			this.resting = true; // nothing to draw until the maps have loaded
			this.t = 0;
			this.phase = "loading";
			this.dirty = false;
			fetch(file("assets/basins.json")).then((r) => r.json()).then((meta) => {
				this.meta = meta;
				this.images = meta.views.map((v) => { const im = new Image(); im.src = file(`assets/${v.file}`); return im; });
				return Promise.all(this.images.map((im) => im.decode()));
			}).then(() => this.begin(), (e) => { this.error = String(e); });
		}

		begin () {
			// the pair from the deepest zoom: at full scale they start as one
			const deepest = this.meta.views[this.meta.views.length - 1];
			this.pair = deepest.pair.map(([x, y, m]) => ({ s: new Float64Array([x, y, 0, 0]), x0: x, y0: y, predicted: m, path: [[x, y]] }));
			this.clock = new root.ChaosCommon.FixedClock(PARAMS.dt / 4); // 4 simulated seconds per real second
			this.simTime = 0;
			this.t = 0;
			this.phase = "fade";
			this.resting = false;
		}

		// pixel position of plane point (x, y) in view v, on a w-wide square canvas region
		toPx (v, x, y, w) {
			return [w / 2 + ((x - v.cx) / v.half) * (w / 2), w / 2 - ((y - v.cy) / v.half) * (w / 2)];
		}

		step (dt) {
			if (this.phase === "loading") return;
			this.t += dt;
			const T = this.t;
			if (this.phase === "fade" && T > 2.5) this.phase = "swing";
			if (this.phase === "swing") {
				let moving = false;
				this.clock.advance(dt, () => {
					this.simTime += PARAMS.dt;
					for (const b of this.pair) {
						if (b.done) continue;
						rk4(b.s, PARAMS.dt, PARAMS);
						b.path.push([b.s[0], b.s[1]]);
						const v2 = b.s[2] ** 2 + b.s[3] ** 2, m = nearest(b.s[0], b.s[1]);
						b.calm = v2 < 0.01 && (MAGNETS[m][0] - b.s[0]) ** 2 + (MAGNETS[m][1] - b.s[1]) ** 2 < 0.04 ? (b.calm || 0) + 1 : 0;
						if (b.calm > 25 || this.simTime > PARAMS.maxTime) { b.done = true; b.magnet = m; }
					}
				});
				for (const b of this.pair) if (!b.done) moving = true;
				if (!moving) { this.phase = "settled"; this.phaseAt = T; }
			}
			if (this.phase === "settled" && T - this.phaseAt > 4) { this.phase = "zoom"; this.zoomFrom = 0; this.phaseAt = T; }
			if (this.phase === "zoom" && T - this.phaseAt > 2) {
				this.zoomFrom++;
				this.phase = "hold"; this.phaseAt = T;
			}
			if (this.phase === "hold" && T - this.phaseAt > 6 && this.zoomFrom < this.meta.views.length - 1) {
				this.phase = "zoom"; this.phaseAt = T;
			}
			// only redraw while something moves; the held pictures cost nothing
			this.resting = this.phase === "hold" && this.drawnHold === this.zoomFrom;
		}

		draw (ctx, w, h) {
			const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2;
			const views = this.meta.views, T = this.t;
			ctx.save();
			ctx.translate(ox, oy);
			if (this.phase === "fade" || this.phase === "swing" || this.phase === "settled") {
				const v = views[0];
				if (this.phase === "fade" || !this.baseDrawn) {
					ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size);
					ctx.globalAlpha = Math.min(1, T / 2.5);
					ctx.drawImage(this.images[0], 0, 0, size, size);
					ctx.globalAlpha = 1;
					this.drawMagnets(ctx, v, size);
					this.baseDrawn = this.phase !== "fade";
					if (this.baseDrawn) for (const b of this.pair) b.drawn = 0;
				}
				// paths are drawn incrementally on top: only the new segments each frame
				this.pair.forEach((b, i) => {
					if (b.path.length - (b.drawn || 0) < 2) return;
					ctx.strokeStyle = i ? "#000" : "#fff";
					ctx.lineWidth = 2;
					ctx.lineJoin = "round";
					ctx.beginPath();
					const from = Math.max(0, (b.drawn || 0) - 1);
					b.path.slice(from).forEach(([x, y], k) => { const [px, py] = this.toPx(v, x, y, size); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
					ctx.stroke();
					b.drawn = b.path.length;
				});
			} else if (this.phase === "zoom") {
				// fly from view zoomFrom into view zoomFrom+1: scale the current picture up
				const a = views[this.zoomFrom], b = views[this.zoomFrom + 1];
				const f = Math.min(1, (T - this.phaseAt) / 2), ease = f * f * (3 - 2 * f);
				const half = a.half * Math.pow(b.half / a.half, ease);
				const cx = a.cx + (b.cx - a.cx) * ease, cy = a.cy + (b.cy - a.cy) * ease;
				const [sx, sy] = this.toPx(a, cx - half, cy + half, this.images[this.zoomFrom].naturalWidth);
				const sw = (half / a.half) * this.images[this.zoomFrom].naturalWidth;
				ctx.drawImage(this.images[this.zoomFrom], sx, sy, sw, sw, 0, 0, size, size);
			} else if (this.phase === "hold") {
				const v = views[this.zoomFrom];
				ctx.drawImage(this.images[this.zoomFrom], 0, 0, size, size);
				this.drawMagnets(ctx, v, size);
				// the two release points
				this.pair.forEach((b, i) => {
					const [px, py] = this.toPx(v, b.x0, b.y0, size);
					ctx.fillStyle = i ? "#000" : "#fff";
					ctx.strokeStyle = i ? "#fff" : "#000";
					ctx.lineWidth = 2;
					ctx.beginPath(); ctx.arc(px, py, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
				});
				this.drawnHold = this.zoomFrom;
			}
			ctx.restore();
		}

		drawMagnets (ctx, v, size) {
			MAGNETS.forEach(([x, y]) => {
				const [px, py] = this.toPx(v, x, y, size);
				if (px < -20 || py < -20 || px > size + 20 || py > size + 20) return;
				ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
				ctx.beginPath(); ctx.arc(px, py, 10, 0, 2 * Math.PI); ctx.stroke();
			});
		}

		readout () {
			if (this.error) return `could not load basin maps: ${this.error}`;
			if (!this.pair) return "";
			const [a, b] = this.pair, colors = this.meta.colors;
			const end = (p) => (p.done ? `<span style="color:${toCss(colors[p.magnet])}">→ ${NAMES[p.magnet]} magnet</span>` : "swinging…");
			const zoom = this.phase === "hold" || this.phase === "zoom" ? `\nview: ${Math.round(this.meta.views[0].half / this.meta.views[this.zoomFrom].half)}× magnified` : "";
			return `white released at (${a.x0.toFixed(6)}, ${a.y0.toFixed(6)})  ${end(a)}\n` +
				`black released at (${b.x0.toFixed(6)}, ${b.y0.toFixed(6)})  ${end(b)}\n` +
				`${root.ChaosCommon.sci(b.x0 - a.x0)} apart — every colour boundary is infinitely intricate${zoom}`;
		}
	}

	Basins.info = {
		title: "Fractal basins",
		subtitle: "a pendulum over three magnets — colour shows where it comes to rest",
		equations: [
			"r̈ = −k r − b ṙ + Σ<sub>i</sub> <span class=\"frac\"><span>r<sub>i</sub> − r</span><span>(|r<sub>i</sub> − r|² + h²)<sup>3/2</sup></span></span>",
			"k = 0.5 (spring),  b = 0.15 (friction),  h = 0.25 (magnet depth)",
			"<span class=\"chaos-note\">each pixel is a release point, coloured by the magnet it ends over; darker = longer wander</span>"
		]
	};

	const physics = { PARAMS, MAGNETS, accel, rk4, settle, energy, nearest };
	root.ChaosSimulations = root.ChaosSimulations || {};
	root.ChaosSimulations.basins = Basins;
	root.MagneticPendulum = physics;
	if (typeof module !== "undefined") module.exports = physics;
})(typeof window !== "undefined" ? window : globalThis);
