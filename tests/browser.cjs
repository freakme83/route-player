// Real MapLibre 5.6.1 + native mouse/wheel events; fixture-only network traffic.
// See QA.md for setup. No production hooks or build step are needed.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  let executablePath=process.env.CHROMIUM_PATH;
  let args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const browser=await chromium.launch({headless:true,executablePath,args});
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const getAsset=async(env,url)=>process.env[env]?fs.readFileSync(process.env[env]):Buffer.from(await (await fetch(url)).arrayBuffer());
    const js=await getAsset('MAPLIBRE_JS','https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js');
    const css=await getAsset('MAPLIBRE_CSS','https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css');
    const html=fs.readFileSync(path.join(__dirname,'../index.html'));
    const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACvElEQVR4nO3TMQEAIAzAMED5pCNjRxMFfXrnQNfbDoBNBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxA2gfEPAKAiZTlsQAAAABJRU5ErkJggg==','base64');
    await page.route('**/*',async r=>{
      const url=r.request().url();
      if(url==='http://route-player.test/') return r.fulfill({contentType:'text/html',body:html});
      if(url.endsWith('maplibre-gl.js'))return r.fulfill({contentType:'application/javascript',body:js});
      if(url.endsWith('maplibre-gl.css'))return r.fulfill({contentType:'text/css',body:css});
      if(url.includes('/styles/liberty'))return r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#b9c7b2'}}]}});
      if(url.includes('terrarium'))return r.fulfill({contentType:'image/png',body:tile});
      return r.abort();
    });
    await page.goto('http://route-player.test/');
    await page.waitForFunction(()=>typeof styleReady!=='undefined'&&styleReady);
    await page.evaluate(()=>{
      map.setPixelRatio(.25);
      // Software WebGL in CI cannot reliably render the terrain picking pass.
      // Opt in to full terrain on a hardware-backed browser via TEST_TERRAIN=1.
    });
    if(!process.env.TEST_TERRAIN) await page.evaluate(()=>{map.setTerrain(null);map.removeLayer('hillshade');});
    const input=async(id,value)=>page.locator('#'+id).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    const state=()=>page.evaluate(()=>({progress:playback.progress,playing:playback.playing,mode,bearing:map.getBearing(),pitch:map.getPitch(),zoom:map.getZoom(),center:map.getCenter().toArray()}));
    const camera=mode=>page.selectOption('#camera',mode);
    const delay=ms=>page.waitForTimeout(ms);
    const gpx='<gpx><trk><trkseg>'+Array.from({length:101},(_,i)=>`<trkpt lat="${45+i*.002}" lon="${24+i*.003}"><ele>${400+i}</ele></trkpt>`).join('')+'</trkseg></trk></gpx>';
    await page.setInputFiles('#gpxFile',{name:'route.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpx)});
    await page.waitForFunction(()=>routeReady);
    assert.deepEqual(errors,[],'startup/file load errors');console.log('PASS: startup, GPX load');
    // All requested speed steps, real RAF clock; exact ratios covered by unit tests.
    await page.click('#play');console.log('Playback started');
    for(const speed of [100,50,20,100]){await input('speed',speed);const p=(await state()).progress;await delay(200);assert.ok((await state()).progress>p);console.log('Speed',speed);}
    await page.click('#play');await input('speed',20);await camera('manualFollow');await input('bearing',73);await input('pitch',50);await input('zoom',10);
    const paused=await state();await delay(100);assert.equal((await state()).progress,paused.progress);await page.click('#play');await delay(100);
    let s=await state();assert.ok(Math.abs(s.bearing-73)<.01);assert.ok(Math.abs(s.pitch-50)<.01);assert.ok(Math.abs(s.zoom-10)<.01);
    // Follow must not repeatedly stop the actual drag handler.
    await page.evaluate(()=>{window.cameraCalls=[];const original=map.jumpTo;map.jumpTo=function(o,...rest){window.cameraCalls.push(o);return original.call(this,o,...rest);};});
    console.log('PASS: speed and resume');const before=await state();await page.mouse.move(1000,450);await page.mouse.down({button:'right'});
    for(let i=1;i<=12;i++){await page.mouse.move(1000+i*8,450+i*4);await delay(25);}
    const during=await state();assert.ok(Math.abs(during.bearing-before.bearing)>5,'native rotate changes bearing');assert.ok(Math.abs(during.pitch-before.pitch)>1,'native drag changes pitch');assert.ok(during.progress>before.progress);
    await page.mouse.up({button:'right'});await delay(400);
    const calls=await page.evaluate(()=>window.cameraCalls);assert.ok(calls.every(o=>Object.keys(o).every(k=>k==='center')),'manual follow sends center only');
    s=await state();assert.equal(Number(await page.locator('#bearing').inputValue()),Math.round((s.bearing+360)%360)%360);
    console.log('PASS: native rotation/pitch');const zoomBefore=s.zoom;await page.mouse.wheel(0,-300);await delay(500);assert.ok((await state()).zoom>zoomBefore,'wheel zoom survives playback');
    console.log('PASS: wheel zoom');
    await page.mouse.move(1000,500);await page.mouse.down();await page.mouse.move(850,550,{steps:8});await page.mouse.up();await delay(1000);
    assert.ok(await page.evaluate(()=>{const p=map.project(marker.getLngLat());return Math.hypot(p.x-map.getCanvas().clientWidth/2,p.y-map.getCanvas().clientHeight/2)<2;}),'manual follow reacquires center after pan');
    const navZoom=(await state()).zoom;await page.click('.maplibregl-ctrl-zoom-in');await delay(500);assert.ok((await state()).zoom>navZoom,'navigation zoom works while following');
    await page.click('.maplibregl-ctrl-compass');await page.waitForFunction(()=>Math.abs(map.getBearing())<.1);assert.ok(Math.abs((await state()).bearing)<.1,'compass works while following');
    await camera('free');await page.evaluate(()=>{window.cameraCalls=[];});
    const freeBefore=await state();await page.mouse.move(1000,500);await page.mouse.down();await page.mouse.move(700,700,{steps:15});await page.mouse.up();await delay(600);const free=await state();await delay(250);s=await state();assert.ok(s.progress>freeBefore.progress);assert.deepEqual(s.center,free.center);assert.equal((await page.evaluate(()=>window.cameraCalls)).length,0);
    for(const mode of ['north','route','manualFollow','free']){await camera(mode);await delay(100);assert.equal((await state()).playing,true);}
    await page.click('#play');await input('scrub',400);s=await state();assert.equal(s.progress,.4);assert.equal(s.playing,false);await page.click('#play');await input('scrub',600);await delay(100);assert.ok((await state()).progress>.6);
    await input('speed',0);const zero=await state();await delay(100);assert.equal((await state()).progress,zero.progress);await input('speed',50);assert.equal((await state()).playing,false);await page.click('#play');await page.waitForFunction(p=>playback.progress>p,zero.progress);
    await camera('manualFollow');await input('bearing',123);await input('pitch',45);await input('zoom',10.5);await delay(100);s=await state();assert.ok(Math.abs(s.bearing-123)<.01);assert.ok(Math.abs(s.pitch-45)<.01);assert.ok(Math.abs(s.zoom-10.5)<.01);
    await camera('overview');const overview=await state();await page.mouse.move(1000,500);await page.mouse.wheel(0,-500);await delay(300);s=await state();assert.ok(s.progress>overview.progress);assert.deepEqual(s.center,overview.center);assert.equal(s.zoom,overview.zoom);
    await camera('free');
    await page.setInputFiles('#gpxFile',{name:'second.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from('<g:gpx xmlns:g="urn:gpx"><g:rte><g:rtept lat="40" lon="26"/><g:rtept lat="40.1" lon="26.2"/></g:rte></g:gpx>')});
    await page.waitForFunction(()=>C.length===2);s=await state();assert.equal(s.playing,false);assert.equal(s.progress,0);assert.equal(await page.locator('.marker').count(),1);assert.equal(await page.locator('#minEle').innerText(),'—');
    assert.deepEqual(errors,[],'browser exceptions');
    console.log('PASS: real MapLibre upload, speed, resume, native rotation/pitch/wheel/pan, free camera, modes, scrubbing, zero rate, sliders, overview and namespaced rtept reload');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
