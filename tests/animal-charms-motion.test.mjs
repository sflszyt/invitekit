import test from 'node:test';
import assert from 'node:assert/strict';
import * as charms from '../public/animal-charms.js';

const bounds = { left: 0, top: 0, right: 400, bottom: 300 };
const pet = (x, y, vx, vy, extra = {}) => ({ x, y, vx, vy, size: 40, ...extra });
function advance(bodies, dt = 1 / 60, obstacles = [], area = bounds) {
  assert.equal(typeof charms.advanceCharms, 'function', 'continuous pet collision motion must exist');
  charms.advanceCharms(bodies, dt, area, obstacles);
}
const disjoint = (a, b) => Math.hypot(a.x + a.size/2 - b.x - b.size/2, a.y + a.size/2 - b.y - b.size/2) >= (a.size+b.size)/2 - 0.01;

test('pets travel at the same speed across frame rates instead of orbiting a slot', () => {
  for (const fps of [30, 60, 120]) {
    const a = pet(50, 50, 20, 10);
    for (let i = 0; i < fps * 2; i++) advance([a], 1/fps);
    assert.ok(Math.abs(a.x - 90) < .001);
    assert.ok(Math.abs(a.y - 70) < .001);
  }
});
test('viewport contact reflects velocity and keeps the whole portrait inside', () => {
  const a = pet(359.9, 259.9, 30, 20);
  advance([a]);
  assert.ok(a.vx < 0 && a.vy < 0);
  assert.ok(a.x <= 360 && a.y <= 260);
});
test('two approaching pets bounce apart without gaining energy', () => {
  const a = pet(100, 100, 24, 0), b = pet(140.1, 100, -24, 0);
  advance([a, b]);
  assert.ok(a.vx < 0 && b.vx > 0);
  assert.ok(disjoint(a, b));
  assert.ok(Math.abs(a.vx*a.vx + b.vx*b.vx - 1152) < .001);
});
test('pets reflect off protected text without passing into it', () => {
  const a = pet(59.9, 120, 30, 5);
  const text = { left: 100, right: 180, top: 80, bottom: 200 };
  advance([a], 1/30, [text]);
  assert.ok(a.x + 40 <= 100);
  assert.ok(a.vx < 0);
});
test('a focused pet stays still while an approaching pet rebounds', () => {
  const a = pet(100, 100, 24, 0, { fixed: true }), b = pet(140.1, 100, -24, 0);
  advance([a, b]);
  assert.equal(a.x, 100);
  assert.equal(a.y, 100);
  assert.ok(b.vx > 0);
  assert.ok(disjoint(a, b));
});
test('a delayed frame cannot teleport a pet across the page', () => {
  const a = pet(50, 50, 20, 0);
  advance([a], 30);
  assert.ok(a.x > 50 && a.x <= 51);
});
test('clustered pets remain bounded, separate and finite after repeated contacts', () => {
  const pets = [pet(20, 30, 25, 12), pet(65, 30, -20, 15), pet(40, 72, 10, -24)];
  for (let i=0;i<1200;i++) {
    advance(pets, 1/60, [], { left: 0, top: 0, right: 150, bottom: 150 });
    for (const p of pets) assert.ok(Number.isFinite(p.x+p.y+p.vx+p.vy) && p.x>=0 && p.y>=0 && p.x<=110 && p.y<=110);
    for (let a=0;a<3;a++) for(let b=a+1;b<3;b++) assert.ok(disjoint(pets[a], pets[b]), `overlap on frame ${i}`);
  }
});

test('wall rebound uses the remaining travel time and briefly speeds up', () => {
  const a = pet(359.99, 80, 15, 0);
  advance([a], 1/120);
  assert.ok(a.x < 359.9, 'continue away from contact within the same substep');
  assert.ok(a.vx < -18 && a.vx > -26, 'a modest capped rebound kick');
  const reboundSpeed = Math.abs(a.vx);
  for (let i=0;i<120;i++) advance([a]);
  assert.ok(Math.abs(a.vx) < reboundSpeed && Math.abs(a.vx) >= 15, 'settle smoothly back to cruising speed');
});

test('protected content rebounds keep moving away on the contact frame', () => {
  const a = pet(59.99, 120, 15, 0);
  advance([a], 1/120, [{left:100,right:180,top:80,bottom:200}]);
  assert.ok(a.x < 59.9 && a.vx < -18);
});

test('one colliding pair does not stop an unrelated pet', () => {
  const a = pet(100, 100, 24, 0), b = pet(140.1, 100, -24, 0), c = pet(50, 200, 20, 0);
  advance([a,b,c], 1/120);
  assert.ok(Math.abs(c.x-50.1666666667)<1e-6, 'the third pet keeps its uninterrupted trajectory');
});

test('repeated wall contacts stay capped and leave a narrow corridor smoothly', () => {
  const a=pet(9.99, 20, 15, 0);
  const narrow={left:0,top:0,right:50,bottom:100};
  let stillFrames=0;
  for(let i=0;i<600;i++){
    const x=a.x;advance([a],1/60,[],narrow);
    if(Math.abs(a.x-x)<.0001)stillFrames++;
    assert.ok(a.x>=0&&a.x<=10);
    assert.ok(Math.abs(a.vx)<=26);
  }
  assert.equal(stillFrames,0,'contact must not discard a whole frame of movement');
});

test('a boosted pet cannot leave its neighbour speeding indefinitely or stopped', () => {
  const a=pet(100,100,22.5,0,{cruiseSpeed:15,rebounding:true});
  const b=pet(140.01,100,0,15,{cruiseSpeed:15});
  advance([a,b],1/120);
  const speed=p=>Math.hypot(p.vx,p.vy);
  assert.ok(speed(b)<=22.5+1e-6,'transferred boost respects the same rebound cap');
  assert.ok(speed(a)>=15-1e-6,'the donor keeps drifting after contact');
  const peak=speed(b);
  for(let frame=0;frame<60;frame++)advance([a,b]);
  assert.ok(speed(b)<peak&&speed(b)>=15-1e-6,'transferred boost also settles to cruise');
});
