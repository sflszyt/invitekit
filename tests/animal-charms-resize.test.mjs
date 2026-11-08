import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCharms, separateResizedCharms } from '../public/animal-charms.js';

const bounds={left:8,top:8,right:382,bottom:292};
function body(x,y,vx=16,vy=15){return{x,y,size:52,vx,vy,cruiseSpeed:Math.hypot(vx,vy)};}
function separated(bodies,arena=bounds){
  for(const a of bodies){assert.ok(a.x>=arena.left-1e-6&&a.y>=arena.top-1e-6&&a.x+a.size<=arena.right+1e-6&&a.y+a.size<=arena.bottom+1e-6);}
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)assert.ok(Math.hypot(bodies[i].x-bodies[j].x,bodies[i].y-bodies[j].y)>=52-1e-6);
}
test('keyboard resizing separates overlapping portraits so both keep moving',()=>{
  const bodies=[body(99.358815,73.592419),body(205.825614,142.834749,-15,16),body(182.057652,179.691382,13,-18)];
  const original=bodies.map(b=>({...b}));
  separateResizedCharms(bodies,bounds);separated(bodies);
  assert.equal(bodies[0].x,original[0].x);assert.equal(bodies[0].y,original[0].y);
  for(let i=1;i<3;i++)assert.ok(Math.hypot(bodies[i].x-original[i].x,bodies[i].y-original[i].y)<5);
  const before=bodies.map(b=>({...b}));
  for(let frame=0;frame<120;frame++)advanceCharms(bodies,1/60,bounds,[]);
  separated(bodies);for(let i=0;i<3;i++)assert.ok(Math.hypot(bodies[i].x-before[i].x,bodies[i].y-before[i].y)>10);
});
test('resize separation respects corners and narrow arenas without altering velocity',()=>{
  for(const arena of [bounds,{left:8,top:8,right:90,bottom:360}]){
    const bodies=[body(8,8),body(8,8),body(8,8)];
    separateResizedCharms(bodies,arena);separated(bodies,arena);
    for(const b of bodies){assert.equal(b.vx,16);assert.equal(b.vy,15);}
  }
});
test('already separated portraits keep exactly the same coordinates on resize',()=>{
  const bodies=[body(20,20),body(150,150),body(275,220)],original=structuredClone(bodies);
  separateResizedCharms(bodies,bounds);assert.deepEqual(bodies,original);
});
