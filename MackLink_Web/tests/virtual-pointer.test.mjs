import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stickVector,VirtualCursor,WheelAccumulator,JOYSTICK_DEADZONE,JOYSTICK_MAX_SPEED,WHEEL_MAX} from '../lib/virtual-pointer.ts';

const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message??''} expected ${expected}, got ${actual}`);

test('a resting thumb inside the dead zone does not move the pointer',()=>{
 assert.deepEqual(stickVector(0,0,50),{x:0,y:0});
 assert.deepEqual(stickVector(50*JOYSTICK_DEADZONE,0,50),{x:0,y:0});
 for(const radius of [0,-1,Number.NaN])assert.deepEqual(stickVector(10,10,radius),{x:0,y:0});
 assert.deepEqual(stickVector(Number.POSITIVE_INFINITY,0,50),{x:0,y:0});
});

test('stick deflection keeps its direction and is capped at full tilt',()=>{
 const full=stickVector(0,-200,50);close(full.x,0);close(full.y,-1);
 const diagonal=stickVector(100,100,50);close(Math.hypot(diagonal.x,diagonal.y),1);close(diagonal.x,diagonal.y);
 const half=stickVector(50*(JOYSTICK_DEADZONE+(1-JOYSTICK_DEADZONE)/2),0,50);close(half.x,0.5);close(half.y,0);
});

test('full tilt crosses the configured share of the screen per second, in small steps',()=>{
 const cursor=new VirtualCursor();cursor.set(0,0.5);
 for(let i=0;i<20;i++)cursor.step({x:1,y:0},50,16/10);
 close(cursor.x,JOYSTICK_MAX_SPEED,'x');close(cursor.y,0.5,'y');
});

test('vertical movement is scaled by the screen aspect so pixels move at the same speed',()=>{
 const cursor=new VirtualCursor();cursor.set(0.5,0);
 for(let i=0;i<5;i++)cursor.step({x:0,y:1},50,1.6);
 close(cursor.y,JOYSTICK_MAX_SPEED*0.25*1.6);close(cursor.x,0.5);
});

test('small tilts are precise: half deflection moves a quarter as fast',()=>{
 const full=new VirtualCursor(),half=new VirtualCursor();full.set(0,0);half.set(0,0);
 full.step({x:1,y:0},40,1);half.step({x:0.5,y:0},40,1);
 close(half.x*4,full.x);
});

test('a late frame is clamped instead of jumping across the screen',()=>{
 const cursor=new VirtualCursor();cursor.set(0,0);
 cursor.step({x:1,y:0},5000,1);
 close(cursor.x,JOYSTICK_MAX_SPEED*0.05);
 assert.equal(cursor.step({x:1,y:0},0,1),false);
 assert.equal(cursor.step({x:1,y:0},16,0),false);
 assert.equal(cursor.step({x:0,y:0},16,1),false);
});

test('the pointer stays on screen and reports when an edge stops it',()=>{
 const cursor=new VirtualCursor();cursor.set(0.99,0.01);
 assert.equal(cursor.step({x:1,y:-1},50,1),true);
 assert.equal(cursor.x,1);assert.equal(cursor.y,0);
 assert.equal(cursor.step({x:1,y:-1},50,1),false);
 assert.equal(cursor.set(Number.NaN,0.5),false);
 assert.equal(cursor.set(-3,7),true);assert.deepEqual([cursor.x,cursor.y],[0,1]);
});

test('listeners hear moves and layout refreshes until they unsubscribe',()=>{
 const cursor=new VirtualCursor();let calls=0;
 const stop=cursor.subscribe(()=>calls++);
 cursor.set(0.2,0.3);cursor.set(0.2,0.3);cursor.changed();
 assert.equal(calls,2);
 stop();cursor.set(0.4,0.4);
 assert.equal(calls,2);
});

test('full tilt is 20% slower than the original 0.9 screen widths per second',()=>{
 close(JOYSTICK_MAX_SPEED,0.9*0.8);
});

test('the touch wheel sends whole pixels and keeps fractions for the next event',()=>{
 const wheel=new WheelAccumulator();
 assert.equal(wheel.take(),0);
 wheel.add(2.6);assert.equal(wheel.take(),2);
 wheel.add(0.6);assert.equal(wheel.take(),1);
 wheel.add(-3.4);assert.equal(wheel.take(),-3);
 assert.equal(wheel.take(),0);
});

test('a large wheel flick is split at the protocol limit, never dropped, and ignores bad input',()=>{
 const wheel=new WheelAccumulator();
 wheel.add(4500);
 assert.deepEqual([wheel.take(),wheel.take(),wheel.take(),wheel.take()],[WHEEL_MAX,WHEEL_MAX,500,0]);
 wheel.add(-2500);assert.equal(wheel.take(),-WHEEL_MAX);
 wheel.add(Number.NaN);wheel.add(Number.POSITIVE_INFINITY);assert.equal(wheel.take(),-500);
 wheel.add(30);wheel.reset();assert.equal(wheel.take(),0);
});
