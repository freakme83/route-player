// Dependency-free integration tests of the actual inline application script.
// MapLibre is a behavioral test double; real gesture/render checks are separate.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.split('<script>')[1].split('</script>')[0];
function app(){
  let now=0,id=0;const frames=new Map(),elements={};
  for(const [,name] of html.matchAll(/id="([^"]+)"/g)) elements[name]={id:name,value:'',textContent:'',style:{},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},replaceChildren(...v){this.children=v;}};
  const document={hidden:false,listeners:{},querySelectorAll:()=>Object.values(elements),createElement:()=>({}),createTextNode:t=>t,addEventListener(k,fn){this.listeners[k]=fn;}};
  class LngLat{constructor(lng,lat){this.lng=lng;this.lat=lat;}static convert(c){return Array.isArray(c)?new LngLat(...c):c;}}
  class MapMock{
    constructor(options){this.options=options;this.camera={center:LngLat.convert(options.center),bearing:options.bearing,pitch:options.pitch,zoom:options.zoom};this.events={};this.sources={};this.layers={};this.calls=[];this.moving=false;
      for(const key of ['dragPan','dragRotate','scrollZoom','boxZoom','doubleClickZoom','keyboard','touchZoomRotate','touchPitch']) this[key]={active:false,enabled:true,isActive(){return this.active;},enable(){this.enabled=true;},disable(){this.enabled=false;}};
    }
    on(k,fn){(this.events[k]??=[]).push(fn);}
    fire(k,e={}){for(const f of this.events[k]??[])f(e);}
    addControl(){}getBearing(){return this.camera.bearing;}getPitch(){return this.camera.pitch;}getZoom(){return this.camera.zoom;}getCenter(){return this.camera.center;}isMoving(){return this.moving;}
    stop(){this.moving=false;this.calls.push(['stop']);}
    jumpTo(o){this.stop();this.calls.push(['jumpTo',structuredClone(o)]);Object.assign(this.camera,o);this.camera.center=LngLat.convert(this.camera.center);this.fire('move');this.fire('moveend');}
    fitBounds(b,o){this.calls.push(['fitBounds']);this.jumpTo({...o,center:b.points[0],zoom:9});}
    easeTo(o){this.calls.push(['easeTo',o]);this.moving=true;}
    getSource(k){return this.sources[k];}getLayer(k){return this.layers[k];}
    addSource(k,v){assert.ok(!this.sources[k]);this.sources[k]={...v,setData(d){this.data=d;}};}
    addLayer(v){assert.ok(!this.layers[v.id]);this.layers[v.id]=v;}
    removeLayer(k){delete this.layers[k];}removeSource(k){assert.ok(!Object.values(this.layers).some(l=>l.source===k));delete this.sources[k];}
    setTerrain(){}getStyle(){return {layers:[]};}areTilesLoaded(){return false;}
  }
  const markers=[];
  class Marker{constructor(){this.removed=false;markers.push(this);}setLngLat(c){this.center=c;return this;}addTo(){return this;}remove(){this.removed=true;}}
  const context=vm.createContext({document,maplibregl:{Map:MapMock,LngLat,NavigationControl:class{},Marker,LngLatBounds:class{constructor(){this.points=[];}extend(c){this.points.push(c);}}},performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(script,context);
  const run=s=>vm.runInContext(s,context),map=run('map');
  function tick(ms){now+=ms;const pending=[...frames.values()];frames.clear();for(const f of pending)f(now);}
  const emit=(id,type,value)=>{if(value!==undefined)elements[id].value=String(value);return elements[id].listeners[type]({target:elements[id]});};
  const load=()=>{map.fire('style.load');run('replaceRoute({coords:[[10,40],[11,41],[12,40],[13,42]],elev:[10,20,30,40]})');};
  return {run,map,tick,emit,load,frames,markers,elements,document,setNow:v=>now=v};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('startup wires ALL controls (numeric speed must not shadow the DOM)',()=>{
  const a=app();for(const [id,event] of [['speed','input'],['camera','change'],['scrub','input'],['zoom','input'],['peak','click']])assert.equal(typeof a.elements[id].listeners[event],'function');
});
test('100 → 50 → 20 → 100 speed changes integrate independently of frames',()=>{
  const a=app();a.load();a.emit('play','click');
  for(const rate of [100,50,20,100]){a.emit('speed','input',rate);a.tick(1000);}
  near(a.run('playback.progress'),2.7/52);assert.equal(a.frames.size,1);
});
test('25% and 50% are exact ratios at 50fps, 10fps and long frames',()=>{
  function progress(rate,step){const a=app();a.load();a.emit('speed','input',rate);a.emit('play','click');for(let t=0;t<6000;t+=step)a.tick(step);return a.run('playback.progress');}
  const base=progress(100,100);near(progress(50,100),base/2);near(progress(25,1000),base/4);near(progress(100,20),base);
});
test('rate change between frames uses the old rate until the change',()=>{
  const a=app();a.load();a.emit('play','click');a.setNow(500);a.emit('speed','input',50);a.tick(500);near(a.run('playback.progress'),.75/52);
});
test('pause/resume preserves visible progress and actual unrounded orientation',()=>{
  const a=app();a.load();a.emit('camera','change','manualFollow');a.emit('play','click');a.tick(1000);a.emit('play','click');const p=a.run('playback.progress');
  a.map.jumpTo({bearing:73.456,pitch:47.123,zoom:12.789});a.tick(10000);near(a.run('playback.progress'),p);a.emit('play','click');near(a.run('playback.progress'),p);a.tick(1000);near(a.run('playback.progress'),p+1/52);
  assert.equal(a.map.getBearing(),73.456);assert.equal(a.map.getPitch(),47.123);assert.equal(a.map.getZoom(),12.789);
});
test('manual follow never stops active rotate/zoom gestures, hook anchors route',()=>{
  const a=app();a.load();a.emit('camera','change','manualFollow');a.emit('play','click');a.map.calls=[];
  a.map.dragRotate.active=true;a.map.moving=true;a.tick(1000);
  assert.equal(a.map.calls.length,0);const options=a.map.options.transformCameraUpdate();assert.deepEqual(Object.keys(options),['center']);assert.equal(typeof options.center.lng,'number');near(options.center.lng,a.run('sampleRoute().center[0]'));
});
test('pan yields through inertia then recenters with a finite catch-up',()=>{
  const a=app();a.load();a.emit('camera','change','manualFollow');a.emit('play','click');a.map.fire('dragstart',{originalEvent:{}});a.map.dragPan.active=true;a.map.calls=[];a.tick(1000);assert.equal(a.map.calls.length,0);assert.equal(Object.keys(a.map.options.transformCameraUpdate()).length,0);
  a.map.dragPan.active=false;a.map.moving=true;a.tick(1000);assert.equal(a.map.calls.length,0);a.map.moving=false;a.map.fire('moveend');a.tick(250);assert.ok(a.map.calls.some(c=>c[0]==='jumpTo'));near(a.map.getCenter().lng,a.run('sampleRoute().center[0]'));
});
test('free mode makes zero camera calls while progressing and scrubbing',()=>{
  const a=app();a.load();a.emit('camera','change','free');a.map.jumpTo({center:[-100,10],bearing:82,pitch:50,zoom:8});a.map.calls=[];
  a.emit('play','click');a.tick(1000);a.emit('scrub','input',600);a.tick(1000);assert.equal(a.map.calls.length,0);assert.equal(a.map.getCenter().lng,-100);assert.ok(a.run('playback.progress')>.6);
});
test('mode switching during playback preserves zoom/pitch; north owns only bearing',()=>{
  const a=app();a.load();a.map.jumpTo({zoom:12,pitch:42});a.emit('play','click');
  for(const mode of ['north','route','manualFollow','free']){a.emit('camera','change',mode);a.tick(100);assert.equal(a.map.getZoom(),12);assert.equal(a.map.getPitch(),42);assert.equal(a.run('playback.playing'),true);}
  assert.equal(a.map.calls.filter(c=>c[0]==='easeTo').length,0);
});
test('paused and playing scrubs rebase timing without changing play state',()=>{
  const a=app();a.load();a.emit('scrub','input',300);a.tick(3000);near(a.run('playback.progress'),.3);assert.equal(a.frames.size,0);
  a.emit('play','click');a.tick(1000);a.emit('scrub','input',600);near(a.run('playback.progress'),.6);a.tick(1000);near(a.run('playback.progress'),.6+1/52);assert.equal(a.frames.size,1);
});
test('0% pauses; restoring rate waits for explicit Play',()=>{
  const a=app();a.load();a.emit('play','click');a.tick(1000);a.emit('speed','input',0);const p=a.run('playback.progress');assert.equal(a.frames.size,0);a.tick(5000);a.emit('speed','input',50);a.tick(5000);near(a.run('playback.progress'),p);a.emit('play','click');a.tick(1000);near(a.run('playback.progress'),p+.5/52);
});
test('camera UI reads map; slider edits do not round-trip rounded values',()=>{
  const a=app();a.load();a.map.jumpTo({bearing:-.2,pitch:51.37,zoom:13.24});assert.equal(a.elements.bearing.value,0);assert.equal(a.elements.zoom.textContent,'');assert.equal(a.elements.zoomText.textContent,'13.2');
  a.emit('bearing','input',124);assert.equal(a.run('mode'),'manualFollow');a.emit('pitch','input',60);a.emit('zoom','input',14.5);assert.equal(a.map.getBearing(),124);assert.equal(a.map.getPitch(),60);assert.equal(a.map.getZoom(),14.5);
});
test('second route removes old layers/marker/RAF and replaces all metadata',()=>{
  const a=app();a.load();const listeners=Object.fromEntries(Object.entries(a.map.events).map(([k,v])=>[k,v.length]));a.emit('play','click');a.tick(1000);
  a.run('replaceRoute({coords:[[20,30],[21,31]],elev:[null,null]})');assert.equal(a.markers.length,2);assert.equal(a.markers[0].removed,true);assert.equal(a.frames.size,0);near(a.run('playback.progress'),0);assert.equal(a.elements.minEle.textContent,'—');assert.equal(a.elements.peak.disabled,true);assert.equal(a.map.getSource('route').data.geometry.coordinates[0][0],20);assert.deepEqual(Object.fromEntries(Object.entries(a.map.events).map(([k,v])=>[k,v.length])),listeners);
});
test('overview fits once and locks gestures/camera while route advances',()=>{
  const a=app();a.load();a.emit('camera','change','overview');const fixed=JSON.stringify(a.map.camera);a.map.calls=[];a.emit('play','click');a.tick(1000);a.emit('scrub','input',700);assert.equal(a.map.calls.length,0);assert.equal(JSON.stringify(a.map.camera),fixed);assert.equal(a.map.dragPan.enabled,false);assert.equal(a.elements.zoom.disabled,true);assert.equal(Object.keys(a.map.options.transformCameraUpdate()).length,4);a.emit('camera','change','free');assert.equal(a.map.dragPan.enabled,true);
});
test('tiles still loading do not gate playback; early mode changes are safe',()=>{
  const a=app();for(const mode of ['north','route','manualFollow','free','overview'])a.emit('camera','change',mode);a.load();assert.equal(a.elements.play.disabled,false);a.emit('play','click');a.tick(1000);assert.ok(a.run('playback.progress')>0);
});
test('interpolated marker and progress line share exact endpoint at start/middle/end',()=>{
  const a=app();a.load();for(const u of [0,.123,1]){a.run(`playback.progress=${u};renderProgress()`);const end=a.map.getSource('prog').data.geometry.coordinates.at(-1);assert.deepEqual(end,a.markers[0].center);}a.emit('play','click');near(a.run('playback.progress'),0);
});
test('completion and hidden-tab pause leave no stale playback RAF',()=>{
  const a=app();a.load();a.emit('play','click');a.tick(52000);near(a.run('playback.progress'),1);assert.equal(a.frames.size,0);a.emit('play','click');a.document.hidden=true;a.document.listeners.visibilitychange();assert.equal(a.frames.size,0);assert.equal(a.run('playback.playing'),false);
});
test('async file race: newest selection wins; invalid replacement preserves valid route',async()=>{
  const a=app();a.load();a.run("parseGPX=text=>{if(text==='bad')throw Error('invalid');return {coords:[[Number(text),30],[31,31]],elev:[1,2]}};");
  let resolve;a.elements.gpxFile.files=[{text:()=>new Promise(r=>resolve=r)}];const first=a.emit('gpxFile','change');a.elements.gpxFile.files=[{text:async()=> '22'}];await a.emit('gpxFile','change');resolve('11');await first;assert.equal(a.run('C[0][0]'),22);
  a.elements.gpxFile.files=[{text:async()=> 'bad'}];await a.emit('gpxFile','change');assert.equal(a.run('routeReady'),true);assert.equal(a.run('C[0][0]'),22);assert.equal(a.elements.rstat.textContent,'invalid');
});
test('GPX parsed before style readiness installs once style arrives',async()=>{
  const a=app();a.run('parseGPX=()=>({coords:[[20,30],[21,31]],elev:[1,2]})');a.elements.gpxFile.files=[{text:async()=>''}];await a.emit('gpxFile','change');assert.equal(a.run('routeReady'),false);a.map.fire('style.load');assert.equal(a.run('routeReady'),true);assert.equal(a.markers.length,1);
});


test('unequal segment lengths consume playback time in distance proportion',()=>{
  const a=app();a.run("replaceRoute({coords:[[0,0],[1,0],[1,3]],elev:[0,100,200]})");
  const first=a.run('segmentDistances[0]'),second=a.run('segmentDistances[1]');
  assert.ok(Math.abs(second/first-3)<0.002);
  a.run('playback.playing=true;playback.lastTs=0;advance(BASE_DURATION*.25)');
  const quarter=a.run('sampleRoute()');assert.equal(quarter.i,0);near(quarter.t,1);
  a.run('advance(BASE_DURATION*.5)');
  const half=a.run('sampleRoute()');assert.equal(half.i,1);near(half.t,1/3);near(half.center[1],1);
  near(a.run(`E[${half.i}]+(E[${half.i+1}]-E[${half.i}])*${half.t}`),400/3);
});
test('uneven GPX point density preserves constant geographic speed',()=>{
  const a=app();
  a.run(`(()=>{const coords=Array.from({length:101},(_,i)=>[i/100,0]);coords.push([2,0]);replaceRoute({coords,elev:coords.map((_,i)=>i)});})()`);
  assert.equal(a.run('C.length'),102);
  for(const u of [.1,.25,.5,.75,.9]){
    const sample=a.run(`sampleRoute(${u})`);
    const along=a.run(`cumulativeDistances[${sample.i}]+segmentDistances[${sample.i}]*${sample.t}`);
    near(along/u,a.run('totalDistance'));
  }
  near(a.run('sampleRoute(.5).center[0]'),1);
  assert.ok(Math.abs(a.run('sampleRoute(.5).center[0]')-.5)>.49,'index-based midpoint would be near longitude .5');
});
test('scrubbing to 50% follows half total distance and keeps line/marker aligned',()=>{
  const a=app();a.load();a.run("replaceRoute({coords:[[0,0],[1,0],[1,3]],elev:[0,100,200]})");
  a.emit('scrub','input',500);
  const sample=a.run('sampleRoute()'),lineEnd=a.map.getSource('prog').data.geometry.coordinates.at(-1);
  near(a.run(`cumulativeDistances[${sample.i}]+segmentDistances[${sample.i}]*${sample.t}`),a.run('totalDistance')/2);
  assert.deepEqual(lineEnd,a.markers.at(-1).center);assert.deepEqual(lineEnd,sample.center);assert.equal(a.run('playback.progress'),.5);
});
test('distance sampling handles duplicate points, endpoints and very short routes',()=>{
  const a=app();
  a.run("replaceRoute({coords:[[0,0],[0,0],[.001,0],[.001,0],[.002,0]],elev:[1,2,3,4,5]})");
  assert.equal(a.run('sampleRoute(0).center[0]'),0);assert.equal(a.run('sampleRoute(0).center[1]'),0);
  assert.equal(a.run('sampleRoute(1).center[0]'),.002);assert.equal(a.run('sampleRoute(1).center[1]'),0);
  for(const u of [0,.25,.5,.75,1]){
    const sample=a.run(`sampleRoute(${u})`);
    assert.ok(Number.isFinite(sample.t)&&sample.t>=0&&sample.t<=1);
    assert.ok(Number.isFinite(sample.center[0])&&Number.isFinite(sample.center[1]));
  }
  a.run("replaceRoute({coords:[[20,10],[20.00000001,10]],elev:[100,200]})");
  assert.ok(a.run('totalDistance>0&&totalDistance<.001'));
  assert.equal(a.run('sampleRoute(0).center[0]'),20);assert.equal(a.run('sampleRoute(0).center[1]'),10);
  assert.equal(a.run('sampleRoute(1).center[0]'),20.00000001);assert.equal(a.run('sampleRoute(1).center[1]'),10);
  a.run("replaceRoute({coords:[[5,5],[5,5],[5,5]],elev:[10,20,30]})");
  assert.equal(a.run('totalDistance'),0);
  assert.equal(a.run('sampleRoute(0).center[0]'),5);assert.equal(a.run('sampleRoute(0).center[1]'),5);
  assert.equal(a.run('sampleRoute(1).center[0]'),5);assert.equal(a.run('sampleRoute(1).center[1]'),5);
});
test('Heading Up uses distance-based look-ahead and is independent of point density',()=>{
  const a=app();
  a.run("replaceRoute({coords:[[0,0],[1,0],[1,1]],elev:[0,0,0]})");
  const sparse=a.run('headingAt(.4)');
  a.run("replaceRoute({coords:[[0,0],...Array.from({length:99},(_,i)=>[(i+1)/100,0]),[1,1]],elev:Array(101).fill(0)})");
  const dense=a.run('headingAt(.4)');
  assert.ok(Math.abs((((sparse-dense)+540)%360)-180)<0.1,`${sparse} vs ${dense}`);
  a.emit('camera','change','route');a.run('playback.progress=.4');
  near(a.run('followOptions().bearing'),dense);
});
