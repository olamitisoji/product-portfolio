const header=document.querySelector('.site-header');
const menuButton=document.querySelector('.menu-toggle');
const navigation=document.querySelector('#main-nav');
function closeMenu(){menuButton?.setAttribute('aria-expanded','false');if(navigation)navigation.hidden=true;}
menuButton?.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';menuButton.setAttribute('aria-expanded',String(open));navigation.hidden=!open;});
navigation?.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('click',event=>{if(header&&!header.contains(event.target))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menuButton?.getAttribute('aria-expanded')==='true'){closeMenu();menuButton.focus();}});
const hero=document.querySelector('.hero');
if(hero){new IntersectionObserver(([entry])=>header?.classList.toggle('is-scrolled',!entry.isIntersecting),{rootMargin:'-70px 0px 0px 0px'}).observe(hero);}

const filterButtons=document.querySelectorAll('[data-filter]');
const projects=document.querySelectorAll('[data-category]');
filterButtons.forEach(button=>button.addEventListener('click',()=>{
 const filter=button.dataset.filter;let visible=0;
 filterButtons.forEach(item=>{const selected=item===button;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});
 projects.forEach(project=>{const show=filter==='all'||project.dataset.category===filter;project.hidden=!show;if(show)visible++;});
 ['.project-grid','.experience-projects'].forEach(selector=>{const group=document.querySelector(selector);if(group)group.hidden=!Array.from(group.children).some(child=>!child.hidden);});
 const count=document.querySelector('#work-count');if(count)count.textContent=`${visible} projects`;
}));
const copyButton=document.querySelector('.copy-email');
copyButton?.addEventListener('click',async()=>{const status=document.querySelector('.copy-status');try{await navigator.clipboard.writeText(copyButton.dataset.email);status.textContent='Email copied.';}catch{status.textContent=`Copy this address: ${copyButton.dataset.email}`;}});

// An original particle entrance becomes a continuous, flowing field of line segments.
const canvas=document.querySelector('#signal-field');
if(canvas && canvas.getContext('2d')){
 const ctx=canvas.getContext('2d');
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const topics=[...document.querySelectorAll('.hero-topics span')];
 let topicOrigins=[];
 const content=[...document.querySelector('.hero-content').children];
 let width=0,height=0,frame=0,last=0,time=motion.matches?3:0,visible=true,paused=motion.matches;
 const clamp=value=>Math.max(0,Math.min(1,value));
 const ease=value=>1-Math.pow(1-clamp(value),3);
 const starts=[[.10,.22],[.72,.21],[.13,.63],[.73,.65]];
 function reveal(){
  content.forEach((element,index)=>{
   const progress=ease((time-.65-index*.16)/1.05);
   element.style.opacity=String(progress);
   element.style.transform=`translateY(${(1-progress)*32}px)`;
  });
  topics.forEach((element,index)=>{
   const progress=ease((time-.55-index*.10)/2.2);
   const origin=topicOrigins[index]||[0,0];
   element.style.transform=`translate(${origin[0]*(1-progress)}px,${origin[1]*(1-progress)}px)`;
  });
 }
 function draw(){
  if(!width||!height)return;
  ctx.clearRect(0,0,width,height);
  const entrance=ease(time/2.4),scatter=1-entrance;
  const spacing=width<600?17:16;
  ctx.strokeStyle='#e5edff';ctx.lineWidth=.85;
  for(let x=8;x<width;x+=spacing){for(let y=8;y<height;y+=20){
   const nx=x/width,ny=y/height;
   const ridge=.46+.22*Math.sin(nx*7.5-time*.48);
   const second=.50+.31*Math.sin(nx*5.2+time*.32+2.4);
   const band=Math.exp(-Math.pow((ny-ridge)/.16,2));
   const crossing=.65*Math.exp(-Math.pow((ny-second)/.13,2));
   const pulse=.55+.45*Math.sin(nx*12-ny*7-time*1.3);
   const strength=Math.min(1,(band+crossing)*(.62+pulse*.38));
   if(strength<.06)continue;
   const seed=Math.sin(x*12.9898+y*78.233)*43758.5453;
   const noise=seed-Math.floor(seed);
   const px=x+Math.sin(ny*9+time*.65)*7+scatter*(noise-.5)*width*.7;
   const py=y+Math.cos(nx*8+time*.9)*10+scatter*Math.sin(seed)*height*.6;
   const center=1-.30*Math.exp(-Math.pow((nx-.5)/.3,2)-Math.pow((ny-.45)/.22,2));
   ctx.globalAlpha=(.11+strength*.58)*center*ease(time/.8);
   const length=(3+strength*13)*(.2+.8*entrance);
   ctx.beginPath();ctx.moveTo(px,py-length/2);ctx.lineTo(px,py+length/2);ctx.stroke();
  }}
  ctx.globalAlpha=1;reveal();
 }
 function stop(){cancelAnimationFrame(frame);frame=0;last=0;}
 function tick(stamp){
  if(paused||!visible||document.hidden){stop();return;}
  if(!last)last=stamp;
  const delta=(stamp-last)/1000;
  if(delta>=1/40){time+=Math.min(delta,.08);last=stamp;draw();}
  frame=requestAnimationFrame(tick);
 }
 function start(){if(!frame&&!paused&&visible&&!document.hidden){last=0;frame=requestAnimationFrame(tick);}}
 function resize(){
  width=canvas.clientWidth;height=canvas.clientHeight;
  const ratio=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const heroRect=hero.getBoundingClientRect();
  topicOrigins=topics.map((element,index)=>{
   element.style.transform='none';
   const rect=element.getBoundingClientRect();
   const x=Math.min(width-rect.width-24,Math.max(24,starts[index][0]*width));
   return [x-(rect.left-heroRect.left),starts[index][1]*height-(rect.top-heroRect.top)];
  });
  draw();
 }
 function setPaused(value){
  paused=value;
  // Pausing during the entrance must never leave essential content hidden.
  if(paused){stop();time=Math.max(time,3);draw();}else start();
 }
 motion.addEventListener('change',event=>setPaused(event.matches));
 new ResizeObserver(resize).observe(canvas);
 new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)start();else stop();}).observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else start();});
 resize();setPaused(paused);
}

const clocks=[...document.querySelectorAll('[data-time-zone]')].map(element=>({
 element,
 formatter:new Intl.DateTimeFormat('en-US',{timeZone:element.dataset.timeZone,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'})
}));
if(clocks.length){
 const updateClocks=()=>{const now=new Date();clocks.forEach(({element,formatter})=>{element.textContent=formatter.format(now);element.dateTime=now.toISOString();});};
 updateClocks();setInterval(updateClocks,1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateClocks();});
}
