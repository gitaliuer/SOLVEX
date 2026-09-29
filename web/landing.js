"use strict";

(() => {
  const examples = {
    retail: "«В магазине растут списания.\nС чего начать?»",
    education: "«Запись на консультации — хаос.\nКак сделать проще?»",
    service: "«Заявки теряются в переписках.\nКак собрать всё вместе?»"
  };
  document.querySelectorAll("[data-scenario]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-scenario]").forEach(item =>
        item.setAttribute("aria-pressed", String(item === button)));
      document.getElementById("scenario-text").textContent = examples[button.dataset.scenario];
    });
  });

  // A small native canvas scene; no animation framework, textures or remote assets.
  const canvas = document.getElementById("connection-orb"), ctx = canvas.getContext("2d");
  if (!ctx) return;
  const area = canvas.parentElement, reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pause = document.createElement("button");
  pause.className = "motion-toggle"; pause.type = "button"; pause.textContent = "Ⅱ";
  area.append(pause);
  let paused = reduced.matches, w = 0, h = 0, frame = 0, last = 0, angle = .45;
  let targetX = 0, targetY = 0, tiltX = 0, tiltY = 0;
  const points = Array.from({length:180}, (_, i) => {
    const y = 1 - (i + .5) * 2 / 180, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  function updatePause() {
    pause.setAttribute("aria-label", paused ? "Включить анимацию" : "Остановить анимацию");
    pause.setAttribute("aria-pressed", String(paused));
    pause.textContent = paused ? "▷" : "Ⅱ";
    area.classList.toggle("motion-paused", paused);
  }
  function project(x,y,z) {
    const a = angle + tiltX, yy = y * Math.cos(.35 + tiltY) - z * Math.sin(.35 + tiltY);
    const zz = y * Math.sin(.35 + tiltY) + z * Math.cos(.35 + tiltY);
    const xx = x * Math.cos(a) + zz * Math.sin(a), depth = -x * Math.sin(a) + zz * Math.cos(a);
    const xr = xx * Math.cos(-.35) - yy * Math.sin(-.35);
    const yr = xx * Math.sin(-.35) + yy * Math.cos(-.35);
    const size = Math.min(w,h) * .28, perspective = 3.6 / (3.6 - depth);
    return [w*.50 + xr*size*perspective, h*.49 + yr*size*perspective, depth];
  }
  function curve(samples, color, width= .6) {
    ctx.beginPath();
    samples.forEach((point, i) => { const p = project(...point); if (i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function draw() {
    ctx.clearRect(0,0,w,h);
    const cx=w*.50, cy=h*.49, r=Math.min(w,h)*.3;
    const glow = ctx.createRadialGradient(cx-r*.4,cy+r*.15,0,cx,cy,r*1.7);
    glow.addColorStop(0,"#7149db27"); glow.addColorStop(.55,"#6741d11a"); glow.addColorStop(1,"#6741d100");
    ctx.fillStyle=glow; ctx.fillRect(0,0,w,h);
    for(let j=1;j<12;j++) {
      const phi=Math.PI*j/12, y=Math.cos(phi), radius=Math.sin(phi);
      curve(Array.from({length:97},(_,i)=>[Math.cos(i*Math.PI/48)*radius,y,Math.sin(i*Math.PI/48)*radius]),"rgba(136,109,237,.15)");
    }
    for(let j=0;j<16;j++) {
      const theta=j*Math.PI/8;
      curve(Array.from({length:97},(_,i)=>[Math.sin(i*Math.PI/48)*Math.cos(theta),Math.cos(i*Math.PI/48),Math.sin(i*Math.PI/48)*Math.sin(theta)]),"rgba(128,106,228,.18)");
    }
    for(let j=0;j<3;j++) {
      const tilt = j*.8+.2;
      const orbit=Array.from({length:129},(_,i)=>{
        const a=i*Math.PI/64, x=Math.cos(a)*1.33, y=Math.sin(a)*1.33;
        return [x,y*Math.cos(tilt),y*Math.sin(tilt)];
      });
      curve(orbit,j===1?"rgba(66,201,201,.22)":"rgba(139,112,241,.24)",.8);
      const a = angle*(j+1)*.8+j*2;
      const p=project(Math.cos(a)*1.33,Math.sin(a)*1.33*Math.cos(tilt),Math.sin(a)*1.33*Math.sin(tilt));
      ctx.shadowBlur=16;ctx.shadowColor=j===1?"#45d9d0":"#ab85ff";
      ctx.fillStyle=ctx.shadowColor;ctx.beginPath();ctx.arc(p[0],p[1],3.4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
    const projected=points.map(p=>project(...p)).sort((a,b)=>a[2]-b[2]);
    projected.forEach((p,i)=>{
      ctx.fillStyle=i%9===0 ? "rgba(89,220,212,"+(.35+(p[2]+1)*.25)+")" : "rgba(169,140,255,"+(.13+(p[2]+1)*.28)+")";
      ctx.beginPath();ctx.arc(p[0],p[1],p[2]>.3?1.65:.8,0,Math.PI*2);ctx.fill();
    });
    const nodes=[project(.15,-.15,.98),project(-.6,.55,.5),project(.6,.35,.6),project(-.3,-.75,.5)];
    ctx.strokeStyle="#9a7ff24a";ctx.lineWidth=.8;
    nodes.slice(1).forEach(p=>{ctx.beginPath();ctx.moveTo(nodes[0][0],nodes[0][1]);ctx.lineTo(p[0],p[1]);ctx.stroke();});
    nodes.forEach((p,i)=>{ctx.shadowBlur=18;ctx.shadowColor=i===0?"#caa7ff":"#57d6d4";ctx.fillStyle=ctx.shadowColor;ctx.beginPath();ctx.arc(p[0],p[1],i===0?4:2.5,0,Math.PI*2);ctx.fill();});ctx.shadowBlur=0;
  }
  function tick(time) {
    frame=0;
    if (document.hidden || paused) return;
    if (time-last>30) {angle+=Math.min(time-last,60)*.00007;tiltX+=(targetX-tiltX)*.03;tiltY+=(targetY-tiltY)*.03;draw();last=time;}
    frame=requestAnimationFrame(tick);
  }
  function start(){if(!frame&&!paused&&!document.hidden){last=performance.now();frame=requestAnimationFrame(tick);}}
  function resize(){
    const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
    w=rect.width;h=rect.height;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);draw();start();
  }
  pause.addEventListener("click",()=>{paused=!paused;updatePause();if(paused){cancelAnimationFrame(frame);frame=0;}else start();});
  reduced.addEventListener("change",()=>{paused=reduced.matches;updatePause();if(paused){cancelAnimationFrame(frame);frame=0;draw();}else start();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else start();});
  area.addEventListener("pointermove",event=>{const rect=area.getBoundingClientRect();targetX=(event.clientX-rect.left)/rect.width*.2-.1;targetY=(event.clientY-rect.top)/rect.height*.14-.07;});
  area.addEventListener("pointerleave",()=>{targetX=targetY=0;});
  new ResizeObserver(resize).observe(area);
  updatePause();resize();
})();
