// Physics checks for the magnetic pendulum and its basin maps. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mp = require("../simulations/magnetic-pendulum.js");
const { PARAMS, MAGNETS, rk4, settle, energy } = mp;

// deterministic pseudo-random release points in the rendered square
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const points = Array.from({ length: 300 }, () => [5 * rand() - 2.5, 5 * rand() - 2.5]);

test("friction only ever removes energy", () => {
	const s = new Float64Array([1.7, -1.2, 0, 0]);
	let e = energy(s);
	for (let n = 0; n < 3000; n++) {
		rk4(s, PARAMS.dt, PARAMS);
		const e2 = energy(s);
		assert.ok(e2 <= e + 1e-9, `energy rose from ${e} to ${e2} at step ${n}`);
		e = e2;
	}
});

test("released right above a magnet, it stays with that magnet", () => {
	MAGNETS.forEach(([x, y], i) => assert.strictEqual(settle(x * 0.95, y * 0.95).magnet, i));
});

test("the basins share the magnets' three-fold symmetry", () => {
	const c = Math.cos(2 * Math.PI / 3), s = Math.sin(2 * Math.PI / 3);
	let same = 0;
	for (const [x, y] of points) {
		const m = settle(x, y).magnet, m2 = settle(c * x - s * y, s * x + c * y).magnet;
		if (m2 === (m + 1) % 3) same++;
	}
	// release points on fractal boundaries may flip on rounding error alone; nearly all must agree
	assert.ok(same / points.length > 0.95, `${same}/${points.length} symmetric`);
});

test("basin map converges: halving the time step changes almost no outcomes", () => {
	const fine = { ...PARAMS, dt: PARAMS.dt / 2 };
	let same = 0;
	for (const [x, y] of points) if (settle(x, y).magnet === settle(x, y, fine).magnet) same++;
	assert.ok(same / points.length > 0.95, `${same}/${points.length} agree`);
});

test("the shipped release pair really ends on different magnets", () => {
	const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "basins.json"), "utf8"));
	assert.deepStrictEqual(meta.params, PARAMS, "maps were rendered with different parameters: re-run tools/render-basins.js");
	for (const v of meta.views) {
		const [[xa, ya, ma], [xb, yb, mb]] = v.pair;
		assert.notStrictEqual(ma, mb);
		assert.strictEqual(settle(xa, ya).magnet, ma);
		assert.strictEqual(settle(xb, yb).magnet, mb);
		assert.ok(Math.abs(xb - xa) <= v.half / 4, "pair should be close together in its view");
	}
});
