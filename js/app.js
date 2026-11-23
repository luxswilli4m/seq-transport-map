(async function () {
"use strict";
const BASE = new URL(".", location.href).href;
const DV=(()=>{const sc=[...document.scripts].find(x=>/js\/app\.js/.test(x.src));const m=sc&&sc.src.match(/[?&]v=(\d+)/);return m?"?v="+m[1]:""})();
const net = await (await fetch(BASE + "data/network.json"+DV)).json();
const DATA = net.data, ZONES = net.zones, BUSWAY = net.busway, BWS = net.bwStations, KIDS = net.kids || {};
const RELAY = "https://seq-transport-live.luc4swilli4ms.workers.dev";
const R = DATA.routes, ST = DATA.stops;

const ZCOL = {1:"#9B5DE5",2:"#2F86F5",3:"#2FBF5F",4:"#F28C1A",5:"#E53935",6:"#17B5D6",7:"#E8B800"};
const ZDESC = {1:"South Brisbane",2:"East Brisbane & Redlands",3:"North Brisbane, incl. inner north-west",4:"West Brisbane (not Ipswich)",5:"Ipswich & Springfield (500–539), Logan & Lockyer Valley (540–589)",6:"Sunshine Coast & Moreton Bay",7:"Gold Coast"};
const BWCOL = {N:"#A46BD6",SE:"#1FAE98",SP:"#1FAE98",E:"#D98A45"};
const BWNAME = {N:"Northern Busway",SE:"South East Busway",E:"Eastern Busway"};
const KIND = {bus:"Bus stop",busway:"Busway station",busstn:"Bus station",train:"Train station",ferry:"Ferry terminal",tram:"Tram stop"};
const THEME = {
  light:{flavor:"light",sprite:"light",dots:"#2b3442",chevLine:"#ffffff",zoneHalo:"#ffffff",zoneText:"#1b2433",casing:"#ffffff",stopStroke:"#ffffff",lblText:"#1b2433",lblHalo:"#ffffff",zoneFill:.26},
  dark:{flavor:"dark",sprite:"dark",dots:"#ffffff",chevLine:"#ffffff",zoneHalo:"#0b0f17",zoneText:"#ffffff",casing:"#0b0f17",stopStroke:"#0b0f17",lblText:"#ffffff",lblHalo:"#0b0f17",zoneFill:.33}
};
let theme = "light";
try { const t = localStorage.getItem("seqmap_theme"); if (t === "dark" || t === "light") theme = t; } catch (e) {}
document.body.classList.toggle("light", theme === "light");

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ll = p => [p[1], p[0]]; // [lat,lon] -> [lon,lat]
function dec(s){const p=[];let i=0,lat=0,lng=0;while(i<s.length){for(let k=0;k<2;k++){let sh=0,r=0,b;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32);const v=(r&1)?~(r>>1):(r>>1);if(k===0)lat+=v;else lng+=v}p.push([lng/1e5,lat/1e5])}return p}
const pathCache = new Map();
function path(ri, di){const k=ri+"_"+di;if(!pathCache.has(k))pathCache.set(k,dec(R[ri].d[di].p));return pathCache.get(k)}
const FC = f => ({type:"FeatureCollection",features:f});

// ---------- train lines (Translink T1–T6, assigned by route colour)
const TLINES=[["T1","Ipswich / Rosewood – Caboolture / Nambour","27855A"],["T2","Springfield Central – Kippa-Ring","6CC6E9"],["T3","Doomben – Roma Street","9B60A6"],["T4","Cleveland – Shorncliffe","4778B2"],["T5","Varsity Lakes – Brisbane Airport","FFC425"],["T6","Beenleigh – Ferny Grove","D53E45"]];
const TNAME=Object.fromEntries(TLINES.map(([t,n])=>[t,n])), TCOL={T1:"#2E9C69",T2:"#6DC7E9",T3:"#A769AB",T4:"#4E85C5",T5:"#FFC628",T6:"#EF474F"};
const lineOf={}, lineRoutes={};
// colours as shown on Translink's network map legend (the feed's route colours are only used to tell the lines apart)
// Brisbane Metro colours as on Translink's network map (the feed gives them the standard bus pink)
const MDISP={M1:["#7EC241","#0b1a05"],M2:["#5DBEB6","#06201e"]};R.forEach(r=>{if(MDISP[r.n]){r.c=MDISP[r.n][0];r.tc=MDISP[r.n][1]}if(/^rail replacement bus$/i.test(r.l||"")){r.c="#ea580c";r.tc="#ffffff"}});   // rail replacement buses: orange everywhere, as in the Rail replacement buses view
const TDISP={T1:"#2E9C69",T2:"#6DC7E9",T3:"#A769AB",T4:"#4E85C5",T5:"#FFC628",T6:"#EF474F"};
R.forEach((r,i)=>{if(r.t!=="train")return;const hit=TLINES.find(x=>("#"+x[2]).toLowerCase()===r.c.toLowerCase());const t=hit?hit[0]:"T1";lineOf[i]=[t];(lineRoutes[t]=lineRoutes[t]||[]).push(i);r.c=TDISP[t]});
const TKW={T1:/Ipswich|Rosewood|Caboolture|Nambour|Gympie|Brisbane City|Roma Street/,T2:/Springfield|Redcliffe|Kippa|Brisbane City|Roma Street/,T3:/Doomben|Brisbane City|Roma Street/,T4:/Cleveland|Shorncliffe|Brisbane City|Roma Street/,T5:/Varsity|Airport|Gold Coast|Brisbane City|Roma Street/,T6:/Beenleigh|Ferny Grove|Brisbane City|Roma Street/};
function ownLine(nm,i){const parts=R[i].l.split(/\s+-\s+/);return parts.length===2&&parts.every(x=>TKW[nm].test(x))&&!(parts[0]===parts[1]&&/Brisbane City/.test(parts[0]))}
// lines that really serve each station (from each line's own routes); through-running trains are labelled by these
const ownSt={};R.forEach((r,i)=>{if(r.t!=="train")return;const L=(lineOf[i]||[])[0];if(!L||!ownLine(L,i))return;r.d.forEach(d=>d.s.forEach(sid=>(ownSt[sid]=ownSt[sid]||new Set()).add(L)))});
function lineAt(i,sid){const base=(lineOf[i]||["T?"])[0];const o=ownSt[sid];if(!o||o.has(base))return base;return LINE_ORDER.find(L=>o.has(L))||base}
function lineMain(nm){let best=null,bl=-1;const all=lineRoutes[nm]||[];const own=all.filter(i=>ownLine(nm,i));for(const i of (own.length?own:all)){const sc=Math.max(...R[i].d.map(d=>d.s.length));if(sc>bl){bl=sc;best=i}}return best}
const LINE_ORDER=TLINES.map(x=>x[0]);
// ---------- route ordering: Metro first, then by number (NightLink beside its number), rail-replacement R last
function routeKey(n){n=String(n);const m=n.match(/\d+/);const num=m?+m[0]:1e6;const pre=n.replace(/\d.*$/,"").toUpperCase();
  const grp=pre==="M"?0:pre==="R"?2:1;return [grp,num,pre===""?0:pre==="N"?1:2,n]}
function cmpRoute(a,b){const A=routeKey(a),B=routeKey(b);for(let k=0;k<3;k++)if(A[k]!==B[k])return A[k]-B[k];return A[3].localeCompare(B[3])}

// ---------- map
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
function baseLayers(t){return basemaps.layers("protomaps", basemaps.namedFlavor(THEME[t].flavor), {lang:"en"})}
const map = new maplibregl.Map({
  container:"map",
  style:{version:8,glyphs:BASE+"assets/fonts/{fontstack}/{range}.pbf",sprite:BASE+"assets/sprites/v4/"+THEME[theme].sprite,
    sources:{protomaps:{type:"vector",url:"pmtiles://"+BASE+"tiles/seq.pmtiles",attribution:'Unofficial map · Contains Translink / Qld Government open data · © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>'}},
    layers:baseLayers(theme)},
  center:[153.03,-27.48],zoom:9.3,minZoom:7.5,maxZoom:18,maxBounds:[[151.4,-28.9],[154.3,-25.6]],attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false
});
map.touchZoomRotate.disableRotation();
// no + / − zoom buttons: pinch, scroll or double-tap to zoom
await new Promise(r=>map.on("load",r));
document.getElementById("loading").style.display="none";
const attribEl=document.querySelector(".maplibregl-ctrl-attrib");if(attribEl&&innerWidth<=640){attribEl.classList.remove("maplibregl-compact-show");attribEl.removeAttribute("open")}

// ---------- canvas-drawn images (chevron patterns, station rings, loop arrow)
function addCanvasImage(id,w,h,draw,ratio=2){if(map.hasImage(id))return;const c=document.createElement("canvas");c.width=w*ratio;c.height=h*ratio;const g=c.getContext("2d");g.scale(ratio,ratio);draw(g);map.addImage(id,g.getImageData(0,0,w*ratio,h*ratio),{pixelRatio:ratio})}
const patIds={};
function pattern(cols){const key=cols.join(",");if(patIds[key])return patIds[key];const id="pat"+Object.keys(patIds).length;patIds[key]=id;const n=cols.length,H=4*n;
  addCanvasImage(id,16,H,g=>{g.lineWidth=4.3;g.lineJoin="miter";for(let k=-3;k<n+4;k++){g.strokeStyle=cols[((k%n)+n)%n];const y=4*k+2;g.beginPath();g.moveTo(-8,y-14);g.lineTo(0,y-6);g.lineTo(8,y+2);g.lineTo(16,y-6);g.lineTo(24,y-14);g.stroke()}});return id}
function ringIcon(cols,road){const id="ring:"+cols.join("-")+(road?":r":"");addCanvasImage(id,24,24,g=>{
  g.fillStyle="#0b0f17";g.beginPath();g.arc(12,12,10.5,0,7);g.fill();
  const n=cols.length;cols.forEach((c,k)=>{g.strokeStyle=c;g.lineWidth=4.5;if(road)g.setLineDash([3.2,2.4]);g.beginPath();g.arc(12,12,7.6,-Math.PI/2+k*2*Math.PI/n,-Math.PI/2+(k+1)*2*Math.PI/n);g.stroke()});
  g.setLineDash([]);g.fillStyle="#ffffff";g.beginPath();g.arc(12,12,road?4.2:5,0,7);g.fill()},3);return id}
addCanvasImage("dirArrow",22,22,g=>{g.fillStyle="#ffffff";g.strokeStyle="#0b0f17";g.lineWidth=1.6;g.beginPath();g.arc(11,11,9.2,0,7);g.fill();g.stroke();g.strokeStyle="#0b0f17";g.lineWidth=2.6;g.lineCap="round";g.lineJoin="round";g.beginPath();g.moveTo(8.5,6.5);g.lineTo(13.5,11);g.lineTo(8.5,15.5);g.stroke()},3);
addCanvasImage("rbArrow",22,22,g=>{g.fillStyle="#ffffff";g.strokeStyle="#ea580c";g.lineWidth=2;g.beginPath();g.arc(11,11,9,0,7);g.fill();g.stroke();g.strokeStyle="#ea580c";g.lineWidth=2.8;g.lineCap="round";g.lineJoin="round";g.beginPath();g.moveTo(8.5,6.5);g.lineTo(13.5,11);g.lineTo(8.5,15.5);g.stroke()},3);
addCanvasImage("loopArrow",14,14,g=>{g.strokeStyle="#0b0f17";g.lineWidth=4;g.lineCap="round";g.beginPath();g.moveTo(4,3);g.lineTo(10,7);g.lineTo(4,11);g.stroke();g.strokeStyle="#ffffff";g.lineWidth=2.2;g.beginPath();g.moveTo(4,3);g.lineTo(10,7);g.lineTo(4,11);g.stroke()});

// ---------- sources
const routeOfStop = id => ST[id] ? ST[id][5] : [];
const zoneF = ZONES.zones.map(z=>({type:"Feature",properties:{c:ZCOL[z.s]},geometry:{type:"Polygon",coordinates:z.r.map(r=>r.map(ll))}}));
const chevF = ZONES.chev.map(c=>({type:"Feature",properties:{pat:pattern(c.c)},geometry:{type:"MultiPolygon",coordinates:[c.r.map(r=>{const q=r.map(ll);if(q.length&&(q[0][0]!==q[q.length-1][0]||q[0][1]!==q[q.length-1][1]))q.push(q[0]);return q})]}}));
// split rings into separate polygons for even-odd look: MapLibre uses nonzero per polygon; rings from contours may nest -> treat each ring as its own polygon with holes resolved by area sign
chevF.forEach(f=>{const rings=f.geometry.coordinates[0];const area=r=>{let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return a/2};let sg=1,mx=0;rings.forEach(r=>{const a=area(r);if(Math.abs(a)>mx){mx=Math.abs(a);sg=Math.sign(a)||1}});const outers=[],holes=[];rings.forEach(r=>(Math.sign(area(r))===sg?outers:holes).push(r));
  const pip=(pt,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))c=!c}return c};
  const big=outers, small=holes;
  f.geometry.coordinates=big.map(o=>[o,...small.filter(h=>pip(h[0],o))])});
const zoneLbl = (ZONES.labels||[]).map(l=>({type:"Feature",properties:{t:l.s+"xx"},geometry:{type:"Point",coordinates:ll(l.p)}}));
const dotF = ZONES.dots.map(d=>Array.isArray(d)?{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:d.map(ll)}}:{type:"Feature",properties:{r:d.r,d:d.d,v:d.v,n:`Route ${d.r}${d.v>=0?" (some trips only)":""} · tap for details`},geometry:{type:"LineString",coordinates:d.c.map(ll)}});
const loopF = ZONES.loop?[{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:ZONES.loop.map(ll)}}]:[];
const bwLineF = BUSWAY.pairs.map(([key,a,b,seg,road])=>({type:"Feature",properties:{c:(BUSWAY.colours&&BUSWAY.colours[key])||BWCOL[key],road:road?1:0},geometry:{type:"LineString",coordinates:seg.map(ll)}}));
const net2 = {train:[],ferry:[],tram:[]};const seen=new Set();
R.forEach((r,i)=>{if(r.t==="bus")return;if(r.t==="train"&&!ownLine((lineOf[i]||["T1"])[0],i))return;/* through-running trains share track already drawn by each line's own routes */r.d.forEach((d,di)=>{if(seen.has(d.p))return;seen.add(d.p);net2[r.t].push({type:"Feature",properties:{c:r.c},geometry:{type:"LineString",coordinates:path(i,di)}})})});
const shortName = n => n.replace(/ busway station$| bus station$| station$/i,"");
const bwc=k=>(BUSWAY.colours&&BUSWAY.colours[k])||BWCOL[k]||"#888";if(BUSWAY.names)Object.assign(BWNAME,BUSWAY.names);
const ptF = kind => Object.entries(ST).filter(([,s])=>s[3]===kind).map(([id,s])=>{const p={id,n:s[0],sn:shortName(s[0])};if(kind==="busway"){const b=BWS[id]||{b:["SE"],road:false};p.icon=ringIcon(b.b.map(bwc),b.road)}return {type:"Feature",properties:p,geometry:{type:"Point",coordinates:[s[2],s[1]]}}});

function src(id,data){map.addSource(id,{type:"geojson",data})}
src("zones",FC(zoneF));src("chev",FC(chevF));src("zlabels",FC(zoneLbl));src("dots",FC(dotF));src("loop",FC(loopF));
// ---------- train lines drawn side by side where they share track (like Translink's network map)
function stackTrains(){
  const KX=111.32*Math.cos(-27.5*Math.PI/180),KY=110.57,STEP=0.04,NEAR=0.13,CELL=0.13,SM=5;   // km; SM = samples of smoothing each side (~200 m)
  const ROMA=Object.values(ST).find(s=>s[3]==="train"&&/^Roma Street station/.test(s[0]));const C0=ROMA?[ROMA[2],ROMA[1]]:[153.019,-27.465];
  const km=(a,b)=>Math.hypot((a[0]-b[0])*KX,(a[1]-b[1])*KY);
  const resample=pts=>{const out=[pts[0]];let carry=0;for(let k=1;k<pts.length;k++){const a=pts[k-1],b=pts[k];const d=km(a,b);if(!d)continue;let t=STEP-carry;while(t<=d){out.push([a[0]+(b[0]-a[0])*t/d,a[1]+(b[1]-a[1])*t/d]);t+=STEP}carry=d-(t-STEP)}const last=pts[pts.length-1];if(km(out[out.length-1],last)>0.01)out.push(last);return out};
  // each line's own-route paths, split at Roma Street and oriented outbound from it; s = +1 for north/east halves, -1 for south/west
  // (so a line keeps the same physical side straight through Roma Street, and every line in a corridor agrees on direction)
  const L2=TLINES.map(x=>x[0]);const halves=[];const seenP=new Set();
  const bearing=(a,b)=>(Math.atan2((b[0]-a[0])*KX,(b[1]-a[1])*KY)*180/Math.PI+360)%360;
  const addHalf=(L,P)=>{if(P.length<8)return;   /* skip stubs under ~300 m (trips starting at Roma Street) */const end=P[P.length-1];const br=bearing(C0,end);halves.push({L,P,s:(br>=90&&br<270)?-1:1})};
  R.forEach((r,i)=>{if(r.t!=="train")return;const L=(lineOf[i]||[])[0];if(!L||!ownLine(L,i))return;
    r.d.forEach((d,di)=>{if(seenP.has(d.p))return;seenP.add(d.p);const P=resample(path(i,di));
      let j=0,bd=1e9;P.forEach((q,k)=>{const dd=km(q,C0);if(dd<bd){bd=dd;j=k}});
      if(bd<1.5){addHalf(L,P.slice(0,Math.min(P.length,j+4)).reverse());addHalf(L,P.slice(Math.max(0,j-3)))}   /* halves overlap ~120 m so they meet cleanly */
      else addHalf(L,km(P[0],C0)<=km(P[P.length-1],C0)?P:P.slice().reverse())})});
  // spatial grid of raw track points
  const grid=new Map();const gk=(cx,cy)=>cx+","+cy;
  halves.forEach(h=>h.P.forEach(pt=>{const k=gk(Math.floor(pt[0]*KX/CELL),Math.floor(pt[1]*KY/CELL));let g=grid.get(k);if(!g)grid.set(k,g=[]);g.push([pt,h.L])}));
  const near=pt=>{const cx=Math.floor(pt[0]*KX/CELL),cy=Math.floor(pt[1]*KY/CELL);const best={};
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const g=grid.get(gk(cx+dx,cy+dy));if(g)for(const [q,L] of g){const d=km(pt,q);if(d<NEAR&&(!best[L]||d<best[L][0]))best[L]=[d,q]}}return best};
  const feats=[];
  for(const h of halves){const P=h.P,n=P.length;
    const info=P.map(pt=>{const nb=near(pt);nb[h.L]=nb[h.L]||[0,pt];const on=Object.keys(nb).sort((a,b)=>L2.indexOf(a)-L2.indexOf(b));
      const c=[0,0];on.forEach(L=>{c[0]+=nb[L][1][0];c[1]+=nb[L][1][1]});return {c:[c[0]/on.length,c[1]/on.length],k:on.indexOf(h.L)-(on.length-1)/2}});
    // shared centreline (average of the nearest point on every line in the corridor), smoothed along the track
    const cen=info.map((_,i)=>{let x=0,y=0,m=0;for(let j=Math.max(0,i-2);j<=Math.min(n-1,i+2);j++){x+=info[j].c[0];y+=info[j].c[1];m++}return [x/m,y/m]});
    cen[n-1]=P[n-1];
    // offsets eased over ~200 m so lines slide in and out of bundles instead of jumping
    const k=info.map((_,i)=>{let t=0,m=0;for(let j=Math.max(0,i-SM);j<=Math.min(n-1,i+SM);j++){t+=info[j].k;m++}return Math.round(t/m*10)/10*h.s});
    let st=0;for(let i=1;i<=n;i++){if(i<n&&k[i]===k[st])continue;const seg=cen.slice(st,Math.min(i+1,n));if(seg.length>1)feats.push({type:"Feature",properties:{c:TCOL[h.L],k:k[st]},geometry:{type:"LineString",coordinates:seg}});st=i}}
  return feats}
const trainStack=stackTrains();
src("bwlines",FC(bwLineF));src("trainl",FC(trainStack));src("ferryl",FC(net2.ferry));src("traml",FC(net2.tram));
["busway","busstn","train","ferry","tram","bus"].forEach(k=>src("pt_"+k,FC(ptF(k))));
src("veh",FC([]));src("hlvar",FC([]));src("hl",FC([]));src("arrows",FC([]));src("hlstops",FC([]));src("ends",FC([]));src("sel",FC([]));

// ---------- overlay layers
const L = [];
function add(layer){map.addLayer(layer);L.push(layer.id);return layer.id}
const FONT=["Noto Sans Medium"];
add({id:"zones-fill",type:"fill",source:"zones",paint:{"fill-color":["get","c"],"fill-opacity":["interpolate",["linear"],["zoom"],12,THEME[theme].zoneFill,13,.16,15,.07]}});
add({id:"chev-fill",type:"fill",source:"chev",paint:{"fill-pattern":["get","pat"],"fill-opacity":["interpolate",["linear"],["zoom"],12,.85,13,.3,15,0]}});
add({id:"chev-line",type:"line",source:"chev",paint:{"line-color":THEME[theme].chevLine,"line-width":1.4,"line-opacity":["interpolate",["linear"],["zoom"],12,.95,15,.25]}});
add({id:"zones-line",type:"line",source:"zones",paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],8,1.6,12,2.6],"line-opacity":["interpolate",["linear"],["zoom"],12,1,15,.45]}});
add({id:"dots",type:"line",source:"dots",layout:{"line-cap":"round"},paint:{"line-color":THEME[theme].dots,"line-width":2.4,"line-dasharray":[.1,2.6],"line-opacity":.9}});
add({id:"loop",type:"line",source:"loop",layout:{"line-cap":"round"},paint:{"line-color":THEME[theme].dots,"line-width":2.4,"line-dasharray":[.1,2.6]}});
add({id:"loop-arrows",type:"symbol",source:"loop",minzoom:10.5,layout:{"symbol-placement":"line","symbol-spacing":70,"icon-image":"loopArrow","icon-size":1,"icon-rotation-alignment":"map","icon-allow-overlap":true}});
add({id:"ferry-line",type:"line",source:"ferryl",paint:{"line-color":"#36A9B4","line-width":2.6,"line-dasharray":[3,2]}});
add({id:"tram-case",type:"line",source:"traml",paint:{"line-color":THEME[theme].casing,"line-width":6}});
add({id:"tram-line",type:"line",source:"traml",paint:{"line-color":["get","c"],"line-width":3.4}});
add({id:"train-case",type:"line",source:"trainl",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":THEME[theme].casing,"line-width":["interpolate",["linear"],["zoom"],9,3.6,14,6.5],"line-offset":["interpolate",["linear"],["zoom"],9,["*",["get","k"],2.4],14,["*",["get","k"],4.6]]}});
add({id:"train-line",type:"line",source:"trainl",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,2.4,14,4.6],"line-offset":["interpolate",["linear"],["zoom"],9,["*",["get","k"],2.4],14,["*",["get","k"],4.6]]}});
add({id:"bw-case",type:"line",source:"bwlines",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":THEME[theme].casing,"line-width":["interpolate",["linear"],["zoom"],9,6,14,11]}});
add({id:"bw-line",type:"line",source:"bwlines",filter:["==",["get","road"],0],layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,3.6,14,7]}});
add({id:"bw-road",type:"line",source:"bwlines",filter:["==",["get","road"],1],layout:{"line-cap":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,3.6,14,7],"line-dasharray":[.1,1.8]}});
add({id:"zlabels",type:"symbol",source:"zlabels",maxzoom:12.5,layout:{"text-field":["get","t"],"text-font":["Noto Sans Medium"],"text-size":["interpolate",["linear"],["zoom"],8,18,11,30],"text-allow-overlap":true},paint:{"text-color":THEME[theme].zoneText,"text-halo-color":THEME[theme].zoneHalo,"text-halo-width":2.2}});
// highlight (route / all routes)
add({id:"hlvar-case",type:"line",source:"hlvar",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#ffffff","line-width":7,"line-opacity":.9}});
add({id:"hlvar-line",type:"line",source:"hlvar",layout:{"line-cap":"butt","line-join":"round"},paint:{"line-color":["get","c"],"line-width":4,"line-dasharray":[1.6,1.1]}});
add({id:"hl-case",type:"line",source:"hl",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#ffffff","line-width":["case",["==",["get","mode"],"web"],6,10],"line-opacity":.95}});
add({id:"hl-line",type:"line",source:"hl",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["case",["==",["get","mode"],"web"],3.4,6]}});
add({id:"web-arrows",type:"symbol",source:"arrows",layout:{"icon-image":"dirArrow","icon-size":["interpolate",["linear"],["zoom"],9,0.65,15,0.8],"icon-rotate":["get","b"],"icon-rotation-alignment":"map","icon-allow-overlap":true,"icon-ignore-placement":true}});
add({id:"veh-dot",type:"circle",source:"veh",paint:{"circle-color":["get","c"],"circle-radius":["interpolate",["linear"],["zoom"],9,["case",["==",["get","trk"],1],7,["==",["get","lv"],1],5.5,2.6],12,["case",["==",["get","trk"],1],9,["==",["get","lv"],1],7.5,4.5],13.3,["case",["==",["get","trk"],1],12,8],16,["case",["==",["get","trk"],1],14,10]],"circle-stroke-color":["case",["==",["get","trk"],1],"#16a34a",["==",["get","lv"],1],"#22c55e","#0b0f17"],"circle-stroke-width":["interpolate",["linear"],["zoom"],9,["case",["==",["get","trk"],1],3,["==",["get","lv"],1],2.5,1.2],14,["case",["==",["get","trk"],1],4,["==",["get","lv"],1],3.5,2.2]],"circle-opacity":["case",["get","dim"],.25,1],"circle-stroke-opacity":["case",["get","dim"],.25,1]}});
add({id:"veh-lbl",type:"symbol",source:"veh",minzoom:13.3,layout:{"text-field":["get","n"],"text-font":FONT,"text-size":10.5,"text-allow-overlap":true,"text-ignore-placement":true},paint:{"text-color":["get","tc"],"text-opacity":["case",["get","dim"],.3,1]}});
// stops & stations
add({id:"stops",type:"circle",source:"pt_bus",minzoom:13.5,paint:{"circle-color":"#E463A4","circle-radius":["interpolate",["linear"],["zoom"],14,3.6,17,6.5],"circle-stroke-color":THEME[theme].stopStroke,"circle-stroke-width":1.4}});
add({id:"hlstops",type:"circle",source:"hlstops",paint:{"circle-color":"#ffffff","circle-radius":4.5,"circle-stroke-color":["get","c"],"circle-stroke-width":2.5}});
add({id:"ferry-pt",type:"circle",source:"pt_ferry",paint:{"circle-color":"#36A9B4","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6],"circle-stroke-color":THEME[theme].stopStroke,"circle-stroke-width":1.8}});
add({id:"tram-pt",type:"circle",source:"pt_tram",paint:{"circle-color":"#FFD400","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6],"circle-stroke-color":"#0b0f17","circle-stroke-width":1.6}});
add({id:"train-pt",type:"circle",source:"pt_train",paint:{"circle-color":"#ffffff","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6.5],"circle-stroke-color":"#0b0f17","circle-stroke-width":2}});
add({id:"busstn-pt",type:"circle",source:"pt_busstn",paint:{"circle-color":"#ffffff","circle-radius":["interpolate",["linear"],["zoom"],9,3.4,14,6.5],"circle-stroke-color":"#0b0f17","circle-stroke-width":2}});
add({id:"busway-pt",type:"symbol",source:"pt_busway",layout:{"icon-image":["get","icon"],"icon-size":["interpolate",["linear"],["zoom"],9,.62,12,.85,15,1.1],"icon-allow-overlap":true,"icon-ignore-placement":true}});
add({id:"busway-lbl",type:"symbol",source:"pt_busway",minzoom:11.3,layout:{"text-field":["get","sn"],"text-font":FONT,"text-size":12.5,"text-offset":[0,1.25],"text-anchor":"top","text-optional":true,"text-padding":2},paint:{"text-color":THEME[theme].lblText,"text-halo-color":THEME[theme].lblHalo,"text-halo-width":1.8}});
add({id:"train-lbl",type:"symbol",source:"pt_train",minzoom:12.3,layout:{"text-field":["get","sn"],"text-font":FONT,"text-size":12,"text-offset":[0,1.1],"text-anchor":"top","text-optional":true,"text-padding":3},paint:{"text-color":THEME[theme].lblText,"text-halo-color":THEME[theme].lblHalo,"text-halo-width":1.8}});
add({id:"busstn-lbl",type:"symbol",source:"pt_busstn",minzoom:12.3,layout:{"text-field":["get","sn"],"text-font":FONT,"text-size":12,"text-offset":[0,1.1],"text-anchor":"top","text-optional":true,"text-padding":3},paint:{"text-color":THEME[theme].lblText,"text-halo-color":THEME[theme].lblHalo,"text-halo-width":1.8}});
add({id:"ends",type:"symbol",source:"ends",layout:{"text-field":["get","t"],"text-font":FONT,"text-size":12,"text-anchor":"left","text-offset":[.7,0],"text-allow-overlap":false,"text-padding":1},paint:{"text-color":["get","c"],"text-halo-color":"#ffffff","text-halo-width":2.2}});
add({id:"ends-dot",type:"circle",source:"ends",paint:{"circle-color":["get","c"],"circle-radius":4,"circle-stroke-color":"#fff","circle-stroke-width":1.5}});
add({id:"sel",type:"circle",source:"sel",paint:{"circle-color":"rgba(0,0,0,0)","circle-radius":12,"circle-stroke-color":"#ff2d55","circle-stroke-width":3}});
map.moveLayer("zlabels"); // zone numbers drawn above everything else
const FIRST_OVERLAY = L[0];

// ---------- theme switch
function applyThemePaint(){const T=THEME[theme];
  map.setPaintProperty("zones-fill","fill-opacity",["interpolate",["linear"],["zoom"],12,T.zoneFill,13,.16,15,.07]);
  [["dots","line-color",T.dots],["loop","line-color",T.dots],["chev-line","line-color",T.chevLine],["tram-case","line-color",T.casing],["train-case","line-color",T.casing],["bw-case","line-color",T.casing],
   ["zlabels","text-color",T.zoneText],["zlabels","text-halo-color",T.zoneHalo],["stops","circle-stroke-color",T.stopStroke],["ferry-pt","circle-stroke-color",T.stopStroke],["busway-lbl","text-color",T.lblText],["busway-lbl","text-halo-color",T.lblHalo],["train-lbl","text-color",T.lblText],["train-lbl","text-halo-color",T.lblHalo],["busstn-lbl","text-color",T.lblText],["busstn-lbl","text-halo-color",T.lblHalo]].forEach(([l,p,v])=>map.setPaintProperty(l,p,v))}
// More ▾ → UI and settings: light / dark and card transparency (saved on this device); Legend/information opens the info box
const setTa=v=>{v=Math.max(0,Math.min(80,+v||0));document.documentElement.style.setProperty("--ta",(v/100).toFixed(2));document.documentElement.classList.toggle("see",v>0);try{localStorage.setItem("seqmap_ta",v)}catch(e){}return v};
try{setTa(+localStorage.getItem("seqmap_ta")||0)}catch(e){}
function showUISettings(){const v=Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ta")||0)*100)||0;
  openPanel("UI and settings","Saved on this device",`<div class="uil">Mode</div><div class="uiseg"><button data-th="light">☀︎ Light</button><button data-th="dark">☾ Dark</button></div>
    <div class="uil">Transparency <span id="uiTaV">${v}%</span></div><input type="range" id="uiTa" min="0" max="80" step="5" value="${v}" aria-label="Card transparency">
    <div class="uin">Makes the cards, buttons and top bar see-through so more of the map shows.</div>`,{view:"uiset"});
  const seg=()=>pB.querySelectorAll("[data-th]").forEach(x=>x.classList.toggle("on",x.dataset.th===theme));seg();
  pB.querySelectorAll("[data-th]").forEach(x=>x.onclick=()=>{if(x.dataset.th!==theme)document.getElementById("themeBtn").click();seg()});
  const sl=document.getElementById("uiTa");sl.oninput=()=>{document.getElementById("uiTaV").textContent=setTa(sl.value)+"%"}}
document.getElementById("themeBtn").onclick=()=>{
  theme = theme==="light"?"dark":"light"; document.body.classList.toggle("light",theme==="light");
  try{localStorage.setItem("seqmap_theme",theme)}catch(e){}
  const keep=new Set(L); map.getStyle().layers.map(l=>l.id).filter(id=>!keep.has(id)).forEach(id=>map.removeLayer(id));
  map.setSprite(BASE+"assets/sprites/v4/"+THEME[theme].sprite);
  baseLayers(theme).forEach(l=>map.addLayer(l,FIRST_OVERLAY)); applyThemePaint(); if(typeof odPaint==="function")odPaint();if(typeof gcPaint==="function")gcPaint();if(typeof hmPaint==="function")hmPaint();if(typeof pjPaint==="function"){pjPaint("crr");pjPaint("wave")}if(typeof rbPaint==="function")rbPaint();
};

// ---------- layer toggles
const GROUPS=[
 ["zones","Bus zones","#9B5DE5",["zones-fill","chev-fill","chev-line","zones-line","dots","loop","loop-arrows","zlabels"]],
 ["busway","Busways","#1FAE98",["bw-case","bw-line","bw-road","busway-pt","busway-lbl"]],
 ["busstn","Bus stations","#ffffff",["busstn-pt","busstn-lbl"]],
 ["stops","Bus stops","#E463A4",["stops"]],
 ["train","Trains","#4E85C5",["train-case","train-line","train-pt","train-lbl"]],
 ["ferry","Ferries","#36A9B4",["ferry-line","ferry-pt"]],
 ["tram","Tram","#FFD400",["tram-case","tram-line","tram-pt"]],
 ["live","Live vehicles","#16a34a",["veh-dot","veh-lbl"]]];
const chipBox=document.getElementById("chips");const chipState={};const chipEl={};let soloSnap=null,soloKey=null;
function setGroup(k,vis){GROUPS.find(g=>g[0]===k)[3].forEach(id=>map.setLayoutProperty(id,"visibility",vis?"visible":"none"))}
function renderChip(k){const el=chipEl[k],st=chipState[k];el.classList.toggle("on",st!=="off");el.classList.toggle("only",st==="only");el.title=k==="live"?(st==="on"?"Click to hide live vehicles":"Click to show live vehicles"):st==="on"?"Click to hide":st==="off"?"Click to show only this layer":"Click to show all layers again"}
const MASS=g=>g!=="live";
function clickChip(k){setTimeout(saveChips,0);
  if(k==="live"){chipState.live=chipState.live==="off"?"on":"off";setGroup("live",chipState.live==="on");renderChip("live");if(chipState.live==="on")pollVehicles();return}
  if(soloKey&&soloKey!==k){chipState[soloKey]="on";renderChip(soloKey);soloKey=null;soloSnap=null}
  const st=chipState[k];
  if(st==="on"){chipState[k]="off";setGroup(k,false)}
  else if(st==="off"){soloSnap={};GROUPS.forEach(([g])=>{if(g!==k&&MASS(g)){soloSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)}});chipState[k]="only";soloKey=k;setGroup(k,true)}
  else{chipState[k]="on";setGroup(k,true);if(soloSnap)Object.entries(soloSnap).forEach(([g,v])=>{chipState[g]=v;setGroup(g,v!=="off");renderChip(g)});soloSnap=null;soloKey=null}
  renderChip(k);renderAll();hint()}
const allEl=document.createElement("div");allEl.className="chip allchip";allEl.innerHTML="All";chipBox.appendChild(allEl);
function renderAll(){const anyOff=GROUPS.some(([g])=>MASS(g)&&chipState[g]==="off");allEl.textContent=anyOff?"Show all":"Hide all";allEl.title=anyOff?"Turn every layer on":"Turn every layer off"}
allEl.onclick=()=>{setTimeout(saveChips,0);const anyOff=GROUPS.some(([g])=>MASS(g)&&chipState[g]==="off");soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{if(!MASS(g))return;chipState[g]=anyOff?"on":"off";setGroup(g,anyOff);renderChip(g)});renderAll();hint()};
GROUPS.forEach(([k,label,col])=>{const el=document.createElement("div");el.className="chip on";el.innerHTML=`<span class="dot" style="background:${col};border:1px solid #0004"></span>${label}<span class="onlytag">only</span>`;
  chipEl[k]=el;chipState[k]="on";el.onclick=()=>clickChip(k);chipBox.appendChild(el);renderChip(k)});chipState.live="off";setGroup("live",false);renderChip("live");
// first visit: Bus zones start off (a saved layer choice from an earlier visit, below, takes over after that)
chipState.zones="off";setGroup("zones",false);renderChip("zones");renderAll();
// remember layer filters between visits (this device only)
function saveChips(){try{if(typeof odOn!=="undefined"&&odOn)return;if(typeof pjOn!=="undefined"&&pjOn)return;if(typeof gcOn!=="undefined"&&gcOn)return;if(typeof hmOn!=="undefined"&&hmOn)return;localStorage.setItem("seqmap_layers",JSON.stringify({s:chipState,k:soloKey,snap:soloSnap}))}catch(e){}}
try{const sv=JSON.parse(localStorage.getItem("seqmap_layers")||"null");
  if(sv&&sv.s){GROUPS.forEach(([g])=>{const v=sv.s[g];if(v==="on"||v==="off"||v==="only"){chipState[g]=v;setGroup(g,v!=="off");renderChip(g)}});soloKey=sv.k||null;soloSnap=sv.snap||null;renderAll()}}catch(e){}
const stopsOn=()=>map.getLayoutProperty("stops","visibility")!=="none";
function hint(){const z=map.getZoom();document.getElementById("hint").style.display=(stopsOn()&&z>=12&&z<13.5)?"block":"none"}
map.on("zoomend",hint);hint();

// ---------- badges & panel
function badge(i,label){const r=R[i];return `<span class="rb" data-r="${i}" style="background:${r.c};color:${r.tc}">${esc(label||r.n)}</span>`}
function lineBadge(nm){return `<span class="rb" data-line="${esc(nm)}" style="background:${TCOL[nm]};color:${nm==="T5"||nm==="T2"?"#111":"#fff"}" title="${esc(TNAME[nm])}">${esc(nm)}</span>`}
const panel=document.getElementById("panel"),pT=document.getElementById("pTitle"),pS=document.getElementById("pSub"),pB=document.getElementById("pBody"),pBack=document.getElementById("pBack");
let ctx=null;      // current stop context {id, web}
let backState=null;// set when a route is opened from a stop card
const MINI_VIEWS=new Set(["gc","gcv","od","odv","pj","pjv","hm","hmv","rb","rbv"]);   // map-layer cards that shrink instead of closing
const PHONE_MQ="(max-width:640px), (max-height:500px) and (pointer:coarse)";
function isPhone(){return matchMedia(PHONE_MQ).matches}
function openPanel(t,s,html,opt){opt=opt||{};if(typeof TRK!=="undefined"&&TRK&&!(opt.veh&&opt.veh.trip===TRK.trip))trkStop();{const g=MINI_VIEWS.has(opt.view)&&!isPhone(),xb=document.getElementById("pClose");panel.classList.remove("mini");panel.classList.toggle("minix",!g);{const mb=document.getElementById("pMin");mb.textContent="–";mb.title="Minimise";mb.setAttribute("aria-label","Minimise")}xb.textContent=g?"–":"×";xb.title=g?"Minimise":"Close";xb.setAttribute("aria-label",xb.title)}if(opt.view!=="cn"&&typeof cnLayers==="function")cnLayers(false);{const pc=document.getElementById("pCn");if(pc)pc.style.display="none"}vehFocus=opt.veh||null;view=opt.view||"";panel.classList.toggle("wide",!!opt.wide);pT.textContent=t;pS.innerHTML=s;pB.innerHTML=html;panel.style.display="flex";setStar(opt.star||null);
  if(view!=="rt"&&rtFocus){rtFocus=false;syncVehVis()}wire()}
// ---------- favourites (saved on this device only)
const FAV={stops:[],routes:[]};try{const f=JSON.parse(localStorage.getItem("seqmap_favs")||"{}");FAV.stops=f.stops||[];FAV.routes=f.routes||[]}catch(e){}
function saveFav(){try{localStorage.setItem("seqmap_favs",JSON.stringify(FAV))}catch(e){}updateFavBtns();if(typeof pollCancellations==="function")pollCancellations()}
const pStar=document.getElementById("pStar");let starTarget=null;
function setStar(t){starTarget=t;if(!t){pStar.style.display="none";return}pStar.style.display="block";const on=FAV[t.list].includes(t.key);pStar.textContent=on?"★":"☆";pStar.classList.toggle("on",on);pStar.title=on?"Remove from saved":"Save to favourites"}
pStar.onclick=()=>{if(!starTarget)return;const L=FAV[starTarget.list];const k=L.indexOf(starTarget.key);if(k>=0)L.splice(k,1);else L.push(starTarget.key);saveFav();setStar(starTarget)};
function updateFavBtns(){document.getElementById("favStopsBtn").textContent="★ Stops"+(FAV.stops.length?" ("+FAV.stops.length+")":"");document.getElementById("favRoutesBtn").textContent="★ Routes"+(FAV.routes.length?" ("+FAV.routes.length+")":"")}
// the vehicle running a trip: by trip id, or (when the two feeds spell the trip differently) the vehicle on the same
// route, direction and start time
function vehForTrip(p){if(!LIVE.byTrip)return null;if(LIVE.byTrip.has(p.trip))return p.trip;if(!p.st)return null;
  const tid=String(p.trip).split("-")[0];
  const v=(LIVE.veh||[]).find(v=>v.ri===p.ri&&v.start===p.st&&(p.dir==null||v.dir==null||String(v.dir)===String(p.dir)))||(tid.length>5&&(LIVE.veh||[]).find(v=>v.ri===p.ri&&String(v.trip).split("-")[0]===tid));
  return v?v.trip:null}
const rowVeh=b=>{const tr=b.closest(".tr");const c=tr&&tr.querySelector("[data-trip]");return c&&LIVE.byTrip?LIVE.byTrip.get(c.dataset.trip)||null:null};
// nearest live service still heading towards this stop on the row's route (or train line) and headsign
function upstreamVeh(b){const tr=b.closest(".tr[data-k]");if(!tr||!ctx||!ctx.rows)return null;return upstreamRow(ctx.rows[+tr.dataset.k])}
function upstreamRow(row){if(!row||!ctx||!LIVE.veh)return null;const H=LIVE.here,t0=row.up&&row.up.length?row.up[0]%1440:null;
  const here=new Set((ctx.liveIds||[ctx.id,...(KIDS[ctx.id]||[])]).map(stopKey));const head=norm(cleanHead(TT.cal.hs[row.hi]||""));let best=null;
  for(const v of LIVE.veh){if(row.kind==="train"?lineAt(v.ri,ctx.id)!==row.line:v.ri!==row.ri)continue;
    // a bus already running a later departure from here (e.g. the 5:35) isn't the bus for this one (the 5:05)
    if(H&&H.has(v.trip)&&t0!=null&&H.get(v.trip)!==t0)continue;const ns=v.stop&&stopKey(v.stop);if(!ns)continue;
    R[v.ri].d.forEach(d=>{const a=d.s.indexOf(ns);if(a<0)return;const z=d.s.findIndex((x,j)=>j>=a&&here.has(x));if(z<0)return;
      const hm=head&&d.h&&(norm(d.h).includes(head)||head.includes(norm(d.h)))?0:1;if(hm&&head&&R[v.ri].d.some(x=>x.h&&(norm(x.h).includes(head)||head.includes(norm(x.h)))))return;const sc=hm*1000+(z-a);if(!best||sc<best.sc)best={sc,v}})}
  return best?best.v:null}
const rowHead=b=>{const tr=b.closest(".tr[data-k]");const row=tr&&ctx&&ctx.rows&&ctx.rows[+tr.dataset.k];return row?cleanHead(TT.cal.hs[row.hi]||""):null};
async function rowVehFor(b){let v=rowVeh(b);if(v)return v;const tr=b.closest(".tr");if(tr&&tr.querySelector("[data-trip]")||!LIVE.vehAt||Date.now()-LIVE.vehAt>15000){await pollVehicles(true);v=rowVeh(b)}return v||upstreamVeh(b)}
function wire(){pB.querySelectorAll(".varst [data-s2]").forEach(a=>a.onclick=()=>openStop(a.dataset.s2,true));pB.querySelectorAll("[data-var]").forEach(a=>a.onclick=e=>{e.preventDefault();const [i,di,k]=a.dataset.var.split(",").map(Number);
    // ‹ from the variant goes back to the route card it was opened from
    const b=rcState&&rcState.vi==null?{kind:"rcard",rs:{...rcState},prev:backState,cam:{center:map.getCenter(),zoom:map.getZoom()}}:null;showVariant(R[i].n,di,k);if(b)setBack(b)});pB.querySelectorAll("[data-r]").forEach(b=>b.onclick=async()=>showRoute(+b.dataset.r,true,await rowVehFor(b),rowHead(b)));pB.querySelectorAll("[data-line]").forEach(b=>b.onclick=async()=>showLine(b.dataset.line,true,await rowVehFor(b),rowHead(b)));
  pB.querySelectorAll("[data-near]").forEach(el=>el.onclick=()=>openStop(el.dataset.near,true));pB.querySelectorAll("[data-s]").forEach(li=>li.onclick=()=>openStop(li.dataset.s,true))}
function setSel(id){const s=id&&ST[id];map.getSource("sel").setData(FC(s?[{type:"Feature",properties:{},geometry:{type:"Point",coordinates:[s[2],s[1]]}}]:[]))}
function clearHL(){webLegs=[];map.getSource("hlvar").setData(FC([]));map.getSource("hl").setData(FC([]));map.getSource("arrows").setData(FC([]));map.getSource("hlstops").setData(FC([]));map.getSource("ends").setData(FC([]))}
function closePanel(){if(typeof TRK!=="undefined"&&TRK)trkStop();panel.classList.remove("mini");if(typeof cnLayers==="function")cnLayers(false);vehFocus=null;focusRoutes=null;rtFocus=false;view="";rtState=null;syncVehVis();const c=webCam||(backState&&backState.cam);webCam=null;panel.style.display="none";clearHL();setSel(null);ctx=null;backState=null;pBack.style.display="none";if(c)map.flyTo({...c,duration:650})}
const pCloseBtn=document.getElementById("pClose"),pCloseTxt=pCloseBtn.textContent,pCloseLbl=pCloseBtn.getAttribute("aria-label")||"Close";
function setMini(on){if(isPhone())return phMini(on);panel.classList.toggle("mini",on);pCloseBtn.textContent=on?"+":"–";pCloseBtn.setAttribute("aria-label",on?"Expand":"Minimise");pCloseBtn.title=on?"Expand":"Minimise"}
pCloseBtn.onclick=()=>{if(isPhone()){   // phones: ✕ always closes; a map mode (On demand, projects, vendors, heat map) switches off too
    if((view==="od"||view==="odv")&&odOn)return toggleOD();if((view==="pj"||view==="pjv")&&pjOn)return togglePJ(pjOn);if((view==="gc"||view==="gcv")&&gcOn)return toggleGC();if((view==="hm"||view==="hmv")&&hmOn)return toggleHM();if((view==="rb"||view==="rbv")&&rbOn)return toggleRB();return closePanel()}
  if(MINI_VIEWS.has(view))return setMini(!panel.classList.contains("mini"));closePanel()};
panel.querySelector(".pht").addEventListener("click",()=>{if(panel.classList.contains("mini"))cardMini(false)});
pBack.onclick=()=>{if(!backState)return;const b=backState;backState=null;pBack.style.display="none";if(b.cam)map.jumpTo(b.cam);
  if(b.kind==="cn"){openPanel("Journey Search",b.sub,"",{view:"cn"});pB.replaceChildren(...b.nodes);pB.scrollTop=b.scroll;if(b.prev)setBack(b.prev);drawOption(b.oi);return}
  if(b.kind==="pj")return pjOverview();if(b.kind==="rb")return rbOverview();if(b.kind==="rbc"){if(!rbOn)return toggleRB(true).then(()=>rbCard(b.id,true));return rbCard(b.id,true)}
  if(b.kind==="ccu")return showCatchups();
  if(b.kind==="notes"){notesTidy();return showNotes()}
  if(b.kind==="rcard")return reopenCard(b);
  if(b.kind==="hmon"){rtaBack=null;HMF=b.f||HMF;return toggleHM(b.f)}
  if(b.kind==="rta")return showRTA();if(b.kind==="rtav")return rtaDetail(b.i);if(b.kind==="hm")return hmOverview();
  if(b.kind==="gc")return gcOverview();if(b.kind==="od")return odOverview();if(b.kind==="favs")return showFavStops();if(b.kind==="favr")return showFavRoutes();if(b.kind==="rt")return openRouteTable(b.key,b.st);openStop(b.id,false,b.web,true,true)};
function setBack(b){backState=b;pBack.style.display="block"}
function sortRoutes(ids){return ids.slice().sort((a,b)=>cmpRoute(R[a].n,R[b].n))}
function dist(a,b){const k=Math.PI/180,x=(b[2]-a[2])*Math.cos((a[1]+b[1])/2*k),y=b[1]-a[1];return Math.sqrt(x*x+y*y)*111320}

// ---------- timetables
const TT={cal:null,tiles:{}};
const tileOf=s=>Math.floor(s[1]*20)+"_"+Math.floor(s[2]*20);
async function ensureCal(){if(!TT.cal)TT.cal=await (await fetch(BASE+"data/tt/calendar.json"+DV)).json();return TT.cal}
async function loadTT(s){await ensureCal();const t=tileOf(s);
  if(!(t in TT.tiles)){try{TT.tiles[t]=await (await fetch(BASE+"data/tt/"+t+".json"+DV)).json()}catch(e){TT.tiles[t]={}}}return TT.tiles[t]}
const fmtParts=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Brisbane",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"});
function bneNow(){const p=Object.fromEntries(fmtParts.formatToParts(new Date()).map(x=>[x.type,x.value]));return {ymd:p.year+p.month+p.day,dow:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(p.weekday),min:(+p.hour)*60+(+p.minute)}}
function shiftDay(ymd,dow,k){const d=new Date(Date.UTC(+ymd.slice(0,4),+ymd.slice(4,6)-1,+ymd.slice(6,8)+k));return {ymd:d.toISOString().slice(0,10).replace(/-/g,""),dow:((dow+k)%7+7)%7}}
function svcOn(si,day){const [mask,st,en,add,rem]=TT.cal.svc[si];if(rem.includes(day.ymd))return false;if(add.includes(day.ymd))return true;return st<=day.ymd&&day.ymd<=en&&mask[day.dow]==="1"}
function clock(m){m=((m%1440)+1440)%1440;const h=Math.floor(m/60),mm=m%60;return (h%12||12)+":"+String(mm).padStart(2,"0")+(h<12?" am":" pm")}
function shortClock(m){m=((m%1440)+1440)%1440;const h=Math.floor(m/60),mm=m%60;return (h%12||12)+":"+String(mm).padStart(2,"0")+(h<12?" am":" pm")}
const cleanHead=h=>shortName(String(h||"").replace(/\s*,\s*stop\s+\w+$/i,""));
function buildRows(id,entries){const now=bneNow(),today={ymd:now.ymd,dow:now.dow},yest=shiftDay(now.ymd,now.dow,-1),tom=shiftDay(now.ymd,now.dow,1);const rows=new Map();
  for(const e of entries){const ri=e[0],hi=e[1],si=e[2];const r=R[ri];if(!r)continue;let k0=3,pl=null;if(e[3]<0){pl=(TT.cal.pl||[])[-e[3]-1]||null;k0=4}const times=[];let acc=0;for(let k=k0;k<e.length;k++){acc+=e[k];times.push(acc)}
    const key=(r.t==="train"?lineAt(ri,id):"r"+ri)+"|"+hi;
    let row=rows.get(key);if(!row){row={ri,hi,kind:r.t,line:r.t==="train"?lineAt(ri,id):null,up:[],tomorrow:[],pl:{},plT:{}};rows.set(key,row)}
    if(svcOn(si,today))times.forEach(t=>{if(t>=now.min){row.up.push(t);if(pl)row.pl[t]=pl}});
    if(svcOn(si,yest))times.forEach(t=>{if(t>=1440&&t-1440>=now.min){row.up.push(t-1440);if(pl)row.pl[t-1440]=pl}});
    if(svcOn(si,tom))times.forEach(t=>{row.tomorrow.push(t);if(pl)row.plT[t]=pl})}
  const out=[...rows.values()];out.forEach(r=>{r.up=[...new Set(r.up)].sort((a,b)=>a-b);r.tomorrow.sort((a,b)=>a-b)});
  const grp={train:0,bus:1,ferry:2,tram:3};
  out.sort((a,b)=>grp[a.kind]-grp[b.kind]||(a.kind==="train"?LINE_ORDER.indexOf(a.line)-LINE_ORDER.indexOf(b.line):cmpRoute(R[a.ri].n,R[b.ri].n))||TT.cal.hs[a.hi].localeCompare(TT.cal.hs[b.hi]));
  return {rows:out.filter(r=>r.up.length||r.tomorrow.length),nowMin:now.min}}
function rowHTML(r,nowMin,k){const rt=R[r.ri];const bdg=r.kind==="train"?lineBadge(r.line):badge(r.ri,rt.t==="tram"?"G:link":rt.n);
  let next,list;
  const p0=r.up.length?r.pl[r.up[0]]:(r.tomorrow.length?r.plT[r.tomorrow[0]]:null);const pshort=x=>x?x.replace(/^Platform /,"P").replace(/^Stop /,""):"";
  if(r.up.length){const d=r.up[0]-nowMin;next=`<div class="nx sched" data-live="${k}">${d<=0?"Now":d<60?d+" min":clock(r.up[0])}</div>`;list=r.up.slice(1).map(t=>`<span>${shortClock(t)}${r.pl[t]&&r.pl[t]!==p0?`<i class="plx" title="${esc(r.pl[t])}">${esc(pshort(r.pl[t]))}</i>`:""}</span>`).join("")||`<em>Last service</em>`}
  else{next=`<div class="nx none" data-live="${k}">—</div>`;list=`<em>None today · tomorrow ${clock(r.tomorrow[0])}</em>`}
  return `<div class="tr" data-k="${k}"><div class="tc1">${bdg}<span class="hd"><span class="hdt" title="${esc(cleanHead(TT.cal.hs[r.hi]))}">→ ${esc(cleanHead(TT.cal.hs[r.hi]))}</span>${p0?`<span class="plat" data-plat="${k}">${esc(p0)}</span>`:""}</span></div>${next}<div class="tc3">${list}</div></div>`}
let ttTimer=null;
// ---------- interchanges: other stops that belong to a station (same name, within 300 m), grouped by mode
const MODE_OF=k=>k==="train"?"train":k==="tram"?"tram":k==="ferry"?"ferry":"bus";
const MODE_LBL={train:"Train",bus:"Bus",tram:"G:link",ferry:"Ferry"};
function linkedStops(id){const s=ST[id];if(!s||s[3]==="bus")return {};const base=s[0].toLowerCase().replace(/ (busway |bus )?station$/,"");const out={};
  for(const [k,o] of Object.entries(ST)){if(k===id||!o[5]||!o[5].length)continue;if(!o[0].toLowerCase().startsWith(base))continue;if(dist(s,o)>300)continue;(out[MODE_OF(o[3])]=out[MODE_OF(o[3])]||[]).push(k)}
  return out}
function stopLabel(id,base){const n=ST[id][0];let m=n.match(/,\s*platform\s+(\w+)$/i);if(m)return "Platform "+m[1];m=n.match(/\bstop\s+(\w{1,4})\b/i);if(m)return "Stop "+m[1];
  let r=n.replace(new RegExp("^"+base.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"),"").replace(/^[\s,]+/,"").trim();if(!r||/^station$/i.test(r))return ST[id][3]==="busway"?"Busway station":"Station stop";return r.charAt(0).toUpperCase()+r.slice(1)}
function plIdx(lbl){const pl=TT.cal.pl||(TT.cal.pl=[]);let i=pl.indexOf(lbl);if(i<0){pl.push(lbl);i=pl.length-1}return i}
async function modeEntries(id,mode){const s=ST[id];if(mode===MODE_OF(s[3])||!ctx.links||!ctx.links[mode]){const t=await loadTT(s);return t[id]||[]}
  const base=s[0].replace(/ (busway |bus )?station$/i,"");const out=[];
  for(const k of ctx.links[mode]){const t=await loadTT(ST[k]);const lb=stopLabel(k,base);for(const e of (t[k]||[])){const d=e[3]<0?e.slice(4):e.slice(3);const pi=e[3]<0?-e[3]-1:plIdx(lb);out.push([e[0],e[1],e[2],-(pi+1),...d])}}
  return out}
async function renderTT(id){const box=document.getElementById("ttBox");if(!box)return;const s=ST[id];
  let ents;try{await ensureCal();ents=await modeEntries(id,ctx.mode||MODE_OF(s[3]))}catch(e){box.innerHTML=`<div class="sub">Timetable unavailable.</div>`;return}
  if(!ctx||ctx.id!==id)return;
  const {rows,nowMin}=buildRows(id,ents);ctx.rows=rows;
  if(!rows.length){box.innerHTML=`<div class="sub">No scheduled departures from this stop in the current timetable.</div>`;return}
  const f=(document.getElementById("ttFilter")||{}).value||"";const q=f.trim().toLowerCase();
  box.innerHTML=`<div class="th"><div>Route</div><div title="Green = live, amber = running late, grey = scheduled">Next</div><div>Later departures (scheduled)</div></div>`+rows.map((r,k)=>{const lab=(r.kind==="train"?r.line+" "+TNAME[r.line]:R[r.ri].n)+" "+TT.cal.hs[r.hi];return (!q||lab.toLowerCase().includes(q))?rowHTML(r,nowMin,k):""}).join("");
  box.querySelectorAll("[data-r]").forEach(b=>b.onclick=async()=>showRoute(+b.dataset.r,true,await rowVehFor(b),rowHead(b)));box.querySelectorAll("[data-line]").forEach(b=>b.onclick=async()=>showLine(b.dataset.line,true,await rowVehFor(b),rowHead(b)));
  if(typeof applyLive==="function")applyLive(id)}

function openStop(id,fly,web,keepCam,noFit,mode){const s=ST[id];if(!s)return;focusRoutes=null;rtFocus=false;syncVehVis();if(!keepCam)webCam=null;
  const links=linkedStops(id);const own=MODE_OF(s[3]);const modes=[own,...["train","bus","tram","ferry"].filter(m=>m!==own&&links[m])];mode=modes.includes(mode)?mode:own;
  const liveIds=mode===own?[id,...(KIDS[id]||[])]:links[mode].flatMap(k=>[k,...(KIDS[k]||[])]);
  ctx={id,web:!!web,links,mode,liveIds};backState=null;pBack.style.display="none";clearHL();setSel(id);
  if(fly)map.flyTo({center:[s[2],s[1]],zoom:Math.max(map.getZoom(),s[3]==="bus"?16:15),duration:600});
  const DET=window.__det||(window.__det=new Set(net.detached||[]));
  const near=[];for(const [oid,o] of Object.entries(ST)){if(oid===id||(o[3]==="bus"&&!(DET.has(oid)&&s[3]==="train")))continue;const d=dist(s,o);if(d<1000)near.push([d,oid,o])}near.sort((a,b)=>a[0]-b[0]);
  let h="";
  if(near.length)h+=`<div class="grp" style="margin-top:2px">Nearby stations</div><div class="nearrow">`+near.slice(0,25).map(([d,oid,o])=>`<div class="nearchip" data-near="${oid}"><b>${esc(shortName(o[0]))}</b><span>${KIND[o[3]]} · ${Math.round(d/10)*10} m</span></div>`).join("")+`</div>`;
  const modeBtns=modes.length>1?`<div class="modeseg">${modes.map(m=>`<button data-mode="${m}" class="${m===mode?"on":""}">${MODE_LBL[m]}</button>`).join("")}</div>`:"";
  const locB=locBtns(id);h+=(typeof rbStationHTML==="function"?rbStationHTML(id):"")+accHTML(id);
  if(s[5].length){h+=`<div class="webrow"><button class="btn${web?" on":""}" id="webBtn">${web?"Hide all routes":"Show all routes"}</button>${locB}${modeBtns}`+(s[5].length>8?`<input id="ttFilter" class="ttf" placeholder="Filter routes" autocomplete="off">`:"")+`</div>`;
    h+=`<div id="ttBox" class="tt"><div class="sub">Loading timetable…</div></div>`}
  else h+=(locB?`<div class="webrow">${locB}</div>`:"")+`<div class="sub">No scheduled services in this timetable.</div>`;
  let sub=KIND[s[3]];if(s[3]==="busway"&&BWS[id])sub+=" · "+BWS[id].b.map(k=>BWNAME[k]).join(" / ")+(BWS[id].road?" (on-road section)":"");if(s[4])sub+=" · "+esc(s[4]);
  openPanel(s[0],sub,h,{star:{list:"stops",key:id}});
  if(typeof rbWireNotes==="function")rbWireNotes();
  const wb=document.getElementById("webBtn");if(wb)wb.onclick=()=>{if(!ctx.web){webCam={center:map.getCenter(),zoom:map.getZoom()};openStop(id,false,true,true)}else{const c=webCam;webCam=null;openStop(id,false,false,true);if(c)map.flyTo({...c,duration:650})}};
  const tf=document.getElementById("ttFilter");if(tf)tf.oninput=()=>renderTT(id);
  const pc=document.getElementById("pCn");pc.style.display="";pc.onclick=()=>{const b={id,web:!!ctx.web,cam:{center:map.getCenter(),zoom:map.getZoom()}};showConnections(id);setBack(b)};
  pB.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{const m=b.dataset.mode;ctx.mode=m;ctx.liveIds=m===own?[id,...(KIDS[id]||[])]:links[m].flatMap(k=>[k,...(KIDS[k]||[])]);
    pB.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("on",x===b));const bx=document.getElementById("ttBox");if(bx)bx.innerHTML=`<div class="sub">Loading timetable…</div>`;renderTT(id)});
  if(s[5].length)renderTT(id);
  insertAlerts([id,...(KIDS[id]||[])],s[5]);
  clearInterval(ttTimer);ttTimer=setInterval(()=>{if(ctx&&ctx.id===id&&panel.style.display!=="none")renderTT(id);else clearInterval(ttTimer)},30000);
  if(web)drawWeb(id,noFit)}

// all routes from a stop ("spider web"): full bus paths, onward legs for rail/ferry/tram, white arrows on onward parts, end labels
function nearestIdx(p,x,y){let bi=0,bd=1e9;for(let k=0;k<p.length;k++){const dx=(p[k][0]-x)*0.886,dy=p[k][1]-y,d=dx*dx+dy*dy;if(d<bd){bd=d;bi=k}}return bi}
let webLegs=[];let webCam=null;
function placeArrows(){if(!webLegs.length){map.getSource("arrows").setData(FC([]));return}
  const SP=innerWidth<=640?110:130,CELL=34,taken=new Set(),pts=[];
  for(const leg of webLegs){let prev=map.project(leg[0]),acc=SP*0.6;
    for(let k=1;k<leg.length;k++){const cur=map.project(leg[k]);const dx=cur.x-prev.x,dy=cur.y-prev.y,seg=Math.hypot(dx,dy);
      while(seg>0&&acc<=seg){const t=acc/seg,x=prev.x+dx*t,y=prev.y+dy*t;const b=Math.atan2(dy,dx)*180/Math.PI;
        const key=Math.round(x/CELL)+":"+Math.round(y/CELL)+":"+Math.round(((b+360)%360)/60);
        if(!taken.has(key)){taken.add(key);const g=map.unproject([x,y]);pts.push({type:"Feature",properties:{b},geometry:{type:"Point",coordinates:[g.lng,g.lat]}})}
        acc+=SP;if(pts.length>4000)break}
      acc-=seg;prev=cur}}
  map.getSource("arrows").setData(FC(pts))}
map.on("moveend",()=>{if(webLegs.length)placeArrows()});
function drawWeb(id,noFit){const s=ST[id];const lines=[],arrows=[],ends=[];const seenEnd=new Set();let bb=null;
  const grow=p=>p.forEach(([x,y])=>{bb=bb?[Math.min(bb[0],x),Math.min(bb[1],y),Math.max(bb[2],x),Math.max(bb[3],y)]:[x,y,x,y]});
  s[5].forEach(i=>{const r=R[i];const fixed=r.t!=="bus";r.d.forEach((d,di)=>{const p=path(i,di);const k=d.s.indexOf(id);
    if(k<0){if(!fixed){lines.push({type:"Feature",properties:{c:r.c,ri:i,mode:"web"},geometry:{type:"LineString",coordinates:p}});grow(p)}return}
    if(k>=d.s.length-1){if(!fixed){lines.push({type:"Feature",properties:{c:r.c,ri:i,mode:"web"},geometry:{type:"LineString",coordinates:p}});grow(p)}return}
    const j=nearestIdx(p,s[2],s[1]);const onward=[[s[2],s[1]],...p.slice(j+1)];if(onward.length<2)return;
    lines.push({type:"Feature",properties:{c:r.c,ri:i,mode:"web"},geometry:{type:"LineString",coordinates:fixed?onward:p}});grow(fixed?onward:p);
    arrows.push(onward);
    const last=d.s[d.s.length-1];const ls=ST[last];if(!ls)return;
    const dest=(d.h&&d.h.length<34?d.h:ls[0]).replace(/\s*,\s*stop\s+\w+$/i,"").replace(/\s+(near|at|opp)\s+.*$/i,"");
    const lab=(r.t==="train"?(lineOf[i]||["Train"])[0]:r.t==="tram"?"G:link":r.n)+" → "+shortName(dest);if(seenEnd.has(lab))return;seenEnd.add(lab);
    ends.push({type:"Feature",properties:{t:lab,c:r.c,ri:i},geometry:{type:"Point",coordinates:[ls[2],ls[1]]}})})});
  map.getSource("hl").setData(FC(lines));webLegs=arrows;placeArrows();map.getSource("ends").setData(FC(ends));
  if(bb&&!noFit)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:15})}

// single route view
let curRoute=null;let focusRoutes=null;
function routeArrows(i,di){const r=R[i],d=r.d[di];if(!d){webLegs=[];placeArrows();return}const p=path(i,di);let leg=p;
  if(backState){const s=ST[backState.id];if(s&&d.s.includes(backState.id)){const j=nearestIdx(p,s[2],s[1]);leg=[[s[2],s[1]],...p.slice(j+1)]}}
  webLegs=leg.length>1?[leg]:[];placeArrows()}
function routeStops(i,di){const r=R[i],d=r.d[di];map.getSource("hlstops").setData(FC(d.s.filter(id=>ST[id]).map(id=>({type:"Feature",properties:{c:r.c,id},geometry:{type:"Point",coordinates:[ST[id][2],ST[id][1]]}}))));
  return `<div class="tvnote" id="tvNote"></div>${mHeadHTML()}<ol class="stops" style="--rc:${r.c}" data-ri="${i}" data-di="${di}">`+d.s.map(id=>{const s=ST[id];return s?`<li data-s="${id}"><span class="tf"></span><span class="tv"></span><span class="tc"></span><span class="snm">${esc(s[0])}</span>${s[4]?`<span class="s2">${esc(s[4])}</span>`:""}</li>`:""}).join("")+"</ol>"}
// tapped dotted line / variant: which route, which trips, today's times
async function showVariant(rn,di,vi){const i=nameIdx[rn];if(i==null)return;const r=R[i];const d=r.d[di];
  if(!d||vi<0||!d.v||!d.v[vi]){showRoute(i,false);return}
  const v=d.v[vi];focusRoutes=new Set([i]);drawVehicles();backState=null;pBack.style.display="none";ctx=null;setSel(null);clearHL();
  const vp=dec(v.p);map.getSource("hl").setData(FC([{type:"Feature",properties:{c:r.c,ri:i,mode:"route"},geometry:{type:"LineString",coordinates:path(i,di)}}]));
  map.getSource("hlvar").setData(FC([{type:"Feature",properties:{c:r.c},geometry:{type:"LineString",coordinates:vp}}]));
  map.getSource("hlstops").setData(FC(v.x.filter(id=>ST[id]).map(id=>({type:"Feature",properties:{c:r.c,id},geometry:{type:"Point",coordinates:[ST[id][2],ST[id][1]]}}))));
  let bb=null;vp.forEach(([x,y])=>{bb=bb?[Math.min(bb[0],x),Math.min(bb[1],y),Math.max(bb[2],x),Math.max(bb[3],y)]:[x,y,x,y]});
  if(bb)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:14});
  const pct=d.nt?Math.round(100*v.n/(v.n+d.nt)):null;const pctT=pct==null?"":pct<1?"under 1% of trips in this direction":`about ${pct}% of trips in this direction`;const tl=r.t==="tram"?"G:link":r.t==="ferry"?"Ferry":"Bus";
  const h=`<div class="odhow">The dashed line shows a <b>variant</b> of route ${esc(r.n)}: some trips${(v.h||d.h)?" towards "+esc(v.h||d.h):""} leave the main route to serve ${v.x.length} extra stop${v.x.length>1?"s":""}${pctT?", "+pctT:""}. Other trips skip these stops, so check the times below.</div>
    <div class="webrow"><button class="btn" id="fullTT">Full timetable</button><button class="btn" id="mainRt">Main route</button></div>
    <div class="grp">When these trips run</div><div id="varWhen" class="odhow">Loading…</div><div class="grp">Today at ${esc(ST[v.x[0]]?ST[v.x[0]][0]:"the first extra stop")}</div><div id="varTimes" class="odhow">Loading…</div>
    <div class="grp">Extra stops on this variant</div><ol class="stops" style="--rc:${r.c}">${v.x.map(id=>ST[id]?`<li data-s="${id}">${esc(ST[id][0])}${ST[id][4]?`<span class="s2">${esc(ST[id][4])}</span>`:""}</li>`:"").join("")}</ol>`;
  openPanel(`${r.t==="tram"?"G:link":r.n} — ${r.l}`,`${tl} route · variant (some trips only)`,h,{star:{list:"routes",key:r.n}});wire();
  pB.querySelectorAll("ol.stops li[data-s]").forEach(li=>li.onclick=()=>openStop(li.dataset.s,true));
  rcState={key:r.n,i,di,vi,line:false};wireFullTT();document.getElementById("mainRt").onclick=()=>showRoute(i,false);
  const box=document.getElementById("varTimes");
  try{await ensureCal();const key=r.n;if(!RTC[key])RTC[key]=await (await fetch(BASE+"data/rt/"+key.replace(/[^A-Za-z0-9_-]/g,"_")+".json"+DV)).json();
    const data=RTC[key];const now=bneNow();let times=[];
    for(const k of Object.keys(data)){const j=data[k].o.indexOf(v.x[0]);if(j<0)continue;
      data[k].t.forEach(t=>{if(t[3+j]>=0&&t[1].some(si=>svcOn(si,now)))times.push(t[2]+t[3+j])})}
    times=[...new Set(times)].sort((a,b)=>a-b);const up=times.filter(m=>m>=now.min);
    if(!box.isConnected)return;
    // the pattern over the coming weeks (as far as the timetable goes): days, times, and until when
    {const wb=document.getElementById("varWhen");if(wb){const dow=new Set(),tms=new Map(),dates=[];let wk=0;
      for(let k=0;k<70;k++){const dd=shiftDay(now.ymd,now.dow,k);let any=false;
        for(const kk of Object.keys(data)){const j=data[kk].o.indexOf(v.x[0]);if(j<0)continue;data[kk].t.forEach(t=>{if(t[3+j]>=0&&t[1].some(si=>svcOn(si,dd))){any=true;const m=t[2]+t[3+j];tms.set(m,(tms.get(m)||0)+1);if(k<7)wk++}})}
        if(any){dow.add(dd.dow);dates.push(dd.ymd)}}
      const DN=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],ds=[...dow].sort();const dl=ds.length===7?"every day":ds.join()==="0,1,2,3,4"?"weekdays":ds.join()==="5,6"?"weekends":ds.map(x=>DN[x]).join(", ");
      const fd=y=>new Date(Date.UTC(+y.slice(0,4),+y.slice(4,6)-1,+y.slice(6,8))).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});
      const T=[...tms.keys()].sort((a,b)=>a-b),last=dates[dates.length-1],horizon=shiftDay(now.ymd,now.dow,62).ymd;
      wb.innerHTML=!dates.length?"No trips in the timetable for the next ten weeks.":`${T.length<=6?"At "+T.map(clock).join(", "):T.length+" times a day, from "+clock(T[0])+" to "+clock(T[T.length-1])}, ${dl}${dates[0]!==now.ymd?", from "+fd(dates[0]):""}${last<horizon?", until "+fd(last):""}${wk?` (${wk} trip${wk>1?"s":""} in the next 7 days)`:""}.`}}
    box.innerHTML=times.length?`${times.length} trip${times.length>1?"s":""} stop here today${up.length?`; next: ${up.slice(0,8).map(clock).join(", ")}${up.length>8?" …":""}`:"; none left today"}.`:"No trips stop here today. Open the full timetable and pick another day.";
  }catch(e){box.textContent="Timetable unavailable."}}
// live vehicle progress along the stop list: Departed / Arriving (within 500 m) / Not arrived
const stopKey=id=>ST[id]?id:(parentOf[id]||id);
const kmTo=(a,b)=>{const kx=111.32*Math.cos(a[1]*Math.PI/180);return Math.hypot((a[0]-b[0])*kx,(a[1]-b[1])*110.57)};
function headMatch(h,hint){if(!h||!hint)return false;const a=norm(h),b=norm(hint);return !!a&&!!b&&(a.includes(b)||b.includes(a))}
function dirByHead(i,hint,sid){const r=R[i];if(!hint)return -1;const ok=r.d.map((d,k)=>k).filter(k=>headMatch(r.d[k].h,hint));if(!ok.length)return -1;
  if(sid){const k=ok.find(k=>{const x=r.d[k].s.indexOf(sid);return x>=0&&x<r.d[k].s.length-1});if(k!=null)return k}return ok[0]}
function vehDir(i,v,hint){const r=R[i];const ns=v.stop&&stopKey(v.stop);
  const cand=r.d.map((d,k)=>k).filter(k=>ns&&r.d[k].s.indexOf(ns)>=0&&r.d[k].s.indexOf(ns)<r.d[k].s.length-1);
  if(cand.length>1&&hint){const h=cand.filter(k=>headMatch(r.d[k].h,hint));if(h.length===1)return h[0]}
  if(cand.length>1&&v.lon!=null){// the vehicle sits between the previous stop and its next stop: pick the direction where that's true
    const P=[0,v.lat,v.lon];let best=-1,bs=1e18;cand.forEach(k=>{const d=r.d[k],a=d.s.indexOf(ns);const prev=ST[d.s[a-1]],next=ST[d.s[a+1]];if(!prev&&!next)return;
      const sc=(prev?dist(P,prev):5e5)-(next?dist(P,next):5e5);if(sc<bs){bs=sc;best=k}});if(best>=0)return best}
  if(cand.length)return cand[0];return r.d.findIndex(d=>ns&&d.s.includes(ns))}
function applyVehStatus(){const ol=pB.querySelector("ol.stops[data-ri]");if(!ol)return;const lis=ol.querySelectorAll("li");
  const clear=()=>lis.forEach(li=>{li.classList.remove("done");const x=li.querySelector(".vst");if(x)x.remove()});
  if(!vehFocus||+ol.dataset.di!==vehFocus.di){clear();return}
  const v=LIVE.byTrip&&LIVE.byTrip.get(vehFocus.trip);if(!v){clear();return}
  const ids=[...lis].map(li=>li.dataset.s);let idx=v.stop?ids.indexOf(stopKey(v.stop)):-1;
  if(idx<0){let b=-1,bd=1e9;ids.forEach((id,j)=>{const s=ST[id];if(!s)return;const dd=kmTo([v.lon,v.lat],[s[2],s[1]]);if(dd<bd){bd=dd;b=j}});idx=b}
  lis.forEach((li,j)=>{const s=ST[ids[j]];let el=li.querySelector(".vst");if(!el){el=document.createElement("span");el.className="vst";li.insertBefore(el,(li.querySelector(".tc")||li.querySelector(".tv")).nextSibling)}
    let st="Not arrived",c="na";if(j<idx){st="Departed";c="dep"}else if(s&&kmTo([v.lon,v.lat],[s[2],s[1]])<=0.5){st="Arriving";c="arr"}
    el.textContent=st;el.className="vst "+c;li.classList.toggle("done",j<idx)})}
// which row of a route card is the stop or station the route was opened from (same stop, its platforms, or the same-named station nearby)
function originRow(ids){const o=backState&&backState.id;if(!o||!ST[o])return -1;const set=new Set([o,...(KIDS[o]||[])]);let j=ids.findIndex(x=>set.has(x));if(j>=0)return j;
  const base=ST[o][0].toLowerCase().replace(/,.*$/,"").replace(/ (busway |bus )?station$/,"").trim();
  return ids.findIndex(x=>{const s=ST[x];if(!s)return false;const n=s[0].toLowerCase().replace(/,.*$/,"").replace(/ (busway |bus )?station$/,"").trim();return n===base&&dist(s,ST[o])<400})}
// travel time from the first stop, from the next full-length trip in the route timetable
let tvKey=null;
// the route or line card on screen, so the full timetable can come back to it
let rcState=null;
function rtDirFor(key,i,di){const data=RTC[key];const d=R[i]&&R[i].d[di];if(!data||!d)return null;let best=null;
  for(const k of Object.keys(data)){const o=data[k].o;const pos=d.s.map(x=>o.indexOf(x)).filter(j=>j>=0);let sc=0;for(let n=1;n<pos.length;n++)sc+=pos[n]>pos[n-1]?1:-1;sc+=pos.length/1000;if(!best||sc>best.sc)best={sc,k}}return best&&best.k}
function wireFullTT(){const b=document.getElementById("fullTT");if(!b||!rcState)return;const rs={...rcState};
  b.onclick=async()=>{try{await ensureCal();if(!RTC[rs.key])RTC[rs.key]=await (await fetch(BASE+"data/rt/"+rs.key.replace(/[^A-Za-z0-9_-]/g,"_")+".json"+DV)).json()}catch(e){}
    const dir=rtDirFor(rs.key,rs.i,rs.di);openRouteTable(rs.key,dir?{dir}:null,{kind:"rcard",rs,prev:backState,cam:{center:map.getCenter(),zoom:map.getZoom()}})}}
function reopenCard(b){const rs=b.rs;if(rs.line)showLine(rs.key,false,null,null,{i:rs.i,k:rs.di});else if(rs.vi!=null)showVariant(rs.key,rs.di,rs.vi);else showRoute(rs.i,false,null,R[rs.i].d[rs.di]&&R[rs.i].d[rs.di].h);if(b.prev)setBack(b.prev)}
async function applyTravel(){const ol=pB.querySelector("ol.stops[data-ri]");if(!ol||!tvKey)return;const key=tvKey;const r=R[+ol.dataset.ri],d=r.d[+ol.dataset.di];if(!d)return;
  try{await ensureCal();if(!RTC[key])RTC[key]=await (await fetch(BASE+"data/rt/"+key.replace(/[^A-Za-z0-9_-]/g,"_")+".json"+DV)).json()}catch(e){return}
  // when following a vehicle, find its own scheduled run: start time, or one scheduled time from trip updates
  let sm=null,anc=null;if(vehFocus){const fv=LIVE.byTrip&&LIVE.byTrip.get(vehFocus.trip);if(fv&&fv.start)sm=fv.start;
    if(!sm){let tf=null;try{tf=await getTrips()}catch(e){}const tu=tf&&tf.entity.find(e=>e.tu&&e.tu.trip&&e.tu.trip.trip===vehFocus.trip);
      if(tu&&tu.tu.trip.start)sm=tu.tu.trip.start;else if(tu){const u=(tu.tu.stu||[]).find(u=>(u.dep||u.arr)&&(u.dep||u.arr).time);if(u){const ev=u.dep||u.arr;anc={sid:stopKey(u.stop),m:bneMin(ev.time-(ev.delay||0))}}}}}
  const smin=sm?(([h,m])=>(+h*60+ +m)%1440)(sm.split(":")):null;
  if(tvKey!==key||!ol.isConnected)return;const data=RTC[key],now=bneNow(),s0=d.s[0];let best=null;
  for(const k of Object.keys(data)){const o=data[k].o,ix=new Map(o.map((x,j)=>[x,j]));if(!ix.has(s0))continue;
    const idx=d.s.map(x=>ix.has(x)?ix.get(x):-1);if(idx[idx.length-1]>=0&&idx[idx.length-1]<idx[0])continue;
    const tr=data[k].t.map((t,row)=>{const a=t[3+idx[0]];if(a==null||a<0)return null;const cov=idx.filter(j=>j>=0&&t[3+j]>=0).length;return {t,row,k,dep:t[2]+a,cov,today:t[1].some(si=>svcOn(si,now))}}).filter(Boolean);
    if(!tr.length)continue;const mx=Math.max(...tr.map(x=>x.cov));const full=tr.filter(x=>x.cov>=mx*0.9);
    const ai=anc?data[k].o.indexOf(anc.sid):-1;
    const own=smin!=null?tr.filter(x=>x.t[2]%1440===smin).sort((a,b)=>b.today-a.today||b.cov-a.cov)[0]:ai>=0?tr.filter(x=>x.t[3+ai]>=0&&(x.t[2]+x.t[3+ai])%1440===anc.m).sort((a,b)=>b.today-a.today||b.cov-a.cov)[0]:null;if(own){if(!best||!best.own)best={...own,idx,own:true};continue}
    const pick=full.filter(x=>x.today&&x.dep>=now.min).sort((a,b)=>a.dep-b.dep)[0]||full.filter(x=>x.today).sort((a,b)=>a.dep-b.dep)[0]||full.sort((a,b)=>a.dep-b.dep)[0];
    if(!best||(!best.own&&pick.cov>best.cov))best={...pick,idx}}
  if(!best)return;const a0=best.t[3+best.idx[0]];const lis=ol.querySelectorAll("li");
  lis.forEach((li,n)=>{const j=best.idx[n];const v=j>=0?best.t[3+j]:-1;li.querySelector(".tv").textContent=n===0?"Start":v>=0?(v-a0)+" min":"";const tc=li.querySelector(".tc");if(tc)tc.textContent=v>=0?clock(best.t[2]+v):"—"});
  // the platform or stop letter this run uses at each stop (usual one per stop, unless this trip uses another)
  const pd=data[best.k]||{},px=(pd.px||{})[best.row]||{};
  lis.forEach((li,n)=>{const j=best.idx[n];let el=li.querySelector(".tpl");const pi=j>=0&&best.t[3+j]>=0?(px[j]!=null?px[j]:(pd.p||[])[j]):-1;const lab=pi!=null&&pi>=0?(TT.cal.pl||[])[pi]:"";
    if(!lab){if(el)el.remove();return}if(!el){el=document.createElement("span");el.className="tpl";const nm=li.querySelector(".snm");(nm||li).appendChild(el)}el.textContent=lab});
  // minutes from the stop or station this route was opened from
  const oj=originRow([...lis].map(li=>li.dataset.s));const ojv=oj>=0&&best.idx[oj]>=0?best.t[3+best.idx[oj]]:-1;ol.classList.toggle("hasfrom",ojv>=0);
  lis.forEach((li,n)=>{const tf=li.querySelector(".tf");if(!tf)return;li.classList.toggle("origin",ojv>=0&&n===oj);if(ojv<0||n<oj){tf.textContent="";return}const j=best.idx[n];const v=j>=0?best.t[3+j]:-1;tf.textContent=n===oj?"Here":v>=0?(v-ojv)+" min":""});
  const fromNm=ojv>=0?ST[lis[oj].dataset.s][0]:null;
  {const hd=document.getElementById("tvHead");if(hd){hd.style.display="";hd.classList.toggle("hasfrom",ojv>=0);mWireHead()}}
  const note=document.getElementById("tvNote");if(note)note.textContent=(best.own?`Scheduled times for this service (departs ${clock(best.dep)}) and minutes from its first stop.`:`Scheduled times and minutes from the first stop, based on ${best.today?(best.dep>=now.min?"the next trip, at ":"today's "):"the "}${clock(best.dep)} trip${best.today?"":" (not running today)"}. Times vary through the day.`)+(fromNm?` The blue column counts minutes from ${fromNm}.`:"");applyMeasured(ol,key,best,best.k)}
function variantHTML(i,di){const d=R[i].d[di];if(!d||!d.v||!d.v.length)return "";
  return `<div class="grp">Some trips also run via</div>`+d.v.map((v,k)=>{const pct=d.nt?Math.round(100*v.n/(v.n+d.nt)):null;
    return `<div class="varbox"><div class="varh"><a href="#" data-var="${i},${di},${k}">${esc(v.x.length)} extra stop${v.x.length>1?"s":""}${v.h&&v.h!==d.h?" · to "+esc(v.h):""}</a>${pct!=null?`<span class="varpct">${pct<1?"under 1% of trips":`about ${pct}% of trips`}</span>`:""}</div>
      <div class="varst">${v.x.slice(0,6).map(id=>ST[id]?`<a data-s2="${id}">${esc(ST[id][0])}</a>`:"").join(" · ")}${v.x.length>6?` · and ${v.x.length-6} more`:""}</div></div>`}).join("")}
function drawVariants(i,di){const d=R[i].d[di];map.getSource("hlvar").setData(FC(d&&d.v?d.v.map(v=>({type:"Feature",properties:{c:R[i].c},geometry:{type:"LineString",coordinates:dec(v.p)}})):[]))}
function routeBody(i,di){const r=R[i];const dirs=r.d.length>1?`<div class="dirs">${r.d.map((d,k)=>`<button data-d="${k}" class="${k===di?"on":""}">To ${esc(d.h||("direction "+(k+1)))}</button>`).join("")}</div>`:(r.d[0]&&r.d[0].h?`<div class="sub" style="margin-bottom:8px">To ${esc(r.d[0].h)}</div>`:"");
  return dirs+`<div class="grp">${r.d[di]?r.d[di].s.length:0} stops</div>`+routeStops(i,di)+variantHTML(i,di)}
function wireDirs(i){pB.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{const di=+b.dataset.d;if(typeof TRK!=="undefined"&&TRK)trkStop();const keepWeb=pB.querySelector(".webrow"),keepTop=pB.querySelector(".badges.svc"),keepG=keepTop&&keepTop.previousElementSibling&&keepTop.previousElementSibling.classList.contains("grp")?keepTop.previousElementSibling:null;
    pB.innerHTML=(keepWeb?keepWeb.outerHTML:"")+(keepG?keepG.outerHTML:"")+(keepTop?keepTop.outerHTML:"")+routeBody(i,di);if(rcState){rcState.i=i;rcState.di=di}wireFullTT();wire();wireDirs(i);routeArrows(i,di);drawVariants(i,di);applyTravel();applyVehStatus()})}
function rememberStop(fromStop){if(fromStop&&ctx){backState={id:ctx.id,web:ctx.web,cam:{center:map.getCenter(),zoom:map.getZoom()}};pBack.style.display="block"}else{backState=null;pBack.style.display="none"}}
function drawPaths(ids,col){const f=[];let bb=null;ids.forEach(i=>R[i].d.forEach((d,di)=>{const p=path(i,di);f.push({type:"Feature",properties:{c:col||R[i].c,ri:i,mode:"route"},geometry:{type:"LineString",coordinates:p}});p.forEach(([x,y])=>{bb=bb?[Math.min(bb[0],x),Math.min(bb[1],y),Math.max(bb[2],x),Math.max(bb[3],y)]:[x,y,x,y]})}));
  webLegs=[];map.getSource("hlvar").setData(FC([]));map.getSource("hl").setData(FC(f));map.getSource("arrows").setData(FC([]));map.getSource("ends").setData(FC([]));if(bb)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:15})}
function showRoute(i,fromStop,veh,hint){focusRoutes=new Set([i]);drawVehicles();const keep=fromStop?ctx:null;rememberStop(fromStop);ctx=null;setSel(null);const r=R[i];drawPaths([i]);
  const tl=r.t==="tram"?"G:link light rail":r.t==="ferry"?"Ferry":r.t==="train"?"Train":"Bus";
  let di0=0;const hk=hint&&r.d.length>1?dirByHead(i,hint,backState&&backState.id):-1;if(veh){const k=vehDir(i,veh,hint);if(k>=0)di0=k;if(hk>=0&&k!==hk){di0=hk;veh=null}}else if(hk>=0)di0=hk;else if(backState&&r.d.length>1){const k=r.d.findIndex(d=>{const x=d.s.indexOf(backState.id);return x>=0&&x<d.s.length-1});if(k>=0)di0=k}
  openPanel(`${r.t==="tram"?"G:link":r.n} — ${r.l}`,`${tl} route`+(veh&&veh.fleet?` · <b>${r.t==="ferry"?"Vessel":"Fleet number"} ${esc(veh.fleet)}</b>`:""),`<div class="webrow"><button class="btn" id="fullTT">Full timetable</button><button class="btn" id="trkBtn" data-ri="${i}" title="Follow one ${r.t==="ferry"?"ferry":r.t==="tram"?"tram":"bus"} on this route live on the map">📍 Track live</button></div><div id="trkBox"></div>`+routeBody(i,di0),{star:{list:"routes",key:r.n},veh:veh?{ri:i,di:di0,trip:veh.trip}:null});
  rcState={key:r.n,i,di:di0,line:false};if(/^rail replacement bus$/i.test(r.l||"")&&typeof rbRouteBanner==="function"){pB.insertAdjacentHTML("afterbegin",rbRouteBanner(r.n));rbWireNotes();requestAnimationFrame(()=>{pB.scrollTop=0})}wireFullTT();tvKey=r.n;drawVariants(i,di0);applyTravel();applyVehStatus();insertAlerts([],[i]);wireDirs(i);routeArrows(i,di0);if(backState)pBack.style.display="block"}
// on a train line, the route and direction that runs towards the tapped row's destination from the station the card was opened from
function lineDirFor(nm,hint,sid){if(!hint||!sid||!ST[sid])return null;const all=lineRoutes[nm]||[];const base=x=>ST[x]?ST[x][0].toLowerCase().replace(/,.*$/,"").replace(/ (busway |bus )?station$/,"").trim():"";const b0=base(sid);
  const ids=new Set([sid,...(KIDS[sid]||[])]);let best=null;
  all.forEach(i=>R[i].d.forEach((d,k)=>{if(!headMatch(d.h,hint))return;const a=d.s.findIndex(x=>ids.has(x)||(base(x)===b0&&dist(ST[x],ST[sid])<400));if(a<0||a>=d.s.length-1)return;
    const sc=(ownLine(nm,i)?0:100)-d.s.length/1000;if(!best||sc<best.sc)best={sc,i,k}}));return best}
function showLine(nm,fromStop,veh,hint,force){focusRoutes=new Set(lineRoutes[nm]||[]);drawVehicles();rememberStop(fromStop);ctx=null;setSel(null);const all=lineRoutes[nm]||[];const own=all.filter(i=>ownLine(nm,i));const ids=own.length?own:all;const ld=hint&&backState?lineDirFor(nm,hint,backState.id):null;if(ld&&veh&&veh.ri!==ld.i)veh=null;const main=force?force.i:ld?ld.i:veh&&R[veh.ri]&&R[veh.ri].t==="train"?veh.ri:lineMain(nm);drawPaths(ids,TCOL[nm]);
  const other=ids.filter(i=>i!==main);let vdi=force?force.k:ld?ld.k:veh?Math.max(0,vehDir(main,veh,hint)):0;{const hk=!force&&hint&&R[main].d.length>1?dirByHead(main,hint,backState&&backState.id):-1;if(hk>=0&&(!veh||vdi!==hk)){vdi=hk;veh=null}}let h=routeBody(main,vdi);
  if(other.length)h=`<div class="grp">Services on this line</div><div class="badges svc" style="margin-bottom:8px">${other.slice(0,14).map(i=>badge(i,R[i].l)).join("")}</div>`+h;
  openPanel(`${nm} ${TNAME[nm]}`,`Train line`+(veh&&veh.fleet?` · <b>Service number ${esc(veh.fleet)}</b>`:""),`<div class="webrow"><button class="btn" id="fullTT">Full timetable</button></div>`+h,{star:{list:"routes",key:nm},veh:veh?{ri:main,di:vdi,trip:veh.trip}:null});
  rcState={key:nm,i:main,di:vdi,line:true};wireFullTT();tvKey=nm;applyTravel();applyVehStatus();insertAlerts([],ids);wireDirs(main);routeArrows(main,vdi);if(backState)pBack.style.display="block"}

// ---------- live data (via relay)
let rtFocus=false,view="",rtState=null;
function syncVehVis(){setGroup("live",chipState.live==="on"||rtFocus);drawVehicles()}
const nameIdx={};R.forEach((r,i)=>{nameIdx[r.n]=i});
const riOfRoute=id=>{if(!id)return -1;const n=id.replace(/-\d+$/,"");return n in nameIdx?nameIdx[n]:-1};
const LIVE={veh:[],vehAt:0,trips:null,tripsAt:0,alerts:[],alertsAt:0};
async function getFeed(name){const r=await fetch(RELAY+"/"+name,{cache:"no-store"});if(!r.ok)throw new Error(name+" "+r.status);return decodeGTFSRT(await r.arrayBuffer())}
function drawVehicles(){if(!map.getSource("veh"))return;const f=[];const now=Date.now()/1000;
  const liveOn=chipState.live==="on";
  for(const v of LIVE.veh){if(TRK){if(v.ri!==TRK.ri||(v.trip!==TRK.trip&&vehDir(v.ri,v)!==TRK.di))continue}else if(!liveOn&&!(rtFocus&&focusRoutes&&focusRoutes.has(v.ri)))continue;const r=R[v.ri];const dim=TRK?false:!!(focusRoutes&&!focusRoutes.has(v.ri));const lab=r.t==="train"?(lineOf[v.ri]||["T"])[0]:r.t==="tram"?"G":r.n;
    f.push({type:"Feature",properties:{trip:v.trip,trk:TRK&&v.trip===TRK.trip?1:0,lv:TRK?1:0,c:r.c,tc:r.t==="train"&&/T2|T5/.test(lab)?"#111":(r.tc||"#fff"),n:lab,ri:v.ri,dim,tip:`${r.t==="train"?lab+" "+TNAME[lab]:r.t==="tram"?"G:link":r.n+" "+r.l} · updated ${Math.max(0,Math.round(now-v.ts))} s ago`},geometry:{type:"Point",coordinates:[v.lon,v.lat]}})}
  if(focusRoutes)f.sort((a,b)=>a.properties.dim-b.properties.dim).reverse();
  map.getSource("veh").setData(FC(f))}
async function pollVehicles(force){if(!force&&document.hidden||!force&&(map.getLayoutProperty("veh-dot","visibility")==="none"&&!(panel.style.display!=="none"&&(view==="rt"||view==="favs"||vehFocus||ctx))))return;
  try{const d=await getFeed("vehicles");LIVE.veh=d.entity.filter(e=>e.vp&&e.vp.pos&&e.vp.trip).map(e=>({ri:riOfRoute(e.vp.trip.route),trip:e.vp.trip.trip,dir:e.vp.trip.dir,stop:e.vp.stop,fleet:(e.vp.veh&&e.vp.veh.label)||"",start:e.vp.trip.start||"",lat:e.vp.pos.lat,lon:e.vp.pos.lon,ts:e.vp.ts||d.header.ts})).filter(v=>v.ri>=0);LIVE.vehAt=Date.now();LIVE.byTrip=new Map(LIVE.veh.map(v=>[v.trip,v]));drawVehicles();if(view==="rt"&&rtState)renderRTLive();if(vehFocus)applyVehStatus();if(ctx&&ctx.rows&&ctx.id)applyLive(ctx.id);if(typeof TRK!=="undefined"&&TRK)trkFollow()}catch(e){console.warn(e)}}
let vehFocus=null;
const fleetOf=trip=>{const v=LIVE.byTrip&&LIVE.byTrip.get(trip);return v&&v.fleet?v.fleet:""};
const fleetWord=ri=>{const t=R[ri]&&R[ri].t;return t==="train"?"Service":t==="tram"?"Tram":t==="ferry"?"Ferry":"Bus"};
async function getTrips(){if(LIVE.trips&&Date.now()-LIVE.tripsAt<25000)return LIVE.trips;const d=await getFeed("trips");LIVE.trips=d;LIVE.tripsAt=Date.now();return d}
const bneMin=sec=>Math.floor(((sec+36000)%86400)/60);
function computeLive(id,rows,d){const ids=new Set(ctx&&ctx.id===id&&ctx.liveIds?ctx.liveIds:[id,...(KIDS[id]||[])]);const preds=[];const nowS=Date.now()/1000;
  for(const e of d.entity){const tu=e.tu;if(!tu||!tu.stu)continue;const ri=riOfRoute(tu.trip&&tu.trip.route);if(ri<0)continue;const tripCx=tu.trip.sr===3;
    for(const u of tu.stu){if(!ids.has(u.stop))continue;const ev=u.dep||u.arr;if(!ev||!ev.time)continue;const delay=ev.delay||0;preds.push({ri,trip:tu.trip.trip,st:tu.trip.start||"",dir:tu.trip.dir,lpl:(TT.cal.plid||{})[u.stop],pred:ev.time,sched:bneMin(ev.time-delay),delay,cx:tripCx||u.sr===1})}}
  LIVE.here=new Map();preds.forEach(x=>{if(!LIVE.here.has(x.trip))LIVE.here.set(x.trip,x.sched)});
  return rows.map(row=>{if(!row.up.length)return null;const same=p=>row.kind==="train"?lineAt(p.ri,id)===row.line:p.ri===row.ri;
    const t0=row.up[0]%1440;const p=preds.find(x=>same(x)&&x.sched===t0);if(!p)return null;
    if(p.cx)return {cls:"nx cx",html:"Cancelled",title:"Cancelled"};
    const mins=Math.round((p.pred-nowS)/60);const late=p.delay>=120,early=p.delay<=-60;
    const lp=p.lpl!=null?(TT.cal.pl||[])[p.lpl]:null;
    let vt=vehForTrip(p);if(!vt&&mins<=30){const u=upstreamRow(row);if(u&&!preds.some(x=>x.trip===u.trip&&x!==p))vt=u.trip}   // a bus already predicted for another departure here isn't this one
    // no vehicle running this trip yet: Translink's figure is an estimate from the timetable, not a tracked bus
    // no vehicle on this trip yet: show Translink's prediction, grey (orange when it predicts 2+ min late), marked Not assigned
    if(LIVE.byTrip&&!(vt&&LIVE.byTrip.get(vt)))return {trip:p.trip,lpl:lp,cls:"nx est"+(late?" late":""),title:`Not assigned: no ${fleetWord(p.ri).toLowerCase()} is running this trip yet; this is Translink's prediction${late?`, ${Math.round(p.delay/60)} min late`:""} (scheduled ${clock(row.up[0])}). Turns green once one is.`,
      html:`<i class="ld"></i>${mins<=0?"Now":mins<60?mins+" min":clock(bneMin(p.pred))}`+(late?`<small>+${Math.round(p.delay/60)}</small>`:"")+`<small class="fln">Not assigned</small>`};
    return {trip:vt||p.trip,lpl:lp,cls:"nx "+(late?"late":"live"),title:late?`${Math.round(p.delay/60)} min late (scheduled ${clock(row.up[0])})`:early?`${Math.round(-p.delay/60)} min early`:"On time (live)",
      html:`<i class="ld"></i>${mins<=0?"Now":mins<60?mins+" min":clock(bneMin(p.pred))}`+(late?`<small>+${Math.round(p.delay/60)}</small>`:"")+((fl=>fl&&R[p.ri].t!=="train"?`<small class="fln">${fleetWord(p.ri)} ${esc(fl)}</small>`:"")(fleetOf(vt||p.trip)))}})}
async function applyLive(id){const box=document.getElementById("ttBox");if(!box||!ctx||ctx.id!==id||!ctx.rows)return;let d;if(!LIVE.vehAt&&!applyLive.p){applyLive.p=1;pollVehicles()}
  try{d=await getTrips()}catch(e){return}
  if(!ctx||ctx.id!==id)return;computeLive(id,ctx.rows,d).forEach((v,k)=>{const cell=box.querySelector(`[data-live="${k}"]`);if(!cell||!v)return;cell.className=v.cls;cell.innerHTML=v.html;cell.title=v.title;if(v.trip)cell.dataset.trip=v.trip;else delete cell.dataset.trip;livePlat(box,k,v)})}
function livePlat(box,k,v){const el=box.querySelector(`[data-plat="${k}"]`);if(!el||!v||!v.lpl)return;if(!el.dataset.sch)el.dataset.sch=el.textContent;
  if(v.lpl!==el.dataset.sch){el.textContent="Now "+v.lpl.charAt(0).toLowerCase()+v.lpl.slice(1);el.classList.add("chg");el.title="Changed from "+el.dataset.sch}else{el.textContent=v.lpl;el.classList.remove("chg");el.title=""}}
// alerts
async function pollAlerts(){try{const d=await getFeed("alerts");const now=Date.now()/1000;
  LIVE.alerts=d.entity.filter(e=>e.al&&e.al.header).map(e=>e.al);LIVE.alertsAt=Date.now();updateAlertBtn();pjAlertsChanged();if(typeof applyFavStatus==="function")applyFavStatus()}catch(e){console.warn(e)}}
const fmtDay=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"});
function todaysAlerts(){const now=Date.now()/1000;const bneMid=Math.floor((now+36000)/86400)*86400-36000,end=bneMid+86400;
  return LIVE.alerts.filter(a=>!a.periods||!a.periods.length||a.periods.some(p=>(p.start||0)<end&&(!p.end||p.end>bneMid)))}
function updateAlertBtn(){const b=document.getElementById("alertBtn");if(!b)return;const n=todaysAlerts().length;b.textContent="⚠ Alerts"+(n?" ("+n+")":"");b.classList.toggle("has",n>0)}
const EFFECT={1:"No service",2:"Reduced service",3:"Significant delays",4:"Detour",5:"Additional service",6:"Modified service",7:"Other",8:"Other",9:"Stop moved",10:"Information",11:"Accessibility"};
const DISRUPT=new Set([3,4,5,6,8,11,12]),PLANNED=new Set([9,10]);
const parentOf={};for(const [p,ks] of Object.entries(KIDS))ks.forEach(k=>parentOf[k]=p);
// Translink station locality maps (data/locality.json, matched to stations by tools/build_locality.py each week)
let LOC={};fetch(BASE+"data/locality.json"+DV).then(r=>r.json()).then(d=>{LOC=d.maps||{}}).catch(()=>{});
// ---------- station accessibility (data/access.json, weekly from Queensland Rail's station details) and lift outages
// (today's Translink service alerts about lifts). The OpenStreetMap lifts in the same file go to the walking routes.
let ACC={st:{},lifts:[]};
fetch(BASE+"data/access.json"+DV).then(r=>r.json()).then(d=>{ACC=d;window.__LIFTS=d.lifts||[];if(window.walkSetLifts)walkSetLifts(window.__LIFTS)}).catch(()=>{});
const accOf=id=>ACC.st[id]||ACC.st[parentOf[id]]||null;
const ACC_LVL={independent:"Independent access",assisted:"Assisted access",limited:"Limited access"};
const LIFT_RE=/\b(lifts?|elevators?)\b/i,LIFT_OUT=/out of (service|order)|unavailable|not (available|operating|working|in service)|closed|closure|outage|maintenance|repair|replace|upgrade|fault|offline/i;
function liftOutages(){const out=new Map();let al=[];try{al=todaysAlerts()}catch(e){}
  for(const a of al){const txt=(a.header||"")+" "+(a.desc||"");if(!LIFT_RE.test(txt)||!LIFT_OUT.test(txt))continue;const ids=new Set();
    for(const x of alertStops(a)){const p=ST[x]?x:parentOf[x];if(p&&ST[p])ids.add(p)}
    if(!ids.size)for(const [sid,v] of Object.entries(ACC.st))if(new RegExp("\\b"+v.n.replace(/[^\w ]/g,"").trim()+"( railway)? station\\b","i").test(txt))ids.add(sid);
    ids.forEach(i=>{if(!out.has(i))out.set(i,[]);out.get(i).push(a)})}
  return out}
// Lift outages that cut off platforms, for Journey Search with Avoid steps on. An alert naming platforms ("platform 3",
// "platforms 5/6") blocks just those; one about a car park, entrance, footbridge or street-to-concourse lift blocks
// nothing (another way in usually stays step-free); any other lift outage at a station blocks the whole station.
const LIFT_PART=/car ?park|entr(y|ance)|footbridge|overpass|concourse|street level|\b(st|street|rd|road)\b to /i;
function liftBlocks(){const out=new Map();
  for(const [sid,als] of liftOutages())for(const a of als){const hd=a.header||"",txt=hd+" "+(a.desc||"");
    const m=txt.match(/platforms?\s+(\d+[a-z]?(?:\s*(?:\/|,|&|and)\s*\d+[a-z]?)*)/i);
    const b=out.get(sid)||{all:false,plats:new Set(),nm:ST[sid]?shortName(ST[sid][0]):sid};
    if(m)m[1].split(/\s*(?:\/|,|&|and)\s*/i).forEach(x=>x&&b.plats.add(x.toLowerCase()));else if(!LIFT_PART.test(hd))b.all=true;else continue;
    out.set(sid,b)}
  return out}
const plCode=lab=>String(lab||"").replace(/^(platform|stop|bay)\s*/i,"").trim().toLowerCase();
const liftHits=(b,lab)=>!!b&&(b.all||[...b.plats].some(x=>{const c=plCode(lab);return c===x||(c.startsWith(x)&&/^[a-z]$/.test(c.slice(x.length)))}));
// Brisbane City Council's bus stop accessibility audit: [stop type, boarding point, road gradient, cross fall, tactile, audited]
const BS_R={E:["Easy","independent"],M:["Medium","assisted"],H:["Hard","limited"]};
function busAccHTML(id){const b=(ACC.bs||{})[id];if(!b)return "";const [typ,bp,gr,cf,tac,aud]=b;const r=x=>BS_R[x]?BS_R[x][0]:"not rated";
  const audT=aud?new Date(aud+"T00:00:00+10:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric",timeZone:"Australia/Brisbane"}):"";
  return `<details class="acc"><summary><span class="acci" aria-hidden="true">♿</span> <b>Accessibility</b>${BS_R[bp]?` <span class="accl ${BS_R[bp][1]}">Boarding point: ${BS_R[bp][0]}</span>`:""}</summary><div class="accb">
    <table class="acct"><tr><th>Boarding point</th><td>${r(bp)}</td></tr><tr><th>Slope along the road</th><td>${r(gr)}</td></tr><tr><th>Sideways slope (cross fall)</th><td>${r(cf)}</td></tr><tr><th>Tactile ground indicators</th><td>${tac==null?"not recorded":tac?"Yes":"No"}</td></tr>${typ?`<tr><th>Stop type</th><td>${esc(typ)}</td></tr>`:""}<tr><th>Last audited</th><td>${audT||"not recorded"}</td></tr></table>
    <div class="odnote">From Brisbane City Council's bus stop accessibility audit (Brisbane City Council open data, CC BY 4.0), checked weekly; ratings are the council's own, and some audits are several years old. Stops outside the Brisbane City Council area aren't covered.</div></div></details>`}
function accHTML(id){const a=accOf(id),outs=liftOutages().get(id)||liftOutages().get(parentOf[id])||[];if(!a&&!outs.length)return busAccHTML(id);
  let h=`<details class="acc"${outs.length?" open":""}><summary><span class="acci" aria-hidden="true">♿</span> <b>Accessibility</b>${a&&a.lvl?` <span class="accl ${a.lvl}">${ACC_LVL[a.lvl]}</span>`:""}${outs.length?` <span class="accout">⚠ Lift out of service</span>`:a&&a.f.includes("Lift")?` <span class="accn">Lift</span>`:""}</summary><div class="accb">`;
  outs.forEach(al=>{h+=`<div class="odwarn"><p><b>${esc(al.header||"Lift notice")}</b>${al.desc?"<br>"+esc(al.desc).slice(0,500):""}${al.url?` <a href="${esc(al.url)}" target="_blank" rel="noopener">More ↗</a>`:""}</p></div>`});
  if(a){if(a.f.length)h+=`<div class="accf">${a.f.map(f=>`<span>${esc(f)}</span>`).join("")}</div>`;
    if(a.plat.length)h+=`<ul class="pjf">${a.plat.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`;
    const lk=[a.map&&[a.map,"Station access map"],a.pdf&&[a.pdf,"Printable map (PDF)"],a.audio&&[a.audio,"Audio description"],["https://www.queenslandrail.com.au/forcustomers/stations-and-maps/stationfinder","Queensland Rail station finder"]].filter(Boolean);
    h+=`<div class="accln">${lk.map(([u,t])=>`<a href="${esc(u)}" target="_blank" rel="noopener">${t} ↗</a>`).join("")}</div>`;
    h+=`<div class="odnote">From Queensland Rail's station information${ACC.checked?", checked "+esc(ACC.checked):""}. The access level is Queensland Rail's own rating. Lift outages come from today's Translink service alerts; for help, call Queensland Rail on <a href="tel:131617">13 16 17</a>.</div>`}
  else h+=`<div class="odnote">Lift notice from today's Translink service alerts.</div>`;
  return h+`</div></details>`}
// stations on a journey that aren't rated independent access, or have a lift out of service
function accJourneyTags(o,d){const seen=new Set(),tags=[];const outs=liftOutages(),LB=liftBlocks();
  for(const l of o.legs){if(l.type!=="ride")continue;const p=d.p[l.pi];for(const [k,pos] of [[l.from,l.bpos],[l.to,l.apos]]){const id=d.s[k];if(!id||seen.has(id))continue;const a=accOf(id);const nm=ST[id]?shortName(ST[id][0]):id;
    // an outage on another platform of this station doesn't affect this journey
    const b=LB.get(id);const lab=p&&p.pl[pos]>=0?(TT.cal.pl||[])[p.pl[pos]]:"";const other=b&&!b.all&&b.plats.size&&!liftHits(b,lab);seen.add(id);
    if(!other&&!o.notSF&&(outs.has(id)||outs.has(parentOf[id])))tags.push(`<span class="cnt cnacc out" title="Translink has posted a lift outage for this station today">Lift out: ${esc(nm)}</span>`);
    const bb=(ACC.bs||{})[id];if(bb&&bb[1]==="H")tags.push(`<span class="cnt cnacc limited" title="Brisbane City Council rates the boarding point at this stop hard; see the stop card for details">Hard boarding: ${esc(nm)}</span>`);
    if(a&&a.lvl&&a.lvl!=="independent")tags.push(`<span class="cnt cnacc ${a.lvl}" title="Queensland Rail rates this station ${ACC_LVL[a.lvl].toLowerCase()}; see the station card for details">${ACC_LVL[a.lvl]}: ${esc(nm)}</span>`)}}
  if(o.legs.some(l=>l.route&&l.route.elev))tags.push(`<span class="cnt cnacc lift" title="A walk in this journey uses a lift (from OpenStreetMap)">Uses a lift</span>`);
  return tags.join("")}
function locBtns(id){const seen=new Set(),out=[];[id,parentOf[id],...(KIDS[id]||[])].forEach(k=>(k&&LOC[k]||[]).forEach(([t,u])=>{if(!seen.has(u)){seen.add(u);out.push([t,u])}}));
  return out.map(([t,u])=>`<a class="btn" href="${esc(u)}" target="_blank" rel="noopener" title="Translink's locality map for ${esc(t)} (opens in a new tab)">${out.length>1?esc(t)+" map":"Locality map"} ↗</a>`).join("")}
function alertTags(a){const nowS=Date.now()/1000,mid=Math.floor((nowS+36000)/86400)*86400-36000,eod=mid+86400;const ps=a.periods||[];
  const cur=ps.find(p=>(p.start||0)<=nowS&&(!p.end||p.end>=nowS));const span=p=>p?((p.end||nowS+1e8)-(p.start||0)):0;
  let timing;if(cur)timing=(span(cur)>7*86400||(cur.start&&nowS-cur.start>7*86400))?"Ongoing":"Now";else timing=ps.some(p=>(p.start||0)>nowS&&(p.start||0)<eod)?"Later today":"Ongoing";
  const modes=new Set(),where=new Set();const sel=a.sel||[];
  for(const x of sel){if(x.route){const ri=riOfRoute(x.route);if(ri>=0){const t=R[ri].t;modes.add(t);where.add(t==="train"?"Train line":t==="bus"?"Bus route":t==="ferry"?"Ferry route":"Tram line")}}
    if(x.stop){const id=ST[x.stop]?x.stop:parentOf[x.stop];const k=id&&ST[id]?ST[id][3]:null;
      if(k==="train"){modes.add("train");where.add("Station")}else if(k==="busway"||k==="busstn"){modes.add("bus");where.add("Station")}
      else if(k==="ferry"){modes.add("ferry");where.add("Station")}else if(k==="tram"){modes.add("tram");where.add("Tram stop")}else if(k==="bus"){modes.add("bus");where.add("Bus stop")}}}
  const h=a.header||"";if(/\bstation\b|lift|escalator|platform/i.test(h)&&where.has("Bus stop")&&!/bus stop/i.test(h)){where.delete("Bus stop");where.add("Station")}
  if(/\bline\b|track/i.test(h))modes.add("train");if(/\btram\b|g:link/i.test(h))modes.add("tram");if(/ferry/i.test(h))modes.add("ferry");
  const kind=DISRUPT.has(a.cause)||a.effect===3||/cancel/i.test(a.header||"")?"Disruption":PLANNED.has(a.cause)?"Planned works":null;
  const M={train:"Train",bus:"Bus",ferry:"Ferry",tram:"Tram"};
  return {timing,type:EFFECT[a.effect]||"Other",modes:["train","bus","ferry","tram"].filter(m=>modes.has(m)).map(m=>M[m]),where:["Station","Train line","Bus route","Ferry route","Tram line","Bus stop","Tram stop"].filter(w=>where.has(w)),kind}}
let alertFilter="All";
function showAllAlerts(){focusRoutes=null;drawVehicles();backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);
  const all=todaysAlerts().map(a=>({a,t:alertTags(a)}));const tord={"Now":0,"Later today":1,"Ongoing":2};
  all.sort((x,y)=>tord[x.t.timing]-tord[y.t.timing]||((x.a.periods||[{}])[0].start||0)-((y.a.periods||[{}])[0].start||0));
  const LR=new Set(["Train line","Bus route","Ferry route","Tram line"]),SS=new Set(["Station","Bus stop","Tram stop"]);
  const SC=new Set(["Modified service","Information","Additional service","Detour"]);
  const tagsOf=o=>[o.t.timing,SC.has(o.t.type)?"Service changes/information":o.t.type,...o.t.modes,...o.t.where,o.t.kind,o.t.where.some(w=>LR.has(w))?"Lines/Routes":null,o.t.where.some(w=>SS.has(w))?"Stops/Stations":null].filter(Boolean);
  const count=c=>c==="All"?all.length:all.filter(o=>tagsOf(o).includes(c)).length;
  const types=[...new Set(all.map(o=>SC.has(o.t.type)?"Service changes/information":o.t.type))].sort((x,y)=>count(y)-count(x));
  const cats=["All",...types,"Lines/Routes","Stops/Stations","Disruption","Planned works"].filter((c,i,arr)=>arr.indexOf(c)===i&&count(c)>0);
  if(!cats.includes(alertFilter))alertFilter="All";
  const nowS=Date.now()/1000,mid=Math.floor((nowS+36000)/86400)*86400-36000,eod=mid+86400;
  const per=a=>{const ps=a.periods||[];return ps.find(p=>(p.start||0)<=nowS&&(!p.end||p.end>=nowS))||ps.find(p=>(p.start||0)<eod&&(!p.end||p.end>mid))||ps[0]};
  const pill=(t,cls)=>`<span class="atag ${cls}">${esc(t)}</span>`;
  const list=all.filter(o=>alertFilter==="All"||tagsOf(o).includes(alertFilter));
  const body=!list.length?`<div class="sub">No service alerts in this category today.</div>`:list.map(({a,t})=>{const rs=[...new Set((a.sel||[]).map(x=>riOfRoute(x.route)).filter(i=>i>=0))].sort((x,y)=>cmpRoute(R[x].n,R[y].n));
    const ss=[...new Set((a.sel||[]).map(x=>x.stop).filter(Boolean).map(x=>ST[x]?x:parentOf[x]).filter(Boolean))];const p=per(a);
    const lines=[...new Set(rs.filter(i=>R[i].t==="train").map(i=>(lineOf[i]||[])[0]).filter(Boolean))].sort((x,y)=>LINE_ORDER.indexOf(x)-LINE_ORDER.indexOf(y));
    const tags=pill(t.timing,"t-"+t.timing.replace(/\s/g,"").toLowerCase())+t.modes.map(m=>pill(m,"m")).join("")+t.where.map(w=>pill(w,"w")).join("")+(t.kind?pill(t.kind,t.kind==="Disruption"?"dis":"pl"):"");
    return `<details class="alcard"><summary><b>${esc(a.header)}</b><div class="atags">${tags}<span class="atype">${esc(t.type)}</span></div>${p&&(p.start||p.end)?`<span class="when">${p.start?fmtDay.format(p.start*1000):""}${p.end?" – "+fmtDay.format(p.end*1000):""}</span>`:""}</summary>`+
      (lines.length||rs.length?`<div class="badges" style="margin:6px 0">${lines.map(lineBadge).join("")}${rs.filter(i=>R[i].t!=="train").slice(0,30).map(i=>badge(i,R[i].t==="tram"?"G:link":R[i].n)).join("")}</div>`:"")+
      (ss.length?`<div class="alstops">${ss.slice(0,12).map(x=>`<span class="near" data-near="${x}">${esc(ST[x][0])}</span>`).join(" · ")}</div>`:"")+
      (a.desc?`<p>${esc(a.desc).slice(0,1500)}</p>`:"")+(a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">More information</a>`:"")+`</details>`}).join("");
  const chips=`<div class="acats">`+cats.map(c=>`<button class="acat${c===alertFilter?" on":""}" data-cat="${esc(c)}">${esc(c)} <span>${count(c)}</span></button>`).join("")+`</div>`;
  openPanel("Service alerts",`${all.length} posted for today · Translink`,chips+`<div class="alist">${body}</div>`,{view:"alerts"});
  pB.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{alertFilter=(alertFilter===b.dataset.cat&&b.dataset.cat!=="All")?"All":b.dataset.cat;const sc=pB.querySelector(".acats").scrollLeft;showAllAlerts();const n=pB.querySelector(".acats");if(n)n.scrollLeft=sc})}
function activeNow(a){const now=Date.now()/1000;return !a.periods||!a.periods.length||a.periods.some(p=>(!p.start||p.start<=now)&&(!p.end||now<=p.end))}
// ---------- which stations/stops an alert touches (stop -> its station; park 'n' ride -> stations within 500 m)
const PNR_ST=(()=>{const out={};const sts=Object.entries(ST).filter(([,s])=>["train","busway","busstn","ferry","tram"].includes(s[3]));
  const km=(a,b)=>Math.hypot((a[2]-b[2])*98.7,(a[1]-b[1])*110.6);
  for(const [id,s] of Object.entries(ST)){if(!/park\s*'?n'?\s*ride/i.test(s[0]))continue;const near=sts.filter(([,t])=>km(s,t)<0.5).map(([k])=>k);if(near.length)out[id]=near}return out})();
const routeStopSet=i=>{const set=new Set();R[i].d.forEach(d=>{d.s.forEach(x=>set.add(x));(d.v||[]).forEach(v=>v.x.forEach(x=>set.add(x)))});return set};
const RSTOPS=new Map();const rStops=i=>{if(!RSTOPS.has(i))RSTOPS.set(i,routeStopSet(i));return RSTOPS.get(i)};
function alertStops(a){if(a._st)return a._st;const set=new Set();for(const x of a.sel||[]){if(!x.stop)continue;const t=ST[x.stop]?x.stop:(parentOf[x.stop]||x.stop);set.add(x.stop);set.add(t);(PNR_ST[t]||[]).forEach(k=>set.add(k))}return a._st=set}
function alertHits(a,stopSet,routeSet){const as=alertStops(a);for(const x of a.sel||[])if(x.route&&routeSet.has(riOfRoute(x.route)))return true;
  for(const s of as){if(stopSet.has(s))return true;for(const i of routeSet)if(rStops(i).has(s))return true}return false}
function alertsFor(stopIds,routeIdxs){const sset=new Set(stopIds),rset=new Set(routeIdxs);return LIVE.alerts.filter(activeNow).filter(a=>alertHits(a,sset,rset))}
function alertHTML(list){if(!list.length)return"";return `<details class="alerts"><summary>⚠ ${list.length} service alert${list.length>1?"s":""}</summary>`+list.slice(0,20).map(a=>`<div class="al"><b>${esc(a.header)}</b>${a.desc?`<p>${esc(a.desc).slice(0,600)}</p>`:""}${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">More information</a>`:""}</div>`).join("")+`</details>`}
function insertAlerts(stopIds,routeIdxs){const html=alertHTML(alertsFor(stopIds,routeIdxs));if(!html)return;const old=pB.querySelector(".alerts");if(old)old.remove();pB.insertAdjacentHTML("afterbegin",html)}
document.getElementById("alertBtn").onclick=()=>{webCam=null;showAllAlerts()};
setInterval(pollVehicles,20000);setInterval(pollAlerts,120000);pollVehicles();pollAlerts();
document.addEventListener("visibilitychange",()=>{if(!document.hidden){pollVehicles();if(ctx&&ctx.id)renderTT(ctx.id)}});

// ---------- saved stops
let favTimer=null;
async function showFavStops(){focusRoutes=null;rtFocus=false;syncVehVis();backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);
  if(!FAV.stops.length){openPanel("Saved stops","Saved on this device",`<div class="sub">No saved stops yet. Open any stop or station and tap ☆ next to its name to save it here.</div>`,{view:"favs"});return}
  openPanel("Saved stops",`${FAV.stops.length} saved on this device`,FAV.stops.map(id=>ST[id]?`<div class="fav closed" data-fav="${id}"><div class="favh"><button class="favtog" data-tog="${id}" aria-expanded="false" title="Show departures">+</button><a data-open="${id}">${esc(ST[id][0])}</a><span>${KIND[ST[id][3]]}${ST[id][4]?" · "+esc(ST[id][4]):""}</span><span class="favst"></span><button class="favx" data-unfav="${id}" title="Remove">✕</button></div><div class="tt favtt" id="fv_${id}"><div class="sub">Loading…</div></div></div>`:"").join(""),{view:"favs"});
  pB.querySelectorAll("[data-open]").forEach(a=>a.onclick=()=>{const cam={center:map.getCenter(),zoom:map.getZoom()};openStop(a.dataset.open,true);setBack({kind:"favs",cam})});
  pB.querySelectorAll("[data-unfav]").forEach(b=>b.onclick=()=>{FAV.stops=FAV.stops.filter(x=>x!==b.dataset.unfav);saveFav();showFavStops()});
  // each saved stop starts collapsed: + (on the left, well away from ✕) shows its departures, − hides them
  pB.querySelectorAll("[data-tog]").forEach(b=>b.onclick=()=>{const f=b.closest(".fav");const open=f.classList.toggle("closed")===false;b.textContent=open?"−":"+";b.title=open?"Hide departures":"Show departures";b.setAttribute("aria-expanded",open)});
  await refreshFavStops();applyFavStatus();clearInterval(favTimer);favTimer=setInterval(()=>{if(view==="favs"&&panel.style.display!=="none")refreshFavStops();else clearInterval(favTimer)},30000)}
async function refreshFavStops(){let d=null;try{d=await getTrips()}catch(e){}
  for(const id of FAV.stops){const box=document.getElementById("fv_"+id);if(!box||!ST[id])continue;let tile;try{tile=await loadTT(ST[id])}catch(e){continue}
    const {rows,nowMin}=buildRows(id,tile[id]||[]);const soon=rows;
    if(!soon.length){box.innerHTML=`<div class="sub">No scheduled departures from this stop.</div>`;continue}
    const sc=box.scrollTop;box.innerHTML=`<div class="th"><div>Route (${new Set(rows.map(r=>r.ri)).size})</div><div>Next</div><div>Later departures</div></div>`+soon.map((r,k)=>rowHTML(r,nowMin,k)).join("");box.scrollTop=sc;
    box.querySelectorAll("[data-r]").forEach(b=>b.onclick=async()=>showRoute(+b.dataset.r,false,await rowVehFor(b)));box.querySelectorAll("[data-line]").forEach(b=>b.onclick=async()=>showLine(b.dataset.line,false,await rowVehFor(b)));
    if(d)computeLive(id,soon,d).forEach((v,k)=>{const c=box.querySelector(`[data-live="${k}"]`);if(c&&v){c.className=v.cls;c.innerHTML=v.html;c.title=v.title;if(v.trip)c.dataset.trip=v.trip;else delete c.dataset.trip;livePlat(box,k,v)}})}}
// ---------- saved routes
const keyIds=key=>TNAME[key]?(lineRoutes[key]||[]):(key in nameIdx?[nameIdx[key]]:[]);
function keyBadge(key){if(TNAME[key])return lineBadge(key);const i=nameIdx[key];return i===undefined?esc(key):badge(i,R[i].t==="tram"?"G:link":R[i].n)}
const keyName=key=>TNAME[key]?TNAME[key]:(key in nameIdx?R[nameIdx[key]].l:key);
function showFavRoutes(){focusRoutes=null;rtFocus=false;syncVehVis();backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);
  if(!FAV.routes.length){openPanel("Saved routes","Saved on this device",`<div class="sub">No saved routes yet. Open any route or train line and tap ☆ next to its name to save it here.</div>`,{view:"favr"});return}
  const now=Date.now()/1000;
  openPanel("Saved routes",`${FAV.routes.length} saved on this device`,FAV.routes.map(k=>{const ids=new Set(keyIds(k));const nv=LIVE.veh.filter(v=>ids.has(v.ri)).length;
    const na=LIVE.alerts.filter(a=>(a.sel||[]).some(x=>x.route&&ids.has(riOfRoute(x.route)))&&(!a.periods||!a.periods.length||a.periods.some(p=>!p.end||p.end>=now))).length;
    return `<div class="favr" data-rt="${esc(k)}">${keyBadge(k)}<div class="favrn"><b>${esc(keyName(k))}</b><span>${LIVE.vehAt?nv+" running now":""}</span><span class="favst"></span></div><button class="favx" data-unfav="${esc(k)}" title="Remove">✕</button></div>`}).join(""),{view:"favr"});
  pB.querySelectorAll("[data-rt]").forEach(el=>el.onclick=e=>{if(e.target.closest("[data-unfav]"))return;e.stopPropagation();const k=el.dataset.rt,b={kind:"favr",cam:{center:map.getCenter(),zoom:map.getZoom()}};
    if(TNAME[k])showLine(k);else if(nameIdx[k]!=null)showRoute(nameIdx[k],false);else return openRouteTable(k,null,b);setBack(b)});
  pB.querySelectorAll("[data-unfav]").forEach(b=>b.onclick=e=>{e.stopPropagation();FAV.routes=FAV.routes.filter(x=>x!==b.dataset.unfav);saveFav();showFavRoutes()});applyFavStatus()}
// ---------- route timetable page (all stops, Earlier / Later, day picker, live, updates)
const RTC={};const COLS=5;
const fmtDayOpt=new Intl.DateTimeFormat("en-AU",{timeZone:"UTC",weekday:"long",day:"numeric",month:"short"});
async function openRouteTable(key,st,back){const file=key.replace(/[^A-Za-z0-9_-]/g,"_");
  try{await ensureCal();if(!RTC[key])RTC[key]=await (await fetch(BASE+"data/rt/"+file+".json"+DV)).json()}catch(e){openPanel(keyName(key),"Timetable",`<div class="sub">Timetable unavailable.</div>`);return}
  const data=RTC[key];const dirs=Object.keys(data).sort();const now=bneNow();
  st=Object.assign({dir:dirs[0],day:0,start:null},st||{});if(!data[st.dir])st.dir=dirs[0];
  // rail replacement buses: the day menu lists only the days the route runs (up to ~4 months ahead), starting at the next one
  const isRB=!TNAME[key]&&nameIdx[key]!=null&&/^rail replacement bus$/i.test(R[nameIdx[key]].l||"");let runK=null;
  if(isRB){runK=[];for(let k=0;k<130;k++){const dd=shiftDay(now.ymd,now.dow,k);if(dirs.some(dk=>data[dk].t.some(t=>t[1].some(si=>svcOn(si,dd)))))runK.push(k)}
    if(runK.length&&!runK.includes(st.day)){st.day=runK.find(k=>k>=st.day)??runK[runK.length-1];st.start=null}}
  const day=shiftDay(now.ymd,now.dow,st.day);const D=data[st.dir];
  const trips=D.t.filter(t=>t[1].some(si=>svcOn(si,day)));
  if(st.start===null){st.start=0;if(st.day===0){const k=trips.findIndex(t=>{let mx=0;for(let j=3;j<t.length;j++)if(t[j]>mx)mx=t[j];return t[2]+mx>=now.min});st.start=k<0?Math.max(0,trips.length-COLS):k}}
  st.start=Math.max(0,Math.min(st.start,Math.max(0,trips.length-COLS)));
  const cols=trips.slice(st.start,st.start+COLS);
  const ids=keyIds(key);focusRoutes=new Set(ids);rtFocus=true;syncVehVis();drawPaths(ids,TNAME[key]?TCOL[key]:undefined);ctx=null;setSel(null);
  rtState={key,st,cols,dir:st.dir,order:D.o};
  const dayOpts=(runK&&runK.length?runK:Array.from({length:14},(_,k)=>k)).map(k=>{const dd=shiftDay(now.ymd,now.dow,k);const lab=k===0?"Today":k===1?"Tomorrow":fmtDayOpt.format(new Date(Date.UTC(+dd.ymd.slice(0,4),+dd.ymd.slice(4,6)-1,+dd.ymd.slice(6,8))));return `<option value="${k}"${k===st.day?" selected":""}>${lab}</option>`}).join("");
  const dirLab=dk=>"Towards "+data[dk].top.map(h=>cleanHead(TT.cal.hs[h])).filter((x,i,a)=>a.indexOf(x)===i).join(", ");
  let h=(isRB?rbRouteBanner(key):"")+`<div class="rtc"><select id="rtDay" aria-label="Day">${dayOpts}</select><button class="btn" id="rtNow">${isRB?"Next":"Now"}</button></div>`+
    `<div class="rtdirs">${dirs.map(dk=>`<button data-dir="${dk}" class="${dk===st.dir?"on":""}">${esc(dirLab(dk))}</button>`).join("")}</div>`+
    `<div class="rtnav"><button id="rtEarlier"${st.start<=0?" disabled":""}>← Earlier</button><span>${trips.length?`Trips ${st.start+1}–${st.start+cols.length} of ${trips.length}`:""}</span><button id="rtLater"${st.start+COLS>=trips.length?" disabled":""}>Later →</button></div>`;
  if(!cols.length)h+=`<div class="sub">No services this day in this direction.</div>`;
  else{const rowsUsed=D.o.map((sid,j)=>cols.some(t=>t[3+j]>=0)?j:-1).filter(j=>j>=0);
    h+=`<div class="rtgrid"><table><thead><tr><th class="sn">Stop</th>${cols.map(t=>`<th>${esc(cleanHead(TT.cal.hs[t[0]]))}</th>`).join("")}</tr><tr class="lv"><th class="sn"></th>${cols.map((t,c)=>`<th id="rtlv${c}"></th>`).join("")}</tr>${st.day===0?`<tr class="lv fl"><th class="sn">${/^T\d$/.test(key)?"Service number":keyIds(key).some(i=>R[i].t==="ferry")?"Vessel":"Fleet number"}</th>${cols.map((t,c)=>`<th id="rtfl${c}"></th>`).join("")}</tr>`:""}</thead><tbody>`+
      rowsUsed.map(j=>{const sid=D.o[j];const s=ST[sid];return `<tr><td class="sn"><a data-s2="${sid}">${esc(s?s[0]:sid)}</a></td>${cols.map(t=>{const v=t[3+j];return `<td>${v>=0?clock(t[2]+v):"—"}</td>`}).join("")}</tr>`}).join("")+`</tbody></table></div>`}
  h+=`<div class="grp">Live now</div><div id="rtLive" class="rtlive"><div class="sub">Loading live data…</div></div><div class="grp">Updates</div><div id="rtUpd"></div>`;
  openPanel(TNAME[key]?`${key} ${TNAME[key]}`:`${R[nameIdx[key]].t==="tram"?"G:link":key} — ${keyName(key)}`,"Timetable · all stops",h,{view:"rt",wide:true,star:{list:"routes",key}});
  if(back)setBack(back);
  const go=o=>openRouteTable(key,Object.assign({},st,o),backState);
  document.getElementById("rtDay").onchange=e=>go({day:+e.target.value,start:null});
  document.getElementById("rtNow").onclick=()=>go({day:0,start:null});if(isRB&&typeof rbWireNotes==="function"){rbWireNotes();requestAnimationFrame(()=>{pB.scrollTop=0})}
  pB.querySelectorAll("[data-dir]").forEach(b=>b.onclick=()=>go({dir:b.dataset.dir,start:null}));
  const E=document.getElementById("rtEarlier"),Lt=document.getElementById("rtLater");if(E)E.onclick=()=>go({start:st.start-COLS});if(Lt)Lt.onclick=()=>go({start:st.start+COLS});
  pB.querySelectorAll("[data-s2]").forEach(a=>a.onclick=()=>{const b={kind:"rt",key,st:Object.assign({},st),cam:{center:map.getCenter(),zoom:map.getZoom()}};openStop(a.dataset.s2,true);setBack(b)});
  // updates (current and upcoming alerts for this route)
  const nowS=Date.now()/1000;const iset=new Set(ids);
  const al=LIVE.alerts.filter(a=>alertHits(a,new Set(),iset)&&(!a.periods||!a.periods.length||a.periods.some(p=>!p.end||p.end>=nowS)));
  document.getElementById("rtUpd").innerHTML=!al.length?`<div class="sub">No current or upcoming alerts for this ${TNAME[key]?"line":"route"}.</div>`:al.map(a=>{const t=alertTags(a);const p=(a.periods||[]).find(p=>!p.end||p.end>=nowS);
    return `<details class="alcard"><summary><b>${esc(a.header)}</b><div class="atags"><span class="atag t-${t.timing.replace(/\s/g,"").toLowerCase()}">${t.timing}</span>${t.kind?`<span class="atag ${t.kind==="Disruption"?"dis":"pl"}">${t.kind}</span>`:""}<span class="atype">${esc(t.type)}</span></div>${p&&(p.start||p.end)?`<span class="when">${p.start?fmtDay.format(p.start*1000):""}${p.end?" – "+fmtDay.format(p.end*1000):""}</span>`:""}</summary>${a.desc?`<p>${esc(a.desc).slice(0,1500)}</p>`:""}${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">More information</a>`:""}</details>`}).join("");
  renderRTLive()}
async function renderRTLive(){if(view!=="rt"||!rtState)return;const {key,st,cols,dir,order}=rtState;const ids=new Set(keyIds(key));let d=null;try{d=await getTrips()}catch(e){}
  if(view!=="rt"||!rtState||rtState.key!==key)return;
  const delays={},stopSched={};
  if(d)for(const e of d.entity){const tu=e.tu;if(!tu||!tu.trip)continue;const ri=riOfRoute(tu.trip.route);if(!ids.has(ri))continue;const stu=tu.stu||[];
    const dl=(stu.find(u=>(u.dep||u.arr)&&(u.dep||u.arr).delay!==undefined)||{});const ev=dl.dep||dl.arr;delays[tu.trip.trip]={delay:ev?ev.delay||0:(tu.delay||0),cx:tu.trip.sr===3};
    if(st.day===0)for(const u of stu){const ev2=u.dep||u.arr;if(!ev2||!ev2.time)continue;const sid=ST[u.stop]?u.stop:parentOf[u.stop];if(sid)stopSched[sid+"|"+bneMin(ev2.time-(ev2.delay||0))]={delay:ev2.delay||0,cx:tu.trip.sr===3||u.sr===1,trip:tu.trip.trip}}}
  if(st.day===0)cols.forEach((t,c)=>{const cell=document.getElementById("rtlv"+c);if(!cell)return;let hit=null;
    for(let j=0;j<order.length&&!hit;j++){const v=t[3+j];if(v<0)continue;hit=stopSched[order[j]+"|"+((t[2]+v)%1440)]||null}
    const fc=document.getElementById("rtfl"+c);if(fc)fc.textContent=hit&&!hit.cx?fleetOf(hit.trip):"";
    if(!hit){cell.textContent="";return}
    cell.innerHTML=hit.cx?`<span class="lvx">Cancelled</span>`:hit.delay>=120?`<span class="lvl">● ${Math.round(hit.delay/60)} min late</span>`:`<span class="lvo">● On time</span>`});
  const vs=LIVE.veh.filter(v=>ids.has(v.ri)&&String(v.dir)===String(dir));const box=document.getElementById("rtLive");if(!box)return;
  if(!LIVE.vehAt){box.innerHTML=`<div class="sub">Loading live vehicles…</div>`;pollVehicles();return}
  if(!vs.length){box.innerHTML=`<div class="sub">No vehicles running in this direction right now.</div>`;return}
  box.innerHTML=vs.map((v,k)=>{const s=v.stop&&(ST[v.stop]?ST[v.stop]:ST[parentOf[v.stop]]);const dl=delays[v.trip];const r=R[v.ri];
    const lab=r.t==="train"?(lineOf[v.ri]||[""])[0]:r.t==="tram"?"G:link":r.n;
    const stat=dl?(dl.cx?`<span class="lvx">Cancelled</span>`:dl.delay>=120?`<span class="lvl">${Math.round(dl.delay/60)} min late</span>`:`<span class="lvo">On time</span>`):"";
    return `<div class="lvrow" data-v="${k}">${r.t==="train"?lineBadge(lab):badge(v.ri,lab)}<span>${s?"Next: "+esc(s[0]):"Running"}${v.fleet?` <em class="flm">${fleetWord(v.ri)} ${esc(v.fleet)}</em>`:""}</span>${stat}</div>`}).join("");
  box.querySelectorAll("[data-v]").forEach(el=>el.onclick=()=>{const v=vs[+el.dataset.v];map.flyTo({center:[v.lon,v.lat],zoom:15,duration:700})})}
document.getElementById("favStopsBtn").onclick=()=>{webCam=null;showFavStops()};
document.getElementById("favRoutesBtn").onclick=()=>{webCam=null;showFavRoutes()};
updateFavBtns();

// ---------- school routes (list only)
let SCHOOL=null;
async function showSchool(q){focusRoutes=null;rtFocus=false;syncVehVis();backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);
  if(!SCHOOL){try{SCHOOL=await (await fetch(BASE+"data/school.json"+DV)).json()}catch(e){openPanel("School routes","",`<div class="sub">School route list unavailable.</div>`);return}}
  q=(q||"").trim().toLowerCase();
  const list=SCHOOL.routes.filter(([n,l])=>!q||n.toLowerCase().startsWith(q)||l.toLowerCase().includes(q));
  const grp={};list.forEach(r=>{const m=r[0].match(/^([A-Za-z]*)(\d)/);const g=m?(m[1]+m[2]+(r[0].replace(/^[A-Za-z]*/,"").length>=4?"xxx":"xx")):"Other";(grp[g]=grp[g]||[]).push(r)});
  const note=`<div class="schnote"><b>About school services</b><p>These buses run on <b>school days only</b> and are designed mainly for students travelling to and from school. They have their own route numbers, which can look like everyday routes: for example, school route <b>S700</b> is not the same as everyday Gold Coast route <b>700</b>, and the first digit of a school route does not follow the area rule used for everyday routes. They may not stop at every stop along the way, and some only run on certain school days. School services are not shown on the map, in search or in timetables.</p><p>Check times and who can travel on a service with the school or at <a href="https://translink.com.au" target="_blank" rel="noopener">translink.com.au</a>.</p></div>`;
  const body=Object.keys(grp).map(g=>`<div class="grp">${esc(g)} · ${grp[g].length}</div>`+grp[g].map(([n,l])=>`<div class="schr"><span class="rb sch">${esc(n)}</span><span>${esc(l)}</span></div>`).join("")).join("")||`<div class="sub">No school routes match.</div>`;
  if(!pB.querySelector("#schQ")||view!=="school"){
    openPanel("School routes",`${SCHOOL.routes.length} school-only routes · Translink school services (pilot data), ${esc(SCHOOL.updated)}`,note+`<input id="schQ" class="ttf schq" placeholder="Search school routes or schools" autocomplete="off"><div id="schList"></div>`,{view:"school"});
    document.getElementById("schQ").oninput=e=>showSchool(e.target.value)}
  document.getElementById("schList").innerHTML=body}
document.getElementById("schoolBtn").onclick=()=>{webCam=null;showSchool("")};

// ---------- on-demand service areas (navy zones + key destination pins)
let OD=null,odOn=false,odSnap=null;const selPt=c=>map.getSource("sel").setData(FC([{type:"Feature",properties:{},geometry:{type:"Point",coordinates:c}}]));const OD_FILL="#1e3a8a";
function odGroups(){const out=[];OD.areas.forEach((a,ai)=>a.groups.forEach((g,gi)=>out.push({a,ai,g,gi})));return out}
function odPins(){const m=new Map();OD.areas.forEach((a,ai)=>{(a.dests||[]).forEach(d=>{if(d.ll&&!m.has(d.n))m.set(d.n,{n:d.n,ll:d.ll,ai,gi:-1})});a.groups.forEach((g,gi)=>(g.dests||[]).forEach(d=>{if(d.ll&&!m.has(d.n))m.set(d.n,{n:d.n,ll:d.ll,ai,gi})}))});return [...m.values()]}
function odSetup(){if(map.getSource("odz"))return;
  const zf=[];odGroups().forEach(({ai,g,gi})=>g.zones.forEach(z=>zf.push({type:"Feature",properties:{ai,gi},geometry:{type:"Polygon",coordinates:[z]}})));
  map.addSource("odz",{type:"geojson",data:FC(zf)});map.addSource("odp",{type:"geojson",data:FC(odPins().map(p=>({type:"Feature",properties:{n:p.n,ai:p.ai,gi:p.gi},geometry:{type:"Point",coordinates:p.ll}})))});
  const below=map.getLayer("bw-case")?"bw-case":undefined;
  map.addLayer({id:"od-fill",type:"fill",source:"odz",paint:{"fill-color":OD_FILL,"fill-opacity":.3}},below);
  map.addLayer({id:"od-line",type:"line",source:"odz",paint:{"line-color":OD_FILL,"line-width":1.6,"line-opacity":.9}},below);
  map.addLayer({id:"od-pin",type:"circle",source:"odp",paint:{"circle-color":"#facc15","circle-radius":["interpolate",["linear"],["zoom"],9,4,14,7],"circle-stroke-color":OD_FILL,"circle-stroke-width":2}},"sel");
  map.addLayer({id:"od-lbl",type:"symbol",source:"odp",minzoom:12.5,layout:{"text-field":["get","n"],"text-font":FONT,"text-size":11.5,"text-offset":[0,1.1],"text-anchor":"top","text-optional":true},paint:{"text-color":OD_FILL,"text-halo-color":"#ffffff","text-halo-width":1.8}},"sel");
  L.push("od-fill","od-line","od-pin","od-lbl");odPaint();
  ["od-pin","od-fill"].forEach(id=>{map.on("mouseenter",id,e=>{map.getCanvas().style.cursor="pointer";if(id==="od-pin")pop.setLngLat(e.lngLat).setText(e.features[0].properties.n).addTo(map)});map.on("mouseleave",id,()=>{map.getCanvas().style.cursor="";pop.remove()})})}
function odPaint(){if(!map.getLayer("od-fill"))return;const d=theme!=="light";map.setPaintProperty("od-fill","fill-color",d?"#3b6fd8":OD_FILL);map.setPaintProperty("od-line","line-color",d?"#93b4ff":OD_FILL);map.setPaintProperty("od-lbl","text-color",d?"#dbe6ff":OD_FILL);map.setPaintProperty("od-lbl","text-halo-color",d?"#0b1220":"#ffffff")}
function odLayers(on){if(on){odSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{odSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(odSnap){Object.entries(odSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});odSnap=null}
  renderAll();hint()}
function odVis(v){["od-fill","od-line","od-pin","od-lbl"].forEach(id=>map.getLayer(id)&&map.setLayoutProperty(id,"visibility",v?"visible":"none"))}
function odBounds(zs){let b=null;zs.forEach(z=>z.forEach(([x,y])=>{b=b?[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)]:[x,y,x,y]}));return b}
function odFit(zs){const b=odBounds(zs);if(b)map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:14})}
function odDestHTML(list,ai){return `<ul class="odd">`+list.map(d=>d.ll?`<li><a href="#" data-odll="${d.ll.join(",")}">${esc(d.n)}</a>${d.approx?` <span class="odnm">(approximate location)</span>`:""}</li>`:`<li>${esc(d.n)} <span class="odnm">(not marked on map)</span></li>`).join("")+`</ul>`}
function odWire(){pB.querySelectorAll("[data-odll]").forEach(a=>a.onclick=e=>{e.preventDefault();const [x,y]=a.dataset.odll.split(",").map(Number);map.flyTo({center:[x,y],zoom:15,duration:700});selPt([x,y])});
  pB.querySelectorAll("[data-odg]").forEach(a=>a.onclick=e=>{e.preventDefault();const [ai,gi]=a.dataset.odg.split(",").map(Number);odCard(ai,gi,true)})}
const odLink=a=>`<p class="odlink"><a href="${esc(a.page)}" target="_blank" rel="noopener">Hours, booking and details at Translink ↗</a></p>`;
function odStarts(a){if(!a.starts)return "";const t=bneNow().ymd,d=a.starts.replace(/-/g,"");if(t>=d)return "";const dt=new Date(a.starts+"T00:00:00+10:00");return "Starts "+dt.toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long",timeZone:"Australia/Brisbane"})}
const odNotes=list=>list&&list.length?`<div class="odwarn">${list.map(n=>`<p>⚠ ${esc(n)}</p>`).join("")}</div>`:"";
function odOverview(){const others="";
  const h=odNotes([...(OD.notes||[]),...OD.areas.flatMap(a=>(a.notes||[]).map(n=>a.name+": "+n))])+OD.areas.map((a,ai)=>`<div class="grp">${esc(a.name)}</div>${odStarts(a)?`<div class="odstart">${odStarts(a)}</div>`:""}<div class="odhow">${esc(a.how)}</div>`+a.groups.map((g,gi)=>`<div class="odg"><a href="#" data-odg="${ai},${gi}">${esc(g.name)}</a></div>`).join("")+odLink(a)).join("")
   +`<div class="odnote">Shaded navy areas are where on-demand buses pick up. Yellow dots are destinations and key locations; tap an area for its list. Tamborine Mountain also has an on-demand service, to Helensvale and Beenleigh stations, that isn't drawn because Translink doesn't publish a map of its area. Ipswich, Bribie Island and Yarrabilba areas are traced from Translink's map pictures, so their edges are approximate; see <a href="https://translink.com.au/ondemand" target="_blank" rel="noopener">translink.com.au/ondemand</a>.</div>`;
  openPanel("On-demand services",`Flexible, pre-booked buses · Translink map files, ${esc(OD.updated)}`,h,{view:"od"});backState=null;pBack.style.display="none";odWire()}
function odCard(ai,gi,fit){const a=OD.areas[ai];let h=odNotes(a.notes)+`<div class="odhow">${esc(a.how)}</div>`,sub="On-demand service area";
  if(odStarts(a))h=`<div class="odstart">${odStarts(a)}</div>`+h;
  if(gi>=0){const g=a.groups[gi];sub=esc(g.name);if(g.hours)h+=`<div class="grp">Hours</div><div class="odhow">${esc(g.hours)}</div>`;
    if(g.dests){h+=(g.pickup?`<div class="grp">Picks up in</div><div class="odhow">${esc(g.pickup)}</div>`:"")+`<div class="grp">${esc(a.dlabel||"Destinations")}</div>`+odDestHTML(g.dests,ai)}
    else h+=`<div class="grp">Key locations (both roam zones)</div>`+odDestHTML(a.dests||[],ai);if(fit)odFit(g.zones)}
  else h+=`<div class="grp">Key locations</div>`+odDestHTML(a.dests||[],ai);
  if(a.traced)h+=`<div class="odnote">Area traced from Translink's map picture, so the edges are approximate.</div>`;
  if(a.auto)h+=`<div class="odnote">This service was added to the map automatically from Translink's website and hasn't been checked yet. See Translink for full details.</div>`;
  openPanel(a.name,sub,h+odLink(a)+`<div class="odnote"><a href="#" id="odAll">‹ All on-demand areas</a></div>`,{view:"odv"});setBack({kind:"od"});odWire();document.getElementById("odAll").onclick=e=>{e.preventDefault();odOverview()}}
async function toggleOD(){const btn=document.getElementById("odBtn");
  if(odOn){odOn=false;odVis(false);odLayers(false);btn.classList.remove("odon");if(view==="od"||view==="odv")closePanel();return}
  if(typeof gcOn!=="undefined"&&gcOn)await toggleGC();if(typeof pjOn!=="undefined"&&pjOn)await togglePJ(pjOn);if(typeof hmOn!=="undefined"&&hmOn)await toggleHM();if(typeof rbOn!=="undefined"&&rbOn)await toggleRB();
  if(!OD){try{OD=await (await fetch(BASE+"data/ondemand.json"+DV)).json()}catch(e){openPanel("On-demand services","",`<div class="sub">On-demand areas unavailable.</div>`);return}}
  odSetup();odOn=true;odVis(true);odLayers(true);btn.classList.add("odon");focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  odOverview();odFit(odGroups().flatMap(x=>x.g.zones))}
document.getElementById("odBtn").onclick=toggleOD;
map.on("click",e=>{if(!odOn)return;const box=[[e.point.x-6,e.point.y-6],[e.point.x+6,e.point.y+6]];
  if(map.queryRenderedFeatures(box,{layers:CLICK.filter(id=>map.getLayer(id)&&map.getLayoutProperty(id,"visibility")!=="none")}).length)return;
  const f=map.queryRenderedFeatures(box,{layers:["od-pin","od-fill"]});if(!f.length)return;const p=f.find(x=>x.layer.id==="od-pin")||f[0];
  odCard(+p.properties.ai,+p.properties.gi,false);if(p.layer.id==="od-pin")selPt(p.geometry.coordinates)});

// ---------- Cross River Rail and The Wave (data/projects.json, refreshed weekly by tools/build_projects.py).
// Like On demand: the other layers clear, the project's sites are drawn, and tapping a site opens its card.
let PJ=null,pjOn=null,pjSnap=null;const PJ_BTN={crr:"crrBtn",wave:"waveBtn"};
const pjDate=d=>{if(!d)return "";const t=new Date(d+"T00:00:00+10:00");return t.toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric",timeZone:"Australia/Brisbane"})};
function pjSetup(k){const P=PJ[k];if(map.getSource("pj-"+k+"-a"))return;const col=P.colour;
  const af=[],pf=[],lf=[];P.sites.forEach((t,i)=>{if(t.shape)af.push({type:"Feature",properties:{k,i},geometry:t.shape});if(t.ll)pf.push({type:"Feature",properties:{k,i,n:t.name},geometry:{type:"Point",coordinates:t.ll}})});
  (P.line||[]).forEach(c=>lf.push({type:"Feature",properties:{dash:0},geometry:{type:"LineString",coordinates:c}}));
  (P.lines||[]).forEach(l=>lf.push({type:"Feature",properties:{dash:l.planned?1:0,n:l.name||""},geometry:{type:"LineString",coordinates:l.coords}}));
  map.addSource("pj-"+k+"-a",{type:"geojson",data:FC(af)});map.addSource("pj-"+k+"-p",{type:"geojson",data:FC(pf)});map.addSource("pj-"+k+"-l",{type:"geojson",data:FC(lf)});
  const below=map.getLayer("bw-case")?"bw-case":undefined;
  map.addLayer({id:"pj-"+k+"-line",type:"line",source:"pj-"+k+"-l",filter:["==",["get","dash"],0],layout:{"line-cap":"round"},paint:{"line-color":col,"line-width":["interpolate",["linear"],["zoom"],9,2.5,15,4],"line-opacity":.85}},below);
  map.addLayer({id:"pj-"+k+"-plan",type:"line",source:"pj-"+k+"-l",filter:["==",["get","dash"],1],paint:{"line-color":col,"line-width":["interpolate",["linear"],["zoom"],9,2.5,15,5],"line-opacity":.8,"line-dasharray":[2,1.5]}},below);
  map.addLayer({id:"pj-"+k+"-fill",type:"fill",source:"pj-"+k+"-a",paint:{"fill-color":col,"fill-opacity":.3}},below);
  map.addLayer({id:"pj-"+k+"-edge",type:"line",source:"pj-"+k+"-a",paint:{"line-color":col,"line-width":1.6}},below);
  map.addLayer({id:"pj-"+k+"-pin",type:"circle",source:"pj-"+k+"-p",paint:{"circle-color":"#ffffff","circle-radius":["interpolate",["linear"],["zoom"],9,4.5,14,7],"circle-stroke-color":col,"circle-stroke-width":2.5}},"sel");
  map.addLayer({id:"pj-"+k+"-lbl",type:"symbol",source:"pj-"+k+"-p",minzoom:11.5,layout:{"text-field":["get","n"],"text-font":FONT,"text-size":11.5,"text-offset":[0,1.1],"text-anchor":"top","text-optional":true},paint:{"text-color":col,"text-halo-color":"#ffffff","text-halo-width":1.8}},"sel");
  L.push(...["line","plan","fill","edge","pin","lbl"].map(x=>"pj-"+k+"-"+x));pjPaint(k);
  ["pin","fill"].forEach(x=>{const id="pj-"+k+"-"+x;map.on("mouseenter",id,e=>{map.getCanvas().style.cursor="pointer";if(x==="pin")pop.setLngLat(e.lngLat).setText(e.features[0].properties.n).addTo(map)});map.on("mouseleave",id,()=>{map.getCanvas().style.cursor="";pop.remove()})})}
function pjPaint(k){if(!map.getLayer("pj-"+k+"-lbl"))return;const d=theme!=="light";map.setPaintProperty("pj-"+k+"-lbl","text-halo-color",d?"#0b1220":"#ffffff");map.setPaintProperty("pj-"+k+"-pin","circle-color",d?"#0b1220":"#ffffff")}
function pjVis(k,v){["line","plan","fill","edge","pin","lbl"].forEach(x=>{const id="pj-"+k+"-"+x;map.getLayer(id)&&map.setLayoutProperty(id,"visibility",v?"visible":"none")})}
function pjLayers(on){["plat-fill","plat-line","plat-dot","plat-num"].forEach(id=>map.getLayer(id)&&map.setLayoutProperty(id,"visibility",on?"none":"visible"));if(on){pjSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{pjSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(pjSnap){Object.entries(pjSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});pjSnap=null}
  renderAll();hint()}
function pjCoords(t){const out=[];const walk=c=>typeof c[0]==="number"?out.push(c):c.forEach(walk);if(t.shape)walk(t.shape.coordinates);if(t.ll)out.push(t.ll);return out}
function pjFit(cs,maxZoom){let b=null;cs.forEach(([x,y])=>{b=b?[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)]:[x,y,x,y]});
  if(b)map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:maxZoom||15.5})}
const pjAll=k=>[...PJ[k].sites.flatMap(pjCoords),...(PJ[k].line||[]).flat(),...(PJ[k].lines||[]).flatMap(l=>l.coords)];
function pjNotice(n,where){return `<li><span class="pjd">${esc(pjDate(n.d))}${where&&n.where?" · "+esc(n.where):""}</span> <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.t)}</a>${n.pdf?` <a class="pjpdf" href="${esc(n.pdf)}" target="_blank" rel="noopener">PDF ↗</a>`:""}</li>`}
const pjLinks=P=>`<div class="grp">Official and related sites</div><ul class="pjlinks">`+P.links.map(([t,u])=>`<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a></li>`).join("")+`</ul>`;
// Service alerts caused by the project: today's Translink alerts that name it ("Cross River Rail", "CRR", "The Wave"),
// or that affect a project station and talk about works. Station = a train or bus station within 300 m of a site.
const PJ_NAME={crr:/cross river rail|\bcrr\b/i,wave:/\bthe wave\b/i};const PJ_WORKS=/\b(works?|construction|upgrade|rebuild|closure)\b/i;
function pjStations(k,t){if(t._st)return t._st;const set=new Set();if(t.ll)for(const [id,v] of Object.entries(ST)){if(v[3]!=="train"&&v[3]!=="busstn")continue;
    if(Math.hypot((v[2]-t.ll[0])*99.4,(v[1]-t.ll[1])*110.6)<0.3){set.add(id);(KIDS[id]||[]).forEach(x=>set.add(x))}}return t._st=set}
function pjAlerts(k,i){const P=PJ[k];const sites=i==null?P.sites:[P.sites[i]];
  return todaysAlerts().filter(a=>{const txt=(a.header||"")+" "+(a.desc||"");const named=PJ_NAME[k].test(txt);const st=alertStops(a);
    const atSite=sites.some(t=>[...pjStations(k,t)].some(x=>st.has(x))||(i!=null&&new RegExp("\\b"+t.name.replace(/\s*\(.*?\)/g,"").replace(/[^\w ]/g,"").trim()+"\\b","i").test(txt)));
    return i==null?(named||(atSite&&PJ_WORKS.test(txt))):(atSite&&(named||PJ_WORKS.test(txt)))})}
function pjAlertHTML(k,i){const L=pjAlerts(k,i);if(!L.length)return "";
  return `<details class="alerts pjal"><summary>⚠ ${L.length} service alert${L.length>1?"s":""} linked to ${esc(PJ[k].name)}</summary>`+L.slice(0,12).map(a=>`<div class="al"><b>${esc(a.header)}</b>${a.desc?`<p>${esc(a.desc).slice(0,600)}</p>`:""}${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">More information</a>`:""}</div>`).join("")+`<div class="pjhint">Today's Translink alerts that name ${esc(PJ[k].name)}, or works at its stations.</div></details>`}
function pjWire(k){pB.querySelectorAll("[data-pjs]").forEach(a=>a.onclick=e=>{e.preventDefault();pjCard(k,+a.dataset.pjs,true)});const x=document.getElementById("pjAll");if(x)x.onclick=e=>{e.preventDefault();pjOverview()}}
function pjOverview(){const k=pjOn;if(!k)return;const P=PJ[k];const groups=new Map();P.sites.forEach((t,i)=>{const g=t.group||t.kind;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(i)});
  let h=pjAlertHTML(k)+(P.notes||[]).map(n=>`<div class="odwarn"><p>⚠ ${esc(n)}</p></div>`).join("")+P.overview.map(p=>`<p class="pjp">${esc(p)}</p>`).join("");
  h+=`<div class="grp">Sites</div><div class="pjhint">Tap a site here or on the map for its details.</div>`+[...groups].map(([g,is])=>`<div class="pjg">${esc(g)}</div>`+is.map(i=>`<div class="odg"><a href="#" data-pjs="${i}">${esc(P.sites[i].name)}</a>${P.sites[i].when?` <span class="odnm">${esc(P.sites[i].when)}</span>`:""}</div>`).join("")).join("");
  if(P.latest&&P.latest.length)h+=`<div class="grp">Latest works notices</div><ul class="pjn">${P.latest.map(n=>pjNotice(n,true)).join("")}</ul>`;
  if(P.documents&&P.documents.length)h+=`<div class="grp">Documents from TMR</div><ul class="pjn">${P.documents.map(n=>pjNotice(n,false)).join("")}</ul>`;
  h+=pjLinks(P)+`<div class="odnote">${esc(P.mapnote||"")} Unofficial summary of what the Queensland Government, TMR and Translink have published; dates and details can change, so check the official sites.</div>`;
  openPanel(P.name,esc(P.sub||"")+(PJ.built?` · checked ${esc(pjDate(PJ.built))}`:""),h,{view:"pj"});backState=null;pBack.style.display="none";pjWire(k)}
function pjCard(k,i,fit){const P=PJ[k],t=P.sites[i];let h=pjAlertHTML(k,i)+`<p class="pjp">${esc(t.about)}</p>`;
  if(t.when)h+=`<div class="odstart">${esc(t.when)}</div>`;
  if(t.status&&t.status.length)h+=`<div class="grp">Status</div>`+t.status.map(x=>`<p class="pjp">${esc(x)}</p>`).join("");
  if(t.progress)h+=`<div class="grp">Latest official progress${P.progress_asof?` (up to ${esc(P.progress_asof)})`:""}</div><p class="pjp">${esc(t.progress)}</p>`;
  if(t.facts&&t.facts.length)h+=`<ul class="pjf">${t.facts.map(f=>`<li>${esc(f)}</li>`).join("")}</ul>`;
  if(t.notices&&t.notices.length)h+=`<div class="grp">Works notices</div><ul class="pjn">${t.notices.map(n=>pjNotice(n,false)).join("")}</ul>`;
  else if(k==="crr")h+=`<div class="pjhint">No current works notices for this site.</div>`;
  h+=`<p class="odlink"><a href="${esc(t.page)}" target="_blank" rel="noopener">${esc(t.pagelabel||(t.name+" on the official site"))} ↗</a></p>`;
  if(t.approx)h+=`<div class="odnote">${esc(t.approxnote||"The shaded circle marks roughly where this site is; it isn't the site's actual boundary.")}</div>`;
  h+=`<div class="odnote"><a href="#" id="pjAll">‹ All ${esc(P.name)} sites</a></div>`;
  openPanel(t.name,esc(t.kind),h,{view:"pjv"});setBack({kind:"pj"});pjWire(k);if(fit)pjFit(pjCoords(t),16)}
function pjAlertsChanged(){try{if(!pjOn||!PJ||view!=="pj")return}catch(e){return}const sc=pB.scrollTop;pjOverview();pB.scrollTop=sc}
async function togglePJ(k){const btn=document.getElementById(PJ_BTN[k]);
  if(pjOn===k){pjOn=null;pjVis(k,false);pjLayers(false);btn.classList.remove("odon");if(view==="pj"||view==="pjv")closePanel();return}
  if(pjOn){const o=pjOn;pjOn=null;pjVis(o,false);document.getElementById(PJ_BTN[o]).classList.remove("odon");pjLayers(false)}
  if(odOn)await toggleOD();if(typeof gcOn!=="undefined"&&gcOn)await toggleGC();if(typeof hmOn!=="undefined"&&hmOn)await toggleHM();if(typeof rbOn!=="undefined"&&rbOn)await toggleRB();
  if(!PJ){try{PJ=await (await fetch(BASE+"data/projects.json"+DV)).json()}catch(e){openPanel("Project information","",`<div class="sub">Project information is unavailable right now.</div>`);return}}
  if(!PJ[k]){openPanel("Project information","",`<div class="sub">This project's information isn't available yet.</div>`);return}
  pjSetup(k);pjOn=k;pjVis(k,true);pjLayers(true);btn.classList.add("odon");focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  pjOverview();pjFit(PJ[k].focus?pjAll(k).filter(([x,y])=>x>=PJ[k].focus[0]&&y>=PJ[k].focus[1]&&x<=PJ[k].focus[2]&&y<=PJ[k].focus[3]):pjAll(k),13)}
document.getElementById("crrBtn").onclick=()=>togglePJ("crr");document.getElementById("waveBtn").onclick=()=>togglePJ("wave");
map.on("click",e=>{if(!pjOn)return;const box=[[e.point.x-7,e.point.y-7],[e.point.x+7,e.point.y+7]];const k=pjOn;
  const f=map.queryRenderedFeatures(box,{layers:["pj-"+k+"-pin","pj-"+k+"-fill"].filter(id=>map.getLayer(id))});if(!f.length)return;const p=f.find(x=>x.layer.id.endsWith("-pin"))||f[0];
  pjCard(k,+p.properties.i,false)});

// ---------- platform areas and numbers at BAU stations (data/platforms.json), shown when zoomed in
(async()=>{let P;try{P=await (await fetch(BASE+"data/platforms.json"+DV)).json()}catch(e){return}
  const af=[],pf=[];P.stations.forEach(st=>{st.areas.forEach(a=>af.push({type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[a]}}));st.pts.forEach(p=>pf.push({type:"Feature",properties:{n:p.n},geometry:{type:"Point",coordinates:p.ll}}))});
  const add_=()=>{if(map.getSource("platA"))return;map.addSource("platA",{type:"geojson",data:FC(af)});map.addSource("platP",{type:"geojson",data:FC(pf)});
    const before=map.getLayer("bw-case")?"bw-case":undefined;
    map.addLayer({id:"plat-fill",type:"fill",source:"platA",minzoom:15.5,paint:{"fill-color":"#2563eb","fill-opacity":["interpolate",["linear"],["zoom"],15.5,0,16.2,.28]}},before);
    map.addLayer({id:"plat-line",type:"line",source:"platA",minzoom:15.5,paint:{"line-color":"#1d4ed8","line-width":1.4,"line-opacity":["interpolate",["linear"],["zoom"],15.5,0,16.2,.9]}},before);
    map.addLayer({id:"plat-dot",type:"circle",source:"platP",minzoom:16,paint:{"circle-color":"#1d4ed8","circle-radius":["interpolate",["linear"],["zoom"],16,8,18,11],"circle-stroke-color":"#ffffff","circle-stroke-width":1.5}});
    map.addLayer({id:"plat-num",type:"symbol",source:"platP",minzoom:16,layout:{"text-field":["get","n"],"text-font":FONT,"text-size":["interpolate",["linear"],["zoom"],16,10.5,18,13],"text-allow-overlap":true,"text-ignore-placement":true},paint:{"text-color":"#ffffff"}});
    L.push("plat-fill","plat-line","plat-dot","plat-num")};
  if(map.isStyleLoaded())add_();else map.once("idle",add_)})();
// ---------- BAU menu: quick zoom to key stations (ids from data/network.json)
(()=>{const w=document.getElementById("bauWrap"),b=document.getElementById("bauBtn");if(!w)return;
  const set=o=>{w.classList.toggle("open",o);b.setAttribute("aria-expanded",o)};
  b.onclick=e=>{e.stopPropagation();document.getElementById("moreWrap").classList.remove("open");set(!w.classList.contains("open"))};
  const wire=()=>w.querySelectorAll("[data-bau]").forEach(x=>x.onclick=()=>{set(false);const id=x.dataset.bau;if(!ST[id])return;webCam=null;openStop(id,true)});wire();
  // the list itself comes from tools/bau.json via data/platforms.json, so adding a station there updates this menu
  fetch(BASE+"data/platforms.json"+DV).then(r=>r.json()).then(P=>{if(!P.bau||!P.bau.length)return;
    w.querySelector(".moremenu").innerHTML=P.bau.map(m=>`<button data-bau="${esc(m.id)}" role="menuitem"><b>${esc(m.name)}</b><span>${esc(m.sub)}</span></button>`).join("");sortMenu(w.querySelector(".moremenu"));wire()}).catch(()=>{});
  document.addEventListener("click",e=>{if(!w.contains(e.target))set(false)});document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false)})})();
// ---------- Journey Search (was Best connections): stop/station to stop/station planner (data/plan/<day>.json, built weekly)
const PLAN={cache:{},from:null,to:null};
// a journey end is a stop/station id, or a point {ll:[lon,lat],label,sub} (an address, a landmark, a place found online,
// and later "my location"), so everything below asks these helpers rather than looking in ST directly
const epIsStop=e=>typeof e==="string";
const epXY=e=>epIsStop(e)?[ST[e][2],ST[e][1]]:e.ll;
const epName=e=>epIsStop(e)?shortName(ST[e][0]):e.label;
const epFull=e=>e==null?"":epIsStop(e)?ST[e][0]:e.label;
async function planData(ymd){if(PLAN.cache[ymd])return PLAN.cache[ymd];const d=await (await fetch(BASE+"data/plan/"+ymd+".json"+DV)).json();
  d.idx=new Map(d.s.map((k,i)=>[k,i]));d.sp=d.s.map(()=>[]);
  d.p.forEach((p,pi)=>{p.s.forEach((s,pos)=>d.sp[s].push([pi,pos]));p.tt=p.t.map(r=>{const a=new Array(r.length);let c=0;for(let i=0;i<r.length;i++){c+=r[i];a[i]=c}return a})});
  d.xy=d.s.map(k=>ST[k]?[ST[k][2],ST[k][1]]:[0,0]);d.grid=new Map();d.xy.forEach(([x,y],i)=>{const g=Math.floor(x*98.7)+","+Math.floor(y*110.6);let a=d.grid.get(g);if(!a)d.grid.set(g,a=[]);a.push(i)});
  return PLAN.cache[ymd]=d}
const mDist=(a,b)=>Math.hypot((a[0]-b[0])*98.7,(a[1]-b[1])*110.6)*1000;
const walkMin=m=>Math.max(1,Math.ceil(m*1.25/80));   // 80 m a minute, 25% allowance for street layout (straight-line estimates)
const routeMin=m=>Math.max(1,Math.ceil(m/80));        // 80 m a minute along a real walking route
const legMin=l=>l.route?routeMin(l.m):walkMin(l.m);
function nearIdx(d,xy,maxM){const out=[];const gx=Math.floor(xy[0]*98.7),gy=Math.floor(xy[1]*110.6);const r=Math.ceil(maxM/1000);
  for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){const a=d.grid.get((gx+i)+","+(gy+j));if(a)for(const s of a){const m=mDist(xy,d.xy[s]);if(m<=maxM)out.push([s,m])}}return out}
let RAP_BLK=null;   // Set of "pattern:position" a step-free journey can't board or alight at (lift outages), or null
function raptor(d,fromKeys,toKeys,t0,maxM,K=5,startM=maxM){const n=d.s.length,INF=1e9;const BL=RAP_BLK;const best=new Float64Array(n).fill(INF);const arr=[],par=[];
  const fromXY=fromKeys.map(epXY),toXY=toKeys.map(epXY);if(startM<=0&&!fromKeys.every(epIsStop))startM=maxM;
  const start=new Map();if(startM<=0)fromKeys.forEach(k=>{if(d.idx.has(k))start.set(d.idx.get(k),{t:t0,m:0})});else fromXY.forEach(xy=>nearIdx(d,xy,startM).forEach(([s,m])=>{const t=t0+(m<30?0:walkMin(m));if(!start.has(s)||start.get(s).t>t)start.set(s,{t,m})}));
  const end=new Map();toXY.forEach(xy=>nearIdx(d,xy,maxM).forEach(([s,m])=>{const w=m<30?0:walkMin(m);if(!end.has(s)||end.get(s).w>w)end.set(s,{w,m})}));
  arr[0]=new Float64Array(n).fill(INF);par[0]=new Array(n);let marked=new Set();
  for(const [s,v] of start){arr[0][s]=v.t;best[s]=v.t;par[0][s]={type:"start",m:v.m};marked.add(s)}
  let bestT=INF;const res=[];
  for(let k=1;k<=K&&marked.size;k++){arr[k]=new Float64Array(n).fill(INF);par[k]=new Array(n);const Q=new Map();
    for(const s of marked)for(const [pi,pos] of d.sp[s]){if(!Q.has(pi)||Q.get(pi)>pos)Q.set(pi,pos)}
    const newly=new Set();
    for(const [pi,pos0] of Q){const p=d.p[pi];let trip=-1,bpos=-1,bstop=-1;
      for(let i=pos0;i<p.s.length;i++){const s=p.s[i];
        const blk=BL&&BL.has(pi+":"+i);
        if(trip>=0&&!blk){const t=p.tt[trip][i];if(t<best[s]&&t<bestT){arr[k][s]=t;best[s]=t;par[k][s]={type:"ride",pi,trip,from:bstop,bpos,apos:i};newly.add(s)}}
        const prev=blk?INF:arr[k-1][s];if(prev<INF){const ready=prev+(par[k-1][s]&&par[k-1][s].type==="start"?0:1);
          if(trip<0||ready<p.tt[trip][i]){let found=-1;for(let j=0;j<p.tt.length;j++){const tj=p.tt[j][i];if(tj>=ready&&(found<0||tj<p.tt[found][i]))found=j}
            if(found>=0&&(trip<0||p.tt[found][i]<p.tt[trip][i])){trip=found;bpos=i;bstop=s}}}}}
    // walking transfers from stops reached by a vehicle this round
    const walked=new Set();
    for(const s of newly){const t=arr[k][s];for(const [s2,m] of nearIdx(d,d.xy[s],maxM)){if(s2===s)continue;const t2=t+walkMin(m);if(t2<best[s2]&&t2<bestT){arr[k][s2]=t2;best[s2]=t2;par[k][s2]={type:"walk",from:s,m};walked.add(s2)}}}
    marked=new Set([...newly,...walked]);
    let kb=INF,ks=-1;for(const [s,v] of end){if(arr[k][s]<INF&&par[k][s]&&par[k][s].type==="ride"){const t=arr[k][s]+v.w;if(t<kb){kb=t;ks=s}}}
    if(ks>=0&&kb<bestT){bestT=kb;res.push({k,stop:ks,arr:kb,endWalk:end.get(ks)})}}
  return res.map(r=>{const legs=[];let s=r.stop,k=r.k;
    if(r.endWalk.m>=30)legs.push({type:"walk",from:s,toKey:null,m:r.endWalk.m});
    while(k>0){const pr=par[k][s];if(!pr)break;if(pr.type==="walk"){legs.push({type:"walk",from:pr.from,to:s,m:pr.m});s=pr.from;continue}
      if(pr.type==="ride"){const p=d.p[pr.pi];legs.push({type:"ride",pi:pr.pi,trip:pr.trip,bpos:pr.bpos,apos:pr.apos,from:pr.from,to:s,dep:p.tt[pr.trip][pr.bpos],arr:p.tt[pr.trip][pr.apos]});s=pr.from;k--}}
    const st0=par[0][s];if(st0&&st0.m>=30)legs.push({type:"walk",from:null,to:s,m:st0.m});
    legs.reverse();const rides=legs.filter(l=>l.type==="ride");const dep=rides.length?rides[0].dep:t0;const lw=legs[0]&&legs[0].type==="walk"?walkMin(legs[0].m):0;
    return {legs,arr:r.arr,dep,leave:dep-lw,changes:rides.length-1}})}
// days with timetables on hand (data/plan/index.json from the weekly refresh), today onwards
async function cnDays(){const now=bneNow();let days;try{days=(await (await fetch(BASE+"data/plan/index.json"+DV)).json()).days}catch(e){days=[0,1,2,3,4,5,6].map(k=>shiftDay(now.ymd,now.dow,k).ymd)}
  return days.filter(y=>y>=now.ymd).map(y=>{const dt=new Date(Date.UTC(+y.slice(0,4),+y.slice(4,6)-1,+y.slice(6,8)));
    const lab=dt.toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});return [y,y===now.ymd?"Today":y===shiftDay(now.ymd,now.dow,1).ymd?"Tomorrow":lab.replace(",","")]})}
async function planSearch(){const box=document.getElementById("cnRes");const my=PLAN.seq=(PLAN.seq||0)+1;if(!PLAN.from||!PLAN.to){box.innerHTML=`<div class="sub">Choose where you're starting and where you're going.</div>`;return}
  box.innerHTML=`<div class="sub">Finding connections…</div>`;await ensureCal();
  const now=bneNow();const mode=document.getElementById("cnWhen").value;
  let t0=now.min;if(mode!=="now"){const v=document.getElementById("cnTime").value||"08:00";const [h,m]=v.split(":").map(Number);t0=h*60+m}
  const pickDay=mode==="now"?now.ymd:(document.getElementById("cnDay").value||now.ymd);const dayOff=pickDay===now.ymd?0:1;
  const arriveBy=mode==="arrive",byT=t0;if(arriveBy)t0=Math.max(0,byT-240);   // arrive by: look at departures in the 4 hours before
  const day={ymd:pickDay};const maxM=+document.getElementById("cnRad").value;
  let d;try{d=await planData(day.ymd)}catch(e){box.innerHTML=`<div class="sub">Connection data for that day isn't available yet.</div>`;return}
  const fk=[PLAN.from],tk=[PLAN.to];
  // Avoid steps: platforms cut off by a lift outage today aren't used; the quickest journey that needs one is shown last, marked
  const LB=PLAN.noSteps&&dayOff===0?liftBlocks():new Map();let blkSet=null;
  if(LB.size){blkSet=new Set();for(const [sid,b] of LB){const si=d.idx.get(sid);if(si==null)continue;for(const [pi,pos] of d.sp[si]){const p=d.p[pi];if(liftHits(b,p.pl[pos]>=0?(TT.cal.pl||[])[p.pl[pos]]:""))blkSet.add(pi+":"+pos)}}if(!blkSet.size)blkSet=null}
  RAP_BLK=blkSet;   // set for the searches below, cleared after
  // services leaving from the chosen stop or station itself come first; nearby stops are only used if nothing leaves from there
  const run=startM=>{const o=[];let t=t0;
      // leave at: the next few departures. arrive by: step through the departures before the deadline, keeping those that make it
      for(let i=0;i<(arriveBy?40:4)&&(arriveBy||o.length<3);i++){const r=raptor(d,fk,tk,t,maxM,5,startM);if(!r.length)break;
      r.sort((a,b)=>a.arr-b.arr||a.changes-b.changes);for(const x of r){if(arriveBy&&x.arr>byT)continue;if(!o.some(y=>y.leave===x.leave&&y.arr===x.arr&&y.changes===x.changes))o.push(x)}
      const nd=Math.min(...r.map(x=>x.dep))+1;if(arriveBy&&(nd>byT||Math.min(...r.map(x=>x.arr))>byT))break;t=nd}
      if(arriveBy){o.sort((a,b)=>b.leave-a.leave||a.changes-b.changes);return o.slice(0,15)}return o};
  const fromStop=epIsStop(PLAN.from);let opts=run(fromStop?0:maxM),wide=false,extra=null;
  if(!opts.length&&fromStop){opts=run(maxM);wide=opts.length>0}
  // Changes slider: 0 = direct only (falls back to the fewest changes if nothing is direct), 1-3, or any
  const maxCh=+document.getElementById("cnCh").value>=4?99:+document.getElementById("cnCh").value;let chNote="";
  if(maxCh>0&&maxCh<99){const f=opts.filter(x=>x.changes<=maxCh);if(f.length)opts=f;else if(opts.length)chNote=`Nothing gets there with ${maxCh} change${maxCh>1?"s":""} or fewer; showing the options with the fewest changes.`}
  if(maxCh===0&&opts.length&&!opts.some(x=>x.changes===0))chNote="No single service goes all the way, so these include changes.";
  if(arriveBy&&maxCh===0&&opts.some(x=>x.changes===0))opts=opts.filter(x=>x.changes===0);
  else if(maxCh===0&&opts.some(x=>x.changes===0)){const sm=wide||!fromStop?maxM:0;let dir=opts.filter(x=>x.changes===0);let t=Math.max(...dir.map(x=>x.dep))+1;
    for(let i=0;i<8&&dir.length<3;i++){const r=raptor(d,fk,tk,t,maxM,1,sm);if(!r.length)break;const x=r.sort((a,b)=>a.arr-b.arr)[0];if(!dir.some(y=>y.dep===x.dep&&y.arr===x.arr))dir.push(x);t=x.dep+1}
    opts=dir}
  else if(fromStop){const w=run(maxM).filter(x=>x.legs[0]&&x.legs[0].type==="walk").sort((a,b)=>a.arr-b.arr)[0];if(w&&w.arr<=Math.min(...opts.map(x=>x.arr))-15)extra=w}
  if(arriveBy)extra=null;
  RAP_BLK=null;
  let notSF=null;
  if(blkSet){const uses=o=>o.legs.some(l=>l.type==="ride"&&(blkSet.has(l.pi+":"+l.bpos)||blkSet.has(l.pi+":"+l.apos)));
    const r=raptor(d,fk,tk,t0,maxM,5,fromStop?0:maxM).filter(uses).sort((a,b)=>a.arr-b.arr||a.changes-b.changes)[0];
    if(r&&!opts.some(x=>x.arr===r.arr&&x.leave===r.leave&&x.changes===r.changes))notSF=r;
    if(notSF&&chNote&&notSF.changes===0)chNote="The direct service needs a platform whose lift is out of service today, so these step-free options include a change. It's shown last."}
  opts.sort(arriveBy?((a,b)=>b.leave-a.leave||a.changes-b.changes):((a,b)=>a.arr-b.arr||a.changes-b.changes||b.leave-a.leave));const pick=opts.slice(0,4);const show=pick.sort(arriveBy?((a,b)=>a.changes-b.changes||b.leave-a.leave):((a,b)=>a.changes-b.changes||a.arr-b.arr)).slice(0,3);if(extra){extra.walkFirst=true;show.push(extra)}if(notSF){notSF.notSF=true;show.push(notSF)}
  // every walk follows real streets and paths (js/walk.js); times are then worked out from the real distance
  const noSteps=!!PLAN.noSteps;box.innerHTML=`<div class="sub">Finding walking routes…</div>`;
  const xyA=l=>l.from==null?epXY(PLAN.from):d.xy[l.from],xyB=l=>l.to==null?epXY(PLAN.to):d.xy[l.to];
  await Promise.all(show.flatMap(o=>o.legs.filter(l=>l.type==="walk"&&l.m>=40).map(async l=>{try{const r=await walkRoute(xyA(l),xyB(l),{noSteps});if(r){l.route=r;l.m=r.m}}catch(e){}})));
  if(my!==PLAN.seq)return;   // a newer search has started
  show.forEach(o=>{const rides=o.legs.filter(l=>l.type==="ride"),f=o.legs[0],z=o.legs[o.legs.length-1];if(!rides.length)return;
    o.leave=f.type==="walk"&&f.from==null?rides[0].dep-legMin(f):rides[0].dep;o.arr=z.type==="walk"&&z.to==null?rides[rides.length-1].arr+legMin(z):rides[rides.length-1].arr});
  if(arriveBy)for(let i=show.length-1;i>=0;i--)if(show[i].arr>byT)show.splice(i,1);
  // walking all the way: offered when it's within the walking distance, or gets there no later than the fastest service
  // (arrive by: lets you leave no earlier). It goes first only when it's the quickest.
  let walkAll=null;const trans=show.filter(o=>!o.walkFirst);const fastArr=trans.length?Math.min(...trans.map(o=>o.arr)):Infinity,lateLeave=trans.length?Math.max(...trans.map(o=>o.leave)):-Infinity;
  const D=mDist(epXY(PLAN.from),epXY(PLAN.to));
  if(D>=40&&D<=5000&&(D<=maxM*1.1||(arriveBy?byT-routeMin(D)>=lateLeave-10:t0+routeMin(D)<=fastArr+10))){let r=null;try{r=await walkRoute(epXY(PLAN.from),epXY(PLAN.to),{noSteps})}catch(e){}
    const m=r?r.m:D*1.25,mins=routeMin(m);const leave=arriveBy?byT-mins:t0,arr=leave+mins;const quick=arriveBy?leave>=lateLeave:arr<=fastArr;
    if(m<=maxM||quick)walkAll={walkAll:true,quick,legs:[{type:"walk",from:null,to:null,m,route:r}],leave,arr,dep:leave,changes:0}}
  if(my!==PLAN.seq)return;
  if(walkAll){if(walkAll.quick)show.unshift(walkAll);else show.push(walkAll)}
  if(!show.length){box.innerHTML=`<div class="sub">No connection found${arriveBy?` that arrives by ${clock(byT)}`:""}${maxM<2000?" — try a larger walking distance":""}. ${arriveBy?"Try a later time, or":"Services may have finished for the day; try a later day or"} check Translink's journey planner.</div>`;return}
  PLAN.last={d,show};const nm=k=>esc(shortName(ST[d.s[k]]?ST[d.s[k]][0]:d.s[k]));const wideNote=(wide?`<div class="odnote" style="margin-top:0">No services from ${esc(epName(PLAN.from))} itself get there, so these start from stops within ${maxM} m.</div>`:"")+(chNote?`<div class="odnote" style="margin-top:0">${chNote}</div>`:"");
  const main=show.filter(x=>!x.walkFirst&&!x.walkAll&&!x.notSF);const minArr=Math.min(...main.map(x=>x.arr)),fastI=show.findIndex(x=>!x.walkFirst&&!x.walkAll&&!x.notSF&&x.arr===minArr),minCh=main.length?main[0].changes:0;
  const byNote=arriveBy?`<div class="odnote" style="margin-top:0">Latest ways to arrive by ${clock(byT)}${dayOff?" on "+esc(document.getElementById("cnDay").selectedOptions[0].textContent):""}.</div>`:"";
  box.innerHTML=byNote+wideNote+show.map((o,oi)=>{const dur=o.arr-o.leave;
    // with Avoid steps on, a journey whose walk can't avoid steps says so; otherwise steps show as the orange "!" by Walking
    const sfTag=o.notSF?`<span class="cnt cnacc out" title="This journey needs a platform whose lift is out of service today (Translink alert)">Not step-free today: lift out at ${esc([...new Set(o.legs.filter(l=>l.type==="ride").flatMap(l=>[l.from,l.to]).map(k=>d.s[k]).filter(id=>LB.has(id)).map(id=>LB.get(id).nm))].join(", "))}</span>`:"";
    const stepsTag=sfTag+(o.legs.some(l=>l.route&&l.route.forced)?`<span class="cnt cnsteps" title="No step-free way was found for part of the walking">Includes steps</span>`:"");
    const tags=o.walkAll?`<span class="cnt cnwa">Walk all the way</span>${o.quick?`<span class="cnt">Quickest</span>`:""}`:o.walkFirst?`<span class="cnt cnw">${Math.min(...main.map(x=>x.arr))-o.arr} min sooner if you walk to a nearby stop</span>`:((o===main[0]&&main.some(x=>x.changes>minCh)?`<span class="cnt">Fewest changes</span>`:"")+(oi===fastI&&main.some(x=>x.changes!==main[0].changes)?`<span class="cnt">Fastest</span>`:""));
    return `<div class="cno" data-o="${oi}"><div class="cnh"><b>${clock(o.leave)} → ${clock(o.arr)}</b><span>${dur} min · ${o.walkAll?"walk":o.changes?o.changes+" change"+(o.changes>1?"s":""):"direct"}</span>${o.legs.some(l=>l.type==="walk")?`<span class="cnwb"><span class="cnwarn" id="cnWarn${oi}" title="A walk in this journey has a steep stretch or steps" hidden>!</span><button class="cnwalk" data-w="${oi}">Walking ›</button></span>`:""}</div>${(at=>tags||stepsTag||at?`<div class="cntags">${tags}${stepsTag}${at}</div>`:"")(accJourneyTags(o,d))}`+
      o.legs.map((l,li)=>{if(l.type==="walk"){const a=l.from==null?"from "+esc(epName(PLAN.from)):"from "+nm(l.from);const b=l.to==null?"to "+esc(epName(PLAN.to)):"to "+nm(l.to);return `<div class="cnl walk" data-leg="${oi},${li}">🚶 Walk ${Math.round(l.m/10)*10} m (about ${legMin(l)} min) ${a} ${b}</div>`}
        const p=d.p[l.pi];const r=R[p.r];const lab=r.t==="train"?lineAt(p.r,d.s[l.from]):r.t==="tram"?"G:link":r.n;const bd=r.t==="train"?lineBadge(lab):badge(p.r,lab);const pl=p.pl[l.bpos]>=0?(TT.cal.pl||[])[p.pl[l.bpos]]:"";
        return `<div class="cnl" data-leg="${oi},${li}">${bd}<div class="cnlt"><b>${clock(l.dep)}</b> ${nm(l.from)}${pl?` <span class="cnpl">${esc(pl)}</span>`:""} <span class="cnto">→ ${esc(cleanHead(TT.cal.hs[p.h]))}</span><br><b>${clock(l.arr)}</b> ${nm(l.to)} <span class="cnto">· ${l.apos-l.bpos} stop${l.apos-l.bpos>1?"s":""}</span>${li===o.legs.findIndex(x=>x.type==="ride")&&dayOff===0?`<span class="cnlive" id="cnLive${oi}"></span>`:""}</div></div>`}).join("")+`</div>`}).join("")+
    `<div class="odnote">Unofficial: always check times with Translink before travelling. Walking times are estimates. <a href="https://jp.translink.com.au/plan-your-journey/journey-planner" target="_blank" rel="noopener">Translink journey planner ↗</a></div>`;
  box.querySelectorAll(".cno").forEach(el=>el.onclick=e=>{if(e.target.closest("[data-leg],.cnwb"))return;drawOption(+el.dataset.o)});
  box.querySelectorAll(".cnwalk").forEach(b=>b.onclick=e=>{e.stopPropagation();showWalking(+b.dataset.w)});
  // elevation for every walk, so a journey with a steep stretch or steps gets its orange "!" beside the Walking button
  show.forEach((o,oi)=>Promise.all(o.legs.filter(l=>l.type==="walk").map(legProfile)).then(ps=>{if(my!==PLAN.seq)return;const w=document.getElementById("cnWarn"+oi);if(w&&ps.some(p=>p&&p.concern))w.hidden=false}));
  box.querySelectorAll("[data-leg]").forEach(el=>el.onclick=()=>{const [oi,li]=el.dataset.leg.split(",").map(Number);drawOption(oi,li)});
  drawOption(0);if(dayOff===0)planLive(show)}
// ---------- Walking card: every walk in a journey, with its climb, an elevation profile and any steep stretches or steps
const legProfile=l=>l.route?(l.profP||(l.profP=walkProfile(l.route).catch(()=>null))):Promise.resolve(null);
const ORD=["First","Second","Third","Fourth","Fifth","Sixth"];
const gradTxt=p=>{const deg=Math.atan(p/100)*180/Math.PI,one=100/p;return `${p.toFixed(1)}% · ${deg.toFixed(1)}° · 1 in ${one<10?one.toFixed(1):Math.round(one)}`};
const r10=m=>Math.max(10,Math.round(m/10)*10);
function profSVG(pr){const P=pr.prof,L=pr.L;let lo=Math.min(...P.map(p=>p[1])),hi=Math.max(...P.map(p=>p[1]));if(hi-lo<10){const c=(hi+lo)/2;lo=c-5;hi=c+5}
  const X=s=>(s/L*300).toFixed(1),Y=e=>(70-(e-lo)/(hi-lo)*62).toFixed(1);
  const sh=pr.flags.map(f=>`<rect x="${X(f.at)}" y="0" width="${Math.max(1.5,(f.end-f.at)/L*300).toFixed(1)}" height="72" class="wf-${f.kind}"/>`).join("");
  const line=P.map((p,i)=>(i?"L":"M")+X(p[0])+","+Y(p[1])).join("");
  return `<div class="wkpr"><div class="wkax"><span>${Math.round(hi)} m</span><span>${Math.round(lo)} m</span></div><svg viewBox="0 0 300 72" preserveAspectRatio="none" role="img" aria-label="Elevation profile">${sh}<path d="${line}L300,72L0,72Z" class="wkarea"/><path d="${line}" class="wkline" vector-effect="non-scaling-stroke"/></svg></div><div class="wkdx"><span>Start</span><span>${r10(L)} m</span></div>`}
function flagHTML(f){const st=(f.street||"").replace(/^footpath near /,""),beside=f.street&&f.street!==st;
  const where=`${st?(f.kind==="steps"?" near ":beside?" on the footpath near ":" on ")+esc(st):""}, from about ${Math.round(f.at/10)*10} m into the walk`;
  if(f.kind==="indoor")return `<div class="wkflag indoor"><b>Under cover or through a building</b><span>About ${r10(f.len)} m${st?" near "+esc(st):""}, from about ${Math.round(f.at/10)*10} m into the walk. The slope isn't measured here: the height data is bare ground, which isn't known under roofs and buildings.</span></div>`;
  if(f.kind==="steps")return `<div class="wkflag steps"><b>Steps</b><span>About ${r10(f.len)} m of steps${where}</span></div>`;
  return `<div class="wkflag ${f.kind}"><b>${f.kind==="kerb"?"Steeper than a kerb ramp":"Steeper than an accessible ramp"}</b><span>Up to ${gradTxt(f.pct)}${f.pct>WALK_BANDS.ASSIST?" · beyond assisted access":""}</span><span>About ${r10(f.len)} m ${f.dir}${where}</span></div>`}
const WALK_INFO=`<details class="wkinfo"><summary>What this means</summary>
  <p>Steepness is shown three ways. "1 in 14" means the path rises 1 m for every 14 m you walk along it, which is a 7.1% gradient or 4.1°. The bigger the second number, the gentler the slope.</p>
  <p>The bands come from the Australian Standard for access and mobility, AS 1428.1, and the Disability Standards for Accessible Public Transport (DSAPT):</p>
  <ul><li><b>Walkway</b>: up to 1 in 20 (5%, 2.9°). Treated as a level path.</li>
  <li><b>Ramp</b>: 1 in 20 to 1 in 14 (5% to 7.1%). The steepest an accessible ramp may be, and it needs landings to rest on.</li>
  <li><b>Steeper than an accessible ramp</b>: over 1 in 14 (7.1%, 4.1°). Flagged in orange.</li>
  <li><b>Steeper than a kerb ramp</b>: over 1 in 8 (12.5%, 7.1°). Kerb ramps may be this steep only because they're very short. Flagged in red.</li>
  <li><b>Beyond assisted access</b>: over 1 in 4 (25%, 14°). Steeper than any ramp the standards allow, even with someone helping.</li></ul>
  <p>Each walk is labelled by its steepest stretch: Flat (under 2%), Gentle (up to 5%), Moderate (up to 7.1%), Steep (over 7.1%) or Very steep (over 12.5%). ↗ is the total climb and ↘ the total descent.</p>
  <p>Heights come from the Queensland Government's elevation data (QldDem), which across South East Queensland's built-up areas is 1 m LiDAR of the bare ground, with buildings and trees removed. This map keeps its own copy for everywhere within 2 km of a stop, updated when Queensland republishes it; further out it asks Queensland's service directly. Heights are smoothed over about 30 m, so only stretches of about 30 m or longer are flagged; a short steep driveway, kerb or ramp won't show. Bridges, tunnels, and paths under cover or through buildings, are taken as running straight between their two ends, and paths under cover or through buildings are listed as not measured. Only if neither has heights for a walk are satellite heights used (Amazon's open terrain tiles). Those include buildings and trees, so the card says so and marks only steps, not the climb or steep stretches. Steps come from OpenStreetMap, the same data as the base map. Avoid steps keeps walks off steps where the map has another way. This is a guide only, not official accessibility advice; check lifts, kerbs and crossings with Translink before travelling.</p></details>`;
function showWalking(oi){const {d,show}=PLAN.last;const o=show[oi];
  const saved={kind:"cn",nodes:[...pB.childNodes],sub:pS.innerHTML,scroll:pB.scrollTop,prev:backState,oi};
  const nm=k=>esc(shortName(ST[d.s[k]]?ST[d.s[k]][0]:d.s[k]));const walks=o.legs.map((l,li)=>[l,li]).filter(([l])=>l.type==="walk");
  const html=walks.map(([l,li],k)=>{const a=l.from==null?esc(epName(PLAN.from)):nm(l.from),b=l.to==null?esc(epName(PLAN.to)):nm(l.to);
    return `<div class="wk" data-li="${li}"><div class="wkh">${walks.length>1?`<b>${ORD[k]||"Next"} walk:</b> `:"<b>Walk:</b> "}${a} to ${b}</div>
      <div class="wks" id="wks${li}">${r10(l.m)} m · about ${legMin(l)} min</div><div id="wkp${li}" class="wkp">${l.route?`<div class="sub">Loading elevation…</div>`:`<div class="sub">No walking route was found in the map data here, so this is a straight-line estimate.</div>`}</div><div id="wkf${li}"></div></div>`}).join("")+WALK_INFO;
  openPanel("Walking",`${clock(o.leave)} → ${clock(o.arr)} · ${walks.length} walk${walks.length>1?"s":""}`,html,{view:"cn"});setBack(saved);drawOption(oi);
  pB.querySelectorAll(".wkh").forEach(h=>h.onclick=()=>drawOption(oi,+h.parentNode.dataset.li));
  walks.forEach(([l,li])=>legProfile(l).then(pr=>{const p=document.getElementById("wkp"+li),f=document.getElementById("wkf"+li),st=document.getElementById("wks"+li);if(!p||!l.route)return;
    if(!pr){p.innerHTML=`<div class="sub">Elevation isn't available right now.</div>`;return}
    if(pr.rough)p.innerHTML=`<div class="odnote" style="margin-top:0">No Queensland LiDAR heights were available for this walk (it's outside the saved area and Queensland's elevation service couldn't be reached), so satellite heights were used. Those include buildings and trees, so the climb and steep stretches aren't shown. Steps are still marked.</div>`;
    else{st.innerHTML=`${r10(l.m)} m · about ${legMin(l)} min · ↗ ${Math.round(pr.up)} m · ↘ ${Math.round(pr.down)} m · <span class="wkl wkl-${pr.label.replace(" ","").toLowerCase()}">${pr.label}</span>`;p.innerHTML=profSVG(pr)}
    f.innerHTML=(pr.forced?`<div class="odnote" style="margin-top:6px">No step-free way was found for this walk, so it uses steps.</div>`:"")+(l.route.elev?`<div class="wklift">🛗 This walk uses a lift (mapped in OpenStreetMap). If it's out of service, the steps nearby may be the only other way.</div>`:"")+(pr.flags.some(x=>x.kind!=="indoor")?pr.flags.map(flagHTML).join(""):pr.flags.map(flagHTML).join("")+`<div class="wkok">${pr.rough?"No steps on this walk.":"No stretches steeper than an accessible ramp, and no steps."}</div>`)}))}
var cnSnap=null;
function cnLayers(on){if(on){if(cnSnap)return;cnSnap={};GROUPS.forEach(([g])=>{cnSnap[g]=chipState[g];if(g==="live")return;setGroup(g,false)});chipBox.classList.add("dim")}
  else if(cnSnap){GROUPS.forEach(([g])=>{if(g==="live")return;setGroup(g,cnSnap[g]!=="off")});cnSnap=null;chipBox.classList.remove("dim")}}
function drawOption(oi,li){cnLayers(true);const {d,show}=PLAN.last;const o=show[oi];document.querySelectorAll(".cno").forEach(x=>x.classList.toggle("on",+x.dataset.o===oi));
  const lines=[],walks=[];let bb=null;const ext=c=>{bb=bb?[Math.min(bb[0],c[0]),Math.min(bb[1],c[1]),Math.max(bb[2],c[0]),Math.max(bb[3],c[1])]:[c[0],c[1],c[0],c[1]]};
  o.legs.forEach((l,i)=>{if(li!=null&&i!==li)return;if(l.type==="ride"){const p=d.p[l.pi];const c=p.s.slice(l.bpos,l.apos+1).map(s=>d.xy[s]);c.forEach(ext);lines.push({type:"Feature",properties:{c:R[p.r].c,mode:"route"},geometry:{type:"LineString",coordinates:c}})}
    else{const c=l.route?l.route.coords:[l.from==null?epXY(PLAN.from):d.xy[l.from],l.to==null?epXY(PLAN.to):d.xy[l.to]];c.forEach(ext);walks.push({type:"Feature",properties:{c:"#475569"},geometry:{type:"LineString",coordinates:c}})}});
  map.getSource("hl").setData(FC(lines));map.getSource("hlvar").setData(FC(walks));map.getSource("arrows").setData(FC([]));map.getSource("ends").setData(FC([]));
  const ss=[];o.legs.forEach(l=>{if(l.type==="ride"){ss.push(d.xy[l.from],d.xy[l.to])}});map.getSource("hlstops").setData(FC(ss.map(c=>({type:"Feature",properties:{c:"#111827"},geometry:{type:"Point",coordinates:c}}))));
  if(bb)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?560:30,right:40},duration:700,maxZoom:16})}
async function planLive(show){let tf;try{tf=await getTrips()}catch(e){return}const {d}=PLAN.last;
  show.forEach((o,oi)=>{const l=o.legs.find(x=>x.type==="ride");const el=document.getElementById("cnLive"+oi);if(!l||!el)return;const p=d.p[l.pi];const key=d.s[l.from];const ids=new Set([key,...(KIDS[key]||[])]);
    for(const e of tf.entity){const tu=e.tu;if(!tu||!tu.stu||riOfRoute(tu.trip&&tu.trip.route)!==p.r)continue;
      for(const u of tu.stu){if(!ids.has(u.stop))continue;const ev=u.dep||u.arr;if(!ev||!ev.time)continue;if(bneMin(ev.time-(ev.delay||0))!==l.dep%1440)continue;
        const dl=Math.round((ev.delay||0)/60);el.innerHTML=tu.trip.sr===3||u.sr===1?` <span class="lvx">Cancelled</span>`:dl>=2?` <span class="lvl">● ${dl} min late</span>`:` <span class="lvo">● On time</span>`;return}}})}
// From / To suggestions: stations and stops, then landmarks (with their official address), then street addresses
// (G-NAF, data/addr/), and only when nothing matches, a search of OpenStreetMap limited to South East Queensland
const ADDR={places:null,chunks:{}};
const SEQB=[151.8,-28.4,153.6,-26.0],inSEQ=([x,y])=>x>=SEQB[0]&&x<=SEQB[2]&&y>=SEQB[1]&&y<=SEQB[3];
const STTYPE={st:"street",rd:"road",dr:"drive",ct:"court",ave:"avenue",av:"avenue",cres:"crescent",cr:"crescent",pl:"place",pde:"parade",cct:"circuit",tce:"terrace",cl:"close",bvd:"boulevard",blvd:"boulevard",ln:"lane",hwy:"highway",esp:"esplanade",gr:"grove",pkwy:"parkway",sq:"square",mwy:"motorway"};
function addrPlaces(){return ADDR.places||(ADDR.places=fetch(BASE+"data/addr/places.json"+DV).then(r=>r.json()).then(a=>a.map(p=>({n:p[0],k:p[1],a:p[2],ll:[p[3],p[4]],r:p[5],w:norm(p[0]).split(" ")}))).catch(()=>[]))}
function addrChunk(k){return ADDR.chunks[k]||(ADDR.chunks[k]=fetch(BASE+"data/addr/"+k+".json"+DV).then(r=>r.ok?r.json():[]).then(rows=>rows.map(([st,sub,pc,nums,dx,dy])=>({st,sub,pc,nums,dx,dy,key:(st+" "+sub).toLowerCase()}))).catch(()=>[]))}
function addrLL(row,i){let x=0,y=0;for(let j=0;j<=i;j++){x+=row.dx[j];y+=row.dy[j]}return [x/1e5,y/1e5]}
function parseAddr(q){q=q.toLowerCase().replace(/[,]/g," ").replace(/\s+/g," ").trim();
  const m=q.match(/^(?:(?:unit|u|shop|apt)\s*)?(?:\d+[a-z]?\s*\/\s*)?(\d+[a-z]?(?:-\d+[a-z]?)?)\s+(.+)$/);const rest=(m?m[2]:q).split(" ").map((w,i)=>i&&STTYPE[w]||w).join(" ");
  return {num:m?m[1]:null,rest,key:(rest.replace(/[^a-z0-9]/g,"").slice(0,2)+"__").slice(0,2)}}
async function cnSuggest(q){const out=[];const qn=norm(q);if(qn.length<2)return out;
  searchPlaces(q).filter(e=>e.k==="s").slice(0,8).forEach(e=>out.push({g:"Stations and stops",t:ST[e.id][0],ty:e.ty,ep:e.id}));
  const qw=qn.split(" ");const lm=(await addrPlaces()).filter(p=>qw.every(x=>p.w.some(w=>w.startsWith(x))))
    .sort((a,b)=>(b.w.join(" ").startsWith(qn)-a.w.join(" ").startsWith(qn))||a.r-b.r||a.n.length-b.n.length).slice(0,8);
  lm.forEach(p=>out.push({g:"Places",t:p.n,sub:p.a||p.k,ty:p.k,ep:{ll:p.ll,label:p.n,sub:p.a}}));
  const pa=parseAddr(q);if(pa.rest.replace(/[^a-z0-9]/g,"").length>=2){const rows=(await addrChunk(pa.key)).filter(r=>r.key.startsWith(pa.rest)||(r.st.toLowerCase().startsWith(pa.rest)));
    const adds=[];for(const r of rows){const where=`${r.sub} QLD ${r.pc}`.trim();
      if(pa.num){let i=r.nums.indexOf(pa.num);const hits=i>=0?[i]:r.nums.map((n,j)=>n.startsWith(pa.num)?j:-1).filter(j=>j>=0).slice(0,3);
        hits.forEach(j=>adds.push({g:"Addresses",t:`${r.nums[j].toUpperCase()} ${r.st}`,sub:where,ty:"Address",ep:{ll:addrLL(r,j),label:`${r.nums[j].toUpperCase()} ${r.st}, ${r.sub}`,sub:where}}))}
      else{const j=r.nums.length>>1;adds.push({g:"Addresses",t:r.st,sub:where,ty:"Street",ep:{ll:addrLL(r,j),label:`${r.st}, ${r.sub}`,sub:where}})}
      if(adds.length>=12)break}
    out.push(...adds)}
  return out}
// one search of OpenStreetMap (Nominatim), only when asked, kept to SEQ; if the search names a suburb, results elsewhere are dropped
async function cnOnline(q){const u="https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=au&bounded=1&viewbox="+[SEQB[0],SEQB[3],SEQB[2],SEQB[1]].join(",")+"&q="+encodeURIComponent(q);
  let a;try{a=await (await fetch(u,{headers:{"Accept-Language":"en-AU"}})).json()}catch(e){return null}
  const biz=new Set(["shop","craft","office"]);
  let r=a.filter(x=>!biz.has(x.category)&&(x.address||{}).state==="Queensland"&&inSEQ([+x.lon,+x.lat])).map(x=>{const ad=x.address||{};const sub=ad.suburb||ad.town||ad.city_district||ad.village||ad.city||"";
    const name=x.name||[ad.house_number,ad.road].filter(Boolean).join(" ")||x.display_name.split(",")[0];return {t:name,sub:[ad.house_number&&x.name?ad.house_number+" "+(ad.road||""):"",sub,ad.postcode].filter(Boolean).join(", "),sb:sub.toLowerCase(),ll:[+x.lon,+x.lat]}});
  const ql=q.toLowerCase();const named=r.filter(x=>x.sb&&ql.includes(x.sb));if(named.length)r=named;
  return r.map(x=>({g:"Found online (OpenStreetMap)",t:x.t,sub:x.sub,ty:"Online",ep:{ll:x.ll,label:x.t+(x.sb?", "+x.sub.split(", ").slice(-2,-1)[0]:""),sub:x.sub}}))}
function placePicker(inpId,resId,onPick,onClear){const inp=document.getElementById(inpId),res=document.getElementById(resId);let items=[],act=-1,seq=0,chosen=inp.value;
  const row=(e,k)=>`<div class="r" data-k="${k}"><span class="rt"><span>${esc(e.t)}</span>${e.sub?`<span class="rs">${esc(e.sub)}</span>`:""}</span>${typeof e.ep==="string"&&ST[e.ep]?`<span class="mls">${modeLetters(e.ep)}</span>`:""}<span class="ty">${esc(e.ty)}</span></div>`;
  const draw=(list,extra)=>{items=list;act=-1;let g="";res.innerHTML=list.map((e,k)=>(e.g!==g?`<div class="rg">${esc(g=e.g)}</div>`:"")+row(e,k)).join("")+(extra||"");res.style.display=res.innerHTML?"block":"none";
    res.querySelectorAll(".r").forEach(d=>d.onclick=()=>choose(items[+d.dataset.k]));const w=res.querySelector(".rweb");if(w)w.onclick=online};
  async function online(){const q=inp.value.trim(),my=++seq;res.innerHTML=`<div class="empty">Searching OpenStreetMap…</div>`;const r=await cnOnline(q);if(my!==seq)return;
    if(r&&r.length)draw(r,`<div class="rnote">Results from OpenStreetMap, limited to South East Queensland.</div>`);else res.innerHTML=`<div class="empty">${r?"Nothing found in South East Queensland":"Couldn't reach OpenStreetMap; try again"}</div>`}
  function choose(e){if(!e)return;inp.value=chosen=e.ep&&!epIsStop(e.ep)?e.ep.label:e.t;res.style.display="none";inp.blur();onPick(e.ep)}
  inp.oninput=async()=>{if(inp.value!==chosen){chosen=null;onClear&&onClear()}const q=inp.value,my=++seq;const list=await cnSuggest(q);if(my!==seq)return;
    draw(list,!list.length&&norm(q).length>=3?`<div class="empty">No stations, places or addresses match</div><div class="r rweb">🔎 Search online for “${esc(q.trim())}”<span class="ty">OpenStreetMap</span></div>`:"")};
  inp.onkeydown=ev=>{const rows=res.querySelectorAll(".r");if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){ev.preventDefault();act=Math.max(0,Math.min(rows.length-1,act+(ev.key==="ArrowDown"?1:-1)));rows.forEach((r,k)=>r.classList.toggle("act",k===act));rows[act]&&rows[act].scrollIntoView({block:"nearest"})}
    else if(ev.key==="Enter"){const r=rows[act>=0?act:0];if(r)r.click()}else if(ev.key==="Escape")res.style.display="none"};
  inp.addEventListener("focus",()=>{if(inp.value&&inp.value!==chosen)inp.oninput()});
  document.addEventListener("click",ev=>{if(!res.contains(ev.target)&&ev.target!==inp)res.style.display="none"});
  return {set:v=>{inp.value=chosen=v}}}
function showConnections(fromId){focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;PLAN.from=fromId||null;PLAN.to=null;PLAN.last=null;   /* each visit starts fresh */
  const now=bneNow();const hh=String(Math.floor(now.min/60)).padStart(2,"0"),mm=String(now.min%60).padStart(2,"0");
  openPanel("Journey Search","Stations, places and addresses · unofficial",`
    <div class="cnf"><label>From</label><div class="cnin"><input id="cnFrom" class="ttf" placeholder="Station, stop, place or address" autocomplete="off" value="${esc(epFull(PLAN.from))}"><div class="results" id="cnFromR"></div></div></div>
    <div class="cnf"><label>To</label><div class="cnin"><input id="cnTo" class="ttf" placeholder="Station, stop, place or address" autocomplete="off" value="${esc(epFull(PLAN.to))}"><div class="results" id="cnToR"></div></div><button class="btn cnsw" id="cnSwap" title="Swap">⇅</button></div>
    <div class="cnf"><label>When</label><select id="cnWhen" class="ttf cnsel"><option value="now">Leave now</option><option value="leave">Leave at…</option><option value="arrive">Arrive by…</option></select><select id="cnDay" class="ttf cnsel cnday" style="display:none"></select><input id="cnTime" type="time" class="ttf cntime" value="${hh}:${mm}" style="display:none"></div>
    <div class="cnf"><label>Walk up to</label><input id="cnRad" type="range" min="100" max="2000" step="100" value="${PLAN.rad||1000}"><span id="cnRadV" class="cnrv">${PLAN.rad||1000} m</span></div>
    <div class="cnf"><label>Changes</label><input id="cnCh" type="range" min="0" max="4" step="1" value="${PLAN.ch??0}"><span id="cnChV" class="cnrv">${["Direct","Up to 1","Up to 2","Up to 3","Any"][PLAN.ch??0]}</span></div>
    <div class="cnf"><label>Avoid steps</label><label class="cnsw2"><input type="checkbox" id="cnNoSteps"${PLAN.noSteps?" checked":""}><span></span></label><span class="cnrv" id="cnNoStepsV">${PLAN.noSteps?"On":"Off"}</span></div>
    <div class="cnhelp">From a stop or station, services leaving there come first; nearby stops within this distance are used to change, to finish, and to start only if nothing leaves from your stop. From a place or address, you walk to the stops within this distance.</div>
    <div class="webrow"><button class="btn" id="cnGo">Find connections</button></div><div id="cnRes"></div>`,{view:"cn"});
  // a start filled in from a stop card stays until the box is edited; then it's cleared and you choose your own
  const pf=placePicker("cnFrom","cnFromR",ep=>{PLAN.from=ep;planSearch()},()=>{PLAN.from=null}),pt=placePicker("cnTo","cnToR",ep=>{PLAN.to=ep;planSearch()},()=>{PLAN.to=null});
  document.getElementById("cnSwap").onclick=()=>{[PLAN.from,PLAN.to]=[PLAN.to,PLAN.from];pf.set(epFull(PLAN.from));pt.set(epFull(PLAN.to));planSearch()};
  const w=document.getElementById("cnWhen");w.onchange=()=>{const later=w.value!=="now";document.getElementById("cnTime").style.display=later?"":"none";document.getElementById("cnDay").style.display=later?"":"none";planSearch()};document.getElementById("cnTime").onchange=planSearch;
  cnDays().then(days=>{const sel=document.getElementById("cnDay");if(!sel)return;sel.innerHTML=days.map(([ymd,lab])=>`<option value="${ymd}">${lab}</option>`).join("");sel.onchange=planSearch});
  const chs=document.getElementById("cnCh");chs.oninput=()=>{PLAN.ch=+chs.value;document.getElementById("cnChV").textContent=["Direct","Up to 1","Up to 2","Up to 3","Any"][PLAN.ch]};chs.onchange=planSearch;
  const rd=document.getElementById("cnRad");rd.oninput=()=>{PLAN.rad=+rd.value;document.getElementById("cnRadV").textContent=rd.value+" m"};rd.onchange=planSearch;
  const ns=document.getElementById("cnNoSteps");ns.onchange=()=>{PLAN.noSteps=ns.checked;document.getElementById("cnNoStepsV").textContent=ns.checked?"On":"Off";planSearch()};
  document.getElementById("cnGo").onclick=planSearch;if(PLAN.from&&PLAN.to)planSearch();else document.getElementById("cnRes").innerHTML=""}
// ---------- go card vendors (data/retailers.json from Translink's retailer feed, refreshed weekly)
let GC=null,gcOn=false,gcSnap=null;const GCF={svc:"",card:""};
const GC_CAP={gb:["go card","Buy"],gt:["go card","Top up"],gr:["go card","Refund"],ge:["go card","Change expiry date"],gg:["go card","Register"],gv:["go card","View balance"],gh:["go card","View history"],eb:["go explore card","Buy"],et:["go explore card","Top up"],el:["go explore card","Reload"]};
const GC_MAIN={"go card":["gb","gt","gr","ge"],"go explore card":["eb","et"]};
const gcCaps=c=>(c.match(/../g)||[]);
const gcKind=r=>r[5]==="m"?"Fare machine":/ station$/i.test(r[1])&&!/smith|news|eleven|store|shop|iga\b|pharm|mart|cafe|kiosk/i.test(r[1])?"Station ticket office":"Retailer";
function gcCodes(){const s=GCF.svc,c=GCF.card;const m={buy:["gb","eb"],top:["gt","et","el"],ref:["gr"],exp:["ge"]};
  let codes=s?m[s]:null;if(c==="g")codes=(codes||GC_MAIN["go card"].concat(["gg","gv","gh"])).filter(x=>x[0]==="g");if(c==="e")codes=(codes||["eb","et","el"]).filter(x=>x[0]==="e");return codes}
const gcPass=r=>{if(GCF.card==="m"&&r[5]!=="m")return false;const k=gcCodes();if(!k)return true;const cs=gcCaps(r[6]);return k.some(x=>cs.includes(x))};
function gcFilter(){const k=gcCodes();const f=k?["any",...k.map(x=>["in",","+x+",",["get","c"]])]:null;if(GCF.card!=="m")return f;const m=["==",["get","k"],"m"];return f?["all",m,f]:m}
function gcSetup(){if(map.getSource("gcv"))return;
  map.addSource("gcv",{type:"geojson",data:FC(GC.r.map((r,i)=>({type:"Feature",properties:{i,n:r[1],k:r[5],c:","+gcCaps(r[6]).join(",")+","},geometry:{type:"Point",coordinates:[r[3],r[4]]}})))});
  map.addLayer({id:"gc-pin",type:"circle",source:"gcv",paint:{"circle-color":["match",["get","k"],"m","#64748b","#f97316"],"circle-radius":["interpolate",["linear"],["zoom"],9,["match",["get","k"],"m",2.5,3.5],14,["match",["get","k"],"m",5,7.5]],"circle-stroke-color":"#ffffff","circle-stroke-width":["interpolate",["linear"],["zoom"],9,.8,14,1.8]}},"sel");
  map.addLayer({id:"gc-lbl",type:"symbol",source:"gcv",minzoom:14.5,layout:{"text-field":["get","n"],"text-font":FONT,"text-size":11.5,"text-offset":[0,1.1],"text-anchor":"top","text-optional":true},paint:{"text-color":"#9a3412","text-halo-color":"#ffffff","text-halo-width":1.8}},"sel");
  L.push("gc-pin","gc-lbl");gcPaint();
  map.on("mouseenter","gc-pin",e=>{map.getCanvas().style.cursor="pointer";pop.setLngLat(e.lngLat).setText(e.features[0].properties.n).addTo(map)});
  map.on("mouseleave","gc-pin",()=>{map.getCanvas().style.cursor="";pop.remove()});
  map.on("moveend",()=>{if(gcOn&&view==="gc")gcList()})}
function gcPaint(){if(!map.getLayer("gc-lbl"))return;const d=theme!=="light";map.setPaintProperty("gc-lbl","text-color",d?"#fdba74":"#9a3412");map.setPaintProperty("gc-lbl","text-halo-color",d?"#0b1220":"#ffffff");map.setPaintProperty("gc-pin","circle-stroke-color",d?"#0b1220":"#ffffff")}
function gcVis(v){["gc-pin","gc-lbl"].forEach(id=>map.getLayer(id)&&map.setLayoutProperty(id,"visibility",v?"visible":"none"))}
function gcApply(){const f=gcFilter();["gc-pin","gc-lbl"].forEach(id=>map.getLayer(id)&&map.setFilter(id,f))}
function gcLayers(on){if(on){if(gcSnap)return;gcSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{gcSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(gcSnap){Object.entries(gcSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});gcSnap=null}
  renderAll();hint()}
function gcList(){const el=document.getElementById("gcList");if(!el)return;const b=map.getBounds(),c=map.getCenter();
  const cos=Math.cos(c.lat*Math.PI/180);const inV=GC.r.filter(r=>gcPass(r)&&b.contains([r[3],r[4]]));
  inV.sort((a,z)=>((a[3]-c.lng)*cos)**2+(a[4]-c.lat)**2-(((z[3]-c.lng)*cos)**2+(z[4]-c.lat)**2));
  const n=GC.r.filter(gcPass).length;
  document.getElementById("gcCount").textContent=`${n} location${n===1?"":"s"} match · ${inV.length} in this view`;
  el.innerHTML=inV.length?`<div class="grp">Closest to the middle of the map</div>`+inV.slice(0,12).map(r=>`<a href="#" class="gce" data-gc="${GC.r.indexOf(r)}"><span class="gcd ${r[5]==="m"?"m":""}"></span><span><b>${esc(r[1])}</b><span class="gca">${esc(gcKind(r))} · ${esc(r[2])}</span></span></a>`).join(""):`<div class="sub">None in this part of the map. Zoom out or change the filters.</div>`;
  el.querySelectorAll("[data-gc]").forEach(a=>a.onclick=e=>{e.preventDefault();gcCard(+a.dataset.gc,true)})}
function gcOverview(){const sb=(k,t)=>`<button class="gcb${GCF.svc===k?" on":""}" data-svc="${k}">${t}</button>`,cb=(k,t)=>`<button class="gcb${GCF.card===k?" on":""}" data-card="${k}">${t}</button>`;
  const h=`<div class="gcf"><div class="gcfl">I want to</div><div class="gcbs">${sb("","Anything")}${sb("buy","Buy")}${sb("top","Top up")}${sb("ref","Get a refund")}${sb("exp","Change expiry")}</div>
   <div class="gcfl">Card type</div><div class="gcbs">${cb("","Any")}${cb("g","<i>go</i> card")}${cb("e","<i>go explore</i> card")}${cb("m","Fare machines")}</div></div>
   <div class="gcn" id="gcCount"></div><div id="gcList"></div>
   <div class="odnote"><span class="gcd"></span> Orange: retailers and station ticket offices. <span class="gcd m"></span> Grey: fare machines. Tap a dot to see what that location can do. Refunds and expiry changes are for <i>go</i> cards only. Fare machines shows only the machines at stations, busways and tram stops. Use – to shrink this card and tap its title to bring it back. From Translink's retailer list, ${esc(GC.updated)}; see <a href="https://translink.com.au/tickets-and-fares/go-card/locations" target="_blank" rel="noopener">translink.com.au</a>. <i>go</i> card services are also online and on 13 12 30.</div>`;
  openPanel("go card vendors","Where to buy, top up, refund or change expiry",h,{view:"gc"});backState=null;pBack.style.display="none";
  pB.querySelectorAll("[data-svc]").forEach(x=>x.onclick=()=>{GCF.svc=x.dataset.svc;if(GCF.card==="e"&&(GCF.svc==="ref"||GCF.svc==="exp"))GCF.card="";gcApply();gcOverview()});
  pB.querySelectorAll("[data-card]").forEach(x=>x.onclick=()=>{GCF.card=x.dataset.card;if(GCF.card==="e"&&(GCF.svc==="ref"||GCF.svc==="exp"))GCF.svc="";gcApply();gcOverview()});
  gcList()}
function gcCard(i,fly){const r=GC.r[i];const cs=gcCaps(r[6]);
  const sec=card=>{const main=GC_MAIN[card],extra=cs.filter(x=>GC_CAP[x][0]===card&&!main.includes(x));const any=cs.some(x=>GC_CAP[x][0]===card);
    if(!any&&card!=="go card")return "";const nm=card==="go card"?"<i>go</i> card":"<i>go explore</i> card";
    return `<div class="grp">${nm}</div><ul class="gccap">`+main.map(x=>`<li class="${cs.includes(x)?"y":"n"}">${cs.includes(x)?"✓":"✗"} ${GC_CAP[x][1]}</li>`).join("")+extra.map(x=>`<li class="y">✓ ${GC_CAP[x][1]}</li>`).join("")+`</ul>`};
  const h=`<div class="gcaddr">${esc(r[2])}</div>`+sec("go card")+sec("go explore card")
   +(cs.some(x=>x[0]==="e")?"":`<div class="odnote">No <i>go explore</i> card services here.</div>`)
   +`<p class="odlink"><a href="https://translink.com.au/tickets-and-fares/go-card/locations/${r[0]}/details" target="_blank" rel="noopener">This location on Translink's site ↗</a></p><div class="odnote"><a href="#" id="gcAll">‹ All go card vendors</a></div>`;
  openPanel(r[1],esc(gcKind(r)),h,{view:"gcv"});setBack({kind:"gc"});selPt([r[3],r[4]]);
  if(fly)map.flyTo({center:[r[3],r[4]],zoom:Math.max(map.getZoom(),15),duration:700});
  document.getElementById("gcAll").onclick=e=>{e.preventDefault();gcOverview()}}
async function toggleGC(){const btn=document.getElementById("gcBtn");
  if(gcOn){gcOn=false;gcVis(false);gcLayers(false);btn.classList.remove("gcon");if(view==="gc"||view==="gcv")closePanel();return}
  if(odOn)await toggleOD();if(pjOn)await togglePJ(pjOn);if(typeof hmOn!=="undefined"&&hmOn)await toggleHM();if(typeof rbOn!=="undefined"&&rbOn)await toggleRB();
  if(!GC){try{GC=await (await fetch(BASE+"data/retailers.json"+DV)).json()}catch(e){openPanel("go card vendors","",`<div class="sub">Vendor locations unavailable. See translink.com.au or call 13 12 30.</div>`);return}}
  gcSetup();gcApply();gcOn=true;gcVis(true);gcLayers(true);btn.classList.add("gcon");focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  gcOverview()}
document.getElementById("gcBtn").onclick=toggleGC;
map.on("click",e=>{if(!gcOn)return;const box=[[e.point.x-7,e.point.y-7],[e.point.x+7,e.point.y+7]];
  const f=map.queryRenderedFeatures(box,{layers:["gc-pin"]});if(!f.length)return;gcCard(+f[0].properties.i,false)});
// ---------- lost property (data/lostproperty.json, edited by hand)
let LOST=null;
async function showLost(q){focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  if(!LOST){try{LOST=await (await fetch(BASE+"data/lostproperty.json?v="+Date.now())).json()}catch(e){openPanel("Lost property","",`<div class="sub">Lost property details unavailable. Call Translink on 13 12 30.</div>`);return}}
  q=(q||"").trim().toLowerCase();
  const ent=e=>{const tel=e.phone?`<a href="tel:${esc(e.phone.replace(/\s/g,""))}">${esc(e.phone)}</a>`:"";const lk=e.link?`<a href="${esc(e.link)}" target="_blank" rel="noopener">Lost property page ↗</a>`:"";
    return `<div class="lpe"><b>${esc(e.name)}</b>${e.area?`<span class="lpa">${esc(e.area)}</span>`:""}<span class="lpc">${[lk,tel].filter(Boolean).join(" · ")||"Contact details coming soon"}</span></div>`};
  const body=LOST.sections.map(sec=>{const es=sec.entries.filter(e=>!q||(e.name+" "+e.area+" "+sec.title).toLowerCase().includes(q));return es.length?`<div class="grp">${esc(sec.title)}</div>`+es.map(ent).join(""):""}).join("")||`<div class="sub">No operators match.</div>`;
  if(view!=="lost"||!pB.querySelector("#lpQ")){
    openPanel("Lost property","Who to contact about items left on public transport",`<div class="schnote"><p>${esc(LOST.intro)}</p></div><input id="lpQ" class="ttf schq" placeholder="Search an operator, mode or area" autocomplete="off"><div id="lpList"></div>`,{view:"lost"});
    document.getElementById("lpQ").oninput=e=>showLost(e.target.value)}
  document.getElementById("lpList").innerHTML=body}
document.getElementById("lostBtn").onclick=()=>showLost("");
// menus list their items alphabetically by title (ignoring case and a leading "The"), so anything added later falls into place
function sortMenu(m){if(!m)return;const key=x=>((x.querySelector("b")||x).textContent||"").trim().replace(/^the\s+/i,"").toLowerCase();
  [...m.children].sort((a,b)=>key(a).localeCompare(key(b),"en-AU")).forEach(x=>m.appendChild(x))}
sortMenu(document.getElementById("moreMenu"));sortMenu(document.querySelector("#bauWrap .moremenu"));
// ---------- Queensland Rail Commuter Catch-Ups (data/catchups.json, from Queensland Rail's page, refreshed weekly)
let CCU=null;
async function showCatchups(){focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  if(!CCU){try{CCU=await (await fetch(BASE+"data/catchups.json"+DV)).json()}catch(e){openPanel("Commuter Catch-Ups","Queensland Rail",`<div class="sub">Session details are unavailable right now. See <a href="https://www.queenslandrail.com.au/inthecommunity/communityengagement/commuter-catch-ups" target="_blank" rel="noopener">Queensland Rail's Commuter Catch-Ups page ↗</a>.</div>`);return}}
  const today=bneNow().ymd;const iso=d=>d.replace(/-/g,"");const up=(CCU.sessions||[]).filter(x=>iso(x.date)>=today);
  const fmt=d=>new Date(d+"T00:00:00+10:00").toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Brisbane"});
  const mon=d=>new Date(d+"T00:00:00+10:00").toLocaleDateString("en-AU",{month:"long",year:"numeric",timeZone:"Australia/Brisbane"});
  let h=`<p class="pjp">Commuter Catch-Ups are drop-in sessions where Queensland Rail staff visit a station so you can have your say on how they can improve the travel experience. Check the list for when they're visiting your station.</p>`;
  if(up.length){let m="";h+=`<div class="grp">Upcoming sessions</div><div class="ccu">`+up.map(x=>{const head=mon(x.date)!==m?`<div class="pjg">${esc(m=mon(x.date))}</div>`:"";
      const st=x.id&&ST[x.id]?`<a href="#" data-ccu="${esc(x.id)}">${esc(ST[x.id][0])}</a>`:esc(x.station);
      return head+`<div class="ccur"><span class="ccud">${esc(fmt(x.date))}${iso(x.date)===today?` <span class="cnt">Today</span>`:""}</span><span class="ccus">${st}</span><span class="ccut">${esc(x.time.replace(/\s*-\s*/," – "))}</span></div>`}).join("")+`</div>`}
  else h+=`<div class="sub">No upcoming sessions are listed right now. Queensland Rail adds new ones to its page; the email notifications below let you know when.</div>`;
  h+=`<div class="grp">Contact</div><ul class="pjlinks"><li>Email <a href="mailto:${esc(CCU.email||"CommuterCatchUps@qr.com.au")}">${esc(CCU.email||"CommuterCatchUps@qr.com.au")}</a></li><li>Queensland Rail (business hours): <a href="tel:131617">13 16 17</a></li></ul>`;
  h+=`<div class="grp">Queensland Rail links</div><ul class="pjlinks"><li><a href="${esc(CCU.url||"https://www.queenslandrail.com.au/inthecommunity/communityengagement/commuter-catch-ups")}" target="_blank" rel="noopener">Commuter Catch-Ups page ↗</a></li><li><a href="https://www.queenslandrail.com.au/inthecommunity/communityengagement/email-notification-registration" target="_blank" rel="noopener">Email notifications about new sessions ↗</a></li><li><a href="https://www.queenslandrail.com.au/inthecommunity/communityengagement/crg" target="_blank" rel="noopener">Customer reference groups ↗</a></li></ul>`;
  h+=`<div class="odnote">Unofficial copy of the sessions on Queensland Rail's page, checked ${esc(CCU.checked||"")}. Check the page before you go, in case a session changes.</div>`;
  openPanel("Commuter Catch-Ups",`Queensland Rail · ${up.length} upcoming session${up.length===1?"":"s"}`,h,{view:"ccu"});
  pB.querySelectorAll("[data-ccu]").forEach(a=>a.onclick=e=>{e.preventDefault();openStop(a.dataset.ccu,true);setBack({kind:"ccu"})})}
document.getElementById("ccuBtn").onclick=()=>showCatchups();
// ---------- Notes (More ▾): kept only in this browser on this device (localStorage "seqmap_notes"); nothing is sent anywhere.
// Export all as a .json backup (imports back exactly) or a .csv spreadsheet; copy all as text; each note can be
// downloaded as .txt or copied. Import takes a .json backup (merged, newer edit wins) or a .txt file (one new note).
const NOTES_KEY="seqmap_notes";
function notesLoad(){try{const a=JSON.parse(localStorage.getItem(NOTES_KEY)||"[]");return Array.isArray(a)?a:[]}catch(e){return []}}
function notesSave(a){try{localStorage.setItem(NOTES_KEY,JSON.stringify(a));return true}catch(e){return false}}
const NT_MAX=25;const ntCut=t=>{t=(t||"").replace(/\s+/g," ").trim();return t.length>NT_MAX?t.slice(0,NT_MAX).trimEnd()+"…":t};
const noteAuto=n=>ntCut(n.text)||ntCut(((Array.isArray(n.c)?n.c:[]).find(c=>(c.name||"").trim())||{}).name)||"Empty note";
const noteTitle=n=>ntCut(n.title)||noteAuto(n);
const noteWhen=t=>new Date(t).toLocaleString("en-AU",{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"Australia/Brisbane"});
const noteId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const isApple=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
// saving a file: the share sheet on iPhone and iPad (Save to Files, AirDrop, Mail ...), a normal download elsewhere
async function saveFile(name,mime,text){const blob=new Blob([text],{type:mime});
  try{const f=new File([blob],name,{type:mime});if(isApple()&&navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e&&e.name==="AbortError")return}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch(e){const ta=document.createElement("textarea");ta.value=t;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand("copy")}catch(e2){}ta.remove();return ok}}
function noteFlash(el,msg){if(!el)return;el.textContent=msg;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),2500)}
// counters: each note starts with one (nameable, anything worth counting); more can be added
const CT_MAX=40,CT_TOP=99999;
const noteCtrs=n=>Array.isArray(n.c)?n.c:[{id:"c0",name:"",v:0}];
const ctrUsed=n=>noteCtrs(n).filter(c=>(c.name||"").trim()||c.v);
const ctrLine=c=>`${(c.name||"").trim()||"Counter"}: ${c.v||0}`;
const noteAsText=n=>{const cs=ctrUsed(n);return ((n.title||"").trim()?n.title.trim()+"\n\n":"")+(n.text||"")+(cs.length?((n.text||"").trim()?"\n\n":"")+cs.map(ctrLine).join("\n"):"")};
const fileSafe=s=>s.replace(/[\\/:*?"<>|…]+/g,"").replace(/\s+/g," ").trim().slice(0,60)||"note";
let NQ="";
// the Export ▾ menu floats over the page (so the card's edges never cut it off): below the button, or above when there's no room
function noteMenu(btn,items){const old=document.getElementById("nFloat");if(old){const same=old._btn===btn;old._close();if(same)return}
  const m=document.createElement("div");m.id="nFloat";m.className="moremenu nfloat";m.setAttribute("role","menu");m._btn=btn;
  m.innerHTML=items.map((it,i)=>`<button role="menuitem" data-i="${i}"><b>${esc(it[0])}</b><span>${esc(it[1])}</span></button>`).join("");
  document.body.appendChild(m);const r=btn.getBoundingClientRect(),h=m.offsetHeight,w=m.offsetWidth,vh=window.innerHeight,vw=window.innerWidth;
  m.style.left=Math.max(8,Math.min(r.left,vw-w-8))+"px";m.style.top=(vh-r.bottom-8>=h||r.top<h+8?Math.min(r.bottom+6,vh-h-8):r.top-h-6)+"px";
  const close=()=>{m.remove();document.removeEventListener("click",out,true);window.removeEventListener("resize",close);pB.removeEventListener("scroll",close)};m._close=close;
  const out=e=>{if(!m.contains(e.target)&&!btn.contains(e.target))close()};
  setTimeout(()=>{document.addEventListener("click",out,true);window.addEventListener("resize",close);pB.addEventListener("scroll",close)},0);
  m.querySelectorAll("button").forEach(b=>b.onclick=()=>{close();items[+b.dataset.i][2]()})}
const nCloseMenu=()=>{const m=document.getElementById("nFloat");if(m)m._close()};
// the red "are you sure" box: takes the place of the buttons it belongs to until Delete or Cancel
function noteConfirm(hideEl,afterEl,text,yes,word){const c=document.createElement("div");c.className="ndelc";
  c.innerHTML=`<span>${esc(text)}</span><button class="btn ndel">${esc(word||"Delete")}</button><button class="btn">Cancel</button>`;
  hideEl.style.display="none";afterEl.after(c);const [d,n]=c.querySelectorAll("button");n.onclick=()=>{c.remove();hideEl.style.display=""};d.onclick=yes;n.focus()}
function showNotes(msg){notesTidy();nCloseMenu();focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  const all=notesLoad();
  openPanel("Notes",`${all.length} note${all.length===1?"":"s"} · saved on this device only`,
    `<div class="ntop"><input id="nQ" class="ttf schq" placeholder="Search your notes" autocomplete="off" value="${esc(NQ)}"><button class="btn" id="nNew">+ New note</button></div><div id="nMsg" class="nmsg${msg?" show":""}">${esc(msg||"")}</div><div id="nList"></div>
    <div class="nbar" id="nBar"><button class="btn" id="nExp" aria-haspopup="true">Export ▾</button><button class="btn" id="nCopyAll">Copy all</button><button class="btn" id="nImp">Import</button><button class="btn ndel" id="nDelAll">Delete all</button><input type="file" id="nFile" accept=".json,.txt,application/json,text/plain" hidden></div>
    <div class="odnote">Notes are saved in this browser on this device only. They aren't sent anywhere, don't sync to your other devices, and are lost if this browser's website data is cleared, so export a backup now and then. Anyone using this browser on this device can see them. Import adds a .json backup's notes to these (keeping the most recently edited copy of any note already here), or a .txt file as a new note.</div>`,{view:"notes"});
  const q=document.getElementById("nQ");q.oninput=()=>{NQ=q.value;notesList()};
  document.getElementById("nNew").onclick=()=>{const a=notesLoad(),n={id:noteId(),title:"",text:"",created:Date.now(),updated:Date.now()};a.push(n);notesSave(a);showNote(n.id,true)};
  const ex=document.getElementById("nExp");ex.onclick=e=>{e.stopPropagation();if(!notesLoad().length)return noteFlash(document.getElementById("nMsg"),"No notes to export yet.");
    noteMenu(ex,[["Backup file (.json)","Every note, to import back into the map later",()=>notesExport("json")],["Spreadsheet (.csv)","Every note as a row, opens in Excel or Numbers",()=>notesExport("csv")]])};
  document.getElementById("nCopyAll").onclick=async()=>{const a=notesLoad().sort((x,y)=>y.updated-x.updated);if(!a.length)return noteFlash(document.getElementById("nMsg"),"No notes to copy yet.");
    const ok=await copyText(a.map(n=>`${noteTitle(n)}\n(last edited ${noteWhen(n.updated)})\n\n${n.text||""}`).join("\n\n————————\n\n"));noteFlash(document.getElementById("nMsg"),ok?`Copied ${a.length} note${a.length===1?"":"s"} as text.`:"Couldn't copy here; try Export instead.")};
  const fi=document.getElementById("nFile");document.getElementById("nImp").onclick=()=>fi.click();fi.onchange=()=>{if(fi.files[0])notesImport(fi.files[0]);fi.value=""};
  document.getElementById("nDelAll").onclick=()=>{const k=notesLoad().length;if(!k)return noteFlash(document.getElementById("nMsg"),"No notes to delete.");nCloseMenu();
    const bar=document.getElementById("nBar");noteConfirm(bar,bar,`Delete all ${k} note${k===1?"":"s"}? This can't be undone.`,()=>{notesSave([]);showNotes("All notes deleted.")})};
  notesList()}
function notesList(){const box=document.getElementById("nList");if(!box)return;const q=NQ.trim().toLowerCase();
  const a=notesLoad().filter(n=>!q||(noteTitle(n)+" "+(n.text||"")).toLowerCase().includes(q)).sort((x,y)=>y.updated-x.updated);
  box.innerHTML=a.length?a.map(n=>`<div class="nrw"><a href="#" class="nrow" data-note="${esc(n.id)}"><b>${esc(noteTitle(n))}</b><span>${esc(noteWhen(n.updated))}${(n.title||"").trim()&&n.text?" · "+esc(noteAuto(n)):""}</span>${ctrUsed(n).length?`<span class="nrc">${ctrUsed(n).map(c=>`<i>${esc((c.name||"").trim()||"Counter")} <b>${c.v||0}</b></i>`).join("")}</span>`:""}</a><button class="nbin" data-bin="${esc(n.id)}" title="Delete this note" aria-label="Delete ${esc(noteTitle(n))}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></div>`).join(""):`<div class="sub">${notesLoad().length?"No notes match.":"No notes yet. Tap + New note to write one."}</div>`;
  box.querySelectorAll("[data-note]").forEach(r=>r.onclick=e=>{e.preventDefault();showNote(r.dataset.note)});
  box.querySelectorAll("[data-bin]").forEach(b=>b.onclick=()=>{const row=b.parentElement,id=b.dataset.bin;box.querySelectorAll(".ndelc").forEach(c=>c.querySelector("button+button").click());
    noteConfirm(row,row,`Delete “${noteTitle(notesLoad().find(x=>x.id===id)||{})}”? This can't be undone.`,()=>{notesSave(notesLoad().filter(x=>x.id!==id));showNotes("Note deleted.")})})}
function showNote(id,fresh){nCloseMenu();const n=notesLoad().find(x=>x.id===id);if(!n)return showNotes();
  openPanel(noteTitle(n),`Last edited ${noteWhen(n.updated)}`,
    `<input id="nTitle" class="ttf ntitle" maxlength="25" placeholder="Title: ${esc(noteAuto(n))}" value="${esc(n.title||"")}" autocomplete="off" aria-label="Title (leave empty to use the first words)">
    <textarea id="nText" class="ntext" placeholder="Write your note…">${esc(n.text||"")}</textarea><div class="nctl">Counters</div><div id="nCtrs"></div><button class="btn nctadd" id="nCtAdd">+ Add counter</button><div id="nMsg" class="nmsg"></div>
    <div class="nbar" id="nBar"><button class="btn" id="nExp1" aria-haspopup="true">Export ▾</button><button class="btn" id="nCopy">Copy</button><button class="btn ndel" id="nDel">Delete</button></div>
    <div class="odnote">Saved as you type, on this device only. The title is the note's first 25 characters unless you type your own in the top box. Name a counter for anything you want to count, then use − and + or type a number in.</div>`,{view:"note"});
  setBack({kind:"notes"});
  const upd=f=>{const a=notesLoad(),x=a.find(y=>y.id===id);if(!x)return;f(x);x.updated=Date.now();notesSave(a);pT.textContent=noteTitle(x);pS.textContent="Last edited "+noteWhen(x.updated)};
  const ta=document.getElementById("nText"),ti=document.getElementById("nTitle");
  ta.oninput=()=>{upd(x=>x.text=ta.value);ti.placeholder="Title: "+noteAuto({text:ta.value})};ti.oninput=()=>upd(x=>x.title=ti.value.slice(0,NT_MAX).trim());
  ti.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();ta.focus()}};if(fresh)setTimeout(()=>ta.focus(),60);
  const cur=()=>notesLoad().find(y=>y.id===id);
  // counters
  const cbox=document.getElementById("nCtrs");const setC=f=>upd(x=>{const c=noteCtrs(x).map(q=>({...q}));f(c);x.c=c});
  const ctrRender=()=>{const cs=noteCtrs(cur()||{});
    cbox.innerHTML=cs.length?cs.map(c=>`<div class="nct" data-ct="${esc(c.id)}"><input class="ttf nctn" maxlength="${CT_MAX}" placeholder="Name it, e.g. Services running late" value="${esc(c.name||"")}" aria-label="Counter name"><div class="nctb"><button class="nctpm" data-pm="-1" aria-label="Take one off">−</button><input class="nctv" type="text" inputmode="numeric" pattern="[0-9]*" value="${c.v||0}" aria-label="Count"><button class="nctpm" data-pm="1" aria-label="Add one">+</button><button class="btn nctr" data-rs title="Reset to 0">Reset</button><button class="nbin" data-cbin title="Remove this counter" aria-label="Remove this counter"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></div></div>`).join(""):`<div class="sub">No counters. Tap + Add counter to start one.</div>`;
    cbox.querySelectorAll(".nct").forEach(row=>{const cid=row.dataset.ct,nm=row.querySelector(".nctn"),vv=row.querySelector(".nctv");const lab=()=>(nm.value||"").trim()||"this counter";
      const put=v=>{v=Math.max(0,Math.min(CT_TOP,v|0));vv.value=v;setC(c=>{const q=c.find(z=>z.id===cid);if(q)q.v=v})};
      nm.oninput=()=>setC(c=>{const q=c.find(z=>z.id===cid);if(q)q.name=nm.value.slice(0,CT_MAX)});nm.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();nm.blur()}};
      row.querySelectorAll("[data-pm]").forEach(b=>b.onclick=()=>put((parseInt(vv.value,10)||0)+ +b.dataset.pm));
      vv.oninput=()=>{const d=vv.value.replace(/\D/g,"").slice(0,5);if(d!==vv.value)vv.value=d;if(d!=="")put(parseInt(d,10))};vv.onblur=()=>{if(vv.value==="")put(0)};
      vv.onfocus=()=>vv.select();vv.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();vv.blur()}};
      const bx=row.querySelector(".nctb");
      row.querySelector("[data-rs]").onclick=()=>noteConfirm(bx,bx,`Reset ${lab()} to 0?`,()=>{put(0);row.querySelector(".ndelc").remove();bx.style.display=""},"Reset");
      row.querySelector("[data-cbin]").onclick=()=>noteConfirm(bx,bx,`Remove ${lab()}? This can't be undone.`,()=>{setC(c=>c.splice(c.findIndex(z=>z.id===cid),1));ctrRender()},"Remove")});};
  ctrRender();
  document.getElementById("nCtAdd").onclick=()=>{const nid="c"+noteId();setC(c=>c.push({id:nid,name:"",v:0}));ctrRender();const r=cbox.querySelector(`[data-ct="${nid}"] .nctn`);if(r)r.focus()};
  const ex=document.getElementById("nExp1");ex.onclick=e=>{e.stopPropagation();
    noteMenu(ex,[["Backup file (.json)","This note, to import back into the map later",()=>notesExport("json",[cur()])],["Spreadsheet (.csv)","This note as a row, opens in Excel or Numbers",()=>notesExport("csv",[cur()])]])};
  document.getElementById("nCopy").onclick=async()=>{const ok=await copyText(noteAsText(cur()));noteFlash(document.getElementById("nMsg"),ok?"Copied.":"Couldn't copy here; try Export instead.")};
  document.getElementById("nDel").onclick=()=>{nCloseMenu();const bar=document.getElementById("nBar");noteConfirm(bar,bar,"Delete this note? This can't be undone.",()=>{notesSave(notesLoad().filter(x=>x.id!==id));showNotes("Note deleted.")})}}
// a note left completely empty is tidied away when you go back to the list
function notesTidy(){const a=notesLoad();const b=a.filter(n=>(n.text||"").trim()||(n.title||"").trim()||ctrUsed(n).length);if(b.length!==a.length)notesSave(b)}
function notesExport(kind,list){const one=!!list;const a=(list||notesLoad()).filter(Boolean).sort((x,y)=>x.created-y.created);const day=new Date().toLocaleDateString("en-CA",{timeZone:"Australia/Brisbane"});
  const stem=one&&a[0]?fileSafe(noteTitle(a[0])):`seq-map-notes-${day}`;
  if(kind==="json")return saveFile(stem+".json","application/json",JSON.stringify({app:"SEQ transport map notes",version:1,exported:new Date().toISOString(),notes:a},null,1));
  const q=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;const iso=t=>new Date(t).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"});
  saveFile(stem+".csv","text/csv;charset=utf-8","﻿"+["Title,Text,Counters,Created,Last edited",...a.map(n=>[noteTitle(n),n.text||"",ctrUsed(n).map(ctrLine).join("\n"),iso(n.created),iso(n.updated)].map(q).join(","))].join("\r\n"))}
async function notesImport(file){let txt="";try{txt=await file.text()}catch(e){return showNotes("Couldn't read that file.")}
  const a=notesLoad();let added=0,same=0,newer=0;
  if(/\.json$/i.test(file.name)||/^\s*[\[{]/.test(txt)){let d;try{d=JSON.parse(txt)}catch(e){return showNotes("That file isn't a notes backup.")}
    const list=Array.isArray(d)?d:d&&Array.isArray(d.notes)?d.notes:null;if(!list)return showNotes("That file isn't a notes backup.");
    for(const m of list){if(!m||typeof m!=="object")continue;const n={id:String(m.id||noteId()),title:String(m.title||""),text:String(m.text||""),created:+m.created||Date.now(),updated:+m.updated||Date.now()};
      if(Array.isArray(m.c))n.c=m.c.filter(q=>q&&typeof q==="object").map(q=>({id:String(q.id||"c"+noteId()),name:String(q.name||"").slice(0,CT_MAX),v:Math.max(0,Math.min(CT_TOP,parseInt(q.v,10)||0))}));
      const ex=a.find(x=>x.id===n.id);if(!ex){a.push(n);added++}else if(n.updated>ex.updated){Object.assign(ex,n);newer++}else same++}}
  else{const stem=file.name.replace(/\.[^.]+$/,"").trim();const n={id:noteId(),title:"",text:txt.replace(/\r\n/g,"\n"),created:Date.now(),updated:Date.now()};
    if(stem&&stem!==fileSafe(noteAuto(n))&&!/^seq-map-note/i.test(stem)){n.title=stem.slice(0,NT_MAX).trim();const lines=n.text.split("\n");if(lines[0].trim()===stem){n.text=lines.slice(1).join("\n").replace(/^\n+/,"")}}
    a.push(n);added++}
  if(!notesSave(a))return showNotes("Couldn't save: this browser's storage is full or blocked.");
  showNotes(`Added ${added} note${added===1?"":"s"}`+(newer?`, updated ${newer} with newer copies`:"")+(same?`, ${same} already here`:"")+".")}
document.getElementById("notesBtn").onclick=()=>showNotes();
// ---------- measured travel times (data/measured: recorded in the weekday peaks by .github/workflows/measure.yml,
// rolling last four weeks; AM 6:30-9:30, PM 3:30-6:30, weekdays, no public holidays)
let MI=null,MIp=null;const MC={};let mBand=null;
const mPeakNow=()=>bneNow().min<720?"am":"pm";
const mSafe=k=>k.replace(/[^A-Za-z0-9_-]/g,"_");
function mIndex(){if(MI)return Promise.resolve(MI);if(!MIp)MIp=fetch(BASE+"data/measured/index.json?t="+Math.floor(Date.now()/9e5)).then(r=>r.ok?r.json():null).catch(()=>null).then(x=>MI=x&&x.v?x:{meta:{},v:[]});return MIp}
async function mRoute(key){if(key in MC)return MC[key];const ix=await mIndex();if(!ix.v.some(v=>v[0]===key))return MC[key]=null;
  try{MC[key]=await (await fetch(BASE+"data/measured/"+mSafe(key)+".json?v="+encodeURIComponent(ix.meta.built||""))).json()}catch(e){MC[key]=null}return MC[key]}
const mMin=s=>Math.round(s/60);
const mSigned=s=>{const m=Math.round(s/60);return m===0?(Math.abs(s)<30?"on time":(s>0?"+":"−")+"<1 min"):(m>0?"+":"−")+Math.abs(m)+" min"};
const mDate=d=>d?new Date(d+"T00:00:00+10:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",timeZone:"Australia/Brisbane"}):"";
const mBandName=b=>b==="all"?"AM and PM windows together":b==="am"?"AM window (6:30–9:30 am)":"PM window (3:30–6:30 pm)";
// "All": the AM and PM figures for a route direction combined, each stretch weighted by its number of trips
function mBoth(dd){if(!dd)return null;const A=dd.am,P=dd.pm;if(!A||!P)return A||P||null;const seg={};
  for(const k of new Set([...Object.keys(A.seg),...Object.keys(P.seg)])){const a=A.seg[k],p=P.seg[k];if(!a||!p){seg[k]=a||p;continue}const n=a[2]+p[2];seg[k]=a.map((v,j)=>j===2?n:Math.round((v*a[2]+p[j]*p[2])/n))}
  return {...A,seg,trips:(A.trips||0)+(P.trips||0)}}
function mSince(ix){const m=ix&&ix.meta||{};return !m.from?"nothing recorded yet":m.from===m.to?`weekday ${mDate(m.from)}`:`weekdays ${mDate(m.from)} to ${mDate(m.to)}`}
// route cards: the fourth column, measured minutes from the first stop
async function applyMeasured(ol,key,best,dkey){const head=document.getElementById("tvHead");if(!head||!ol.isConnected)return;
  const band=mBand||mPeakNow();head.querySelectorAll("[data-mb]").forEach(b=>b.classList.toggle("on",b.dataset.mb===band));
  const lis=[...ol.querySelectorAll("li")];const data=await mRoute(key);if(!ol.isConnected)return;const ix=MI||{meta:{}};
  const x=data&&data[dkey]&&(band==="all"?mBoth(data[dkey]):data[dkey][band]);const a0=best.t[3+best.idx[0]];let cum=0,approx=false,have=0;
  lis.forEach((li,n)=>{let el=li.querySelector(".tm");if(!el){el=document.createElement("span");el.className="tm";li.insertBefore(el,li.firstChild)}
    el.className="tm";el.title="";if(!x){el.textContent="—";return}
    if(n===0){el.textContent="Start";return}
    const A=lis[n-1].dataset.s,B=li.dataset.s,sg=x.seg[A+">"+B];const ja=best.idx[n-1],jb=best.idx[n];const ta=ja>=0?best.t[3+ja]:-1,tb=jb>=0?best.t[3+jb]:-1;
    if(sg){cum+=sg[0];have++}else if(ta>=0&&tb>=0){cum+=(tb-ta)*60;approx=true}else{el.textContent="—";return}
    const tt=tb>=0?(tb-a0)*60:null;const diff=tt!=null?cum-tt:0;
    el.textContent=(approx?"≈":"")+mMin(cum)+" min";if(diff>=120)el.classList.add("slow");else if(diff<=-90)el.classList.add("fast");
    el.title=`Measured in the ${mBandName(band)}: ${mMin(cum)} min from the first stop`+(tt!=null?` (timetabled ${mMin(tt)} min)`:"")+(sg?`, ${sg[2]} trip${sg[2]>1?"s":""} on this stretch`:"")+(approx?". ≈: a stretch before this stop has no recordings yet, so its timetabled time is used":"")});
  const note=document.getElementById("tvNote");if(note){let m=note.querySelector(".mnote");if(!m){m=document.createElement("span");m.className="mnote";note.appendChild(m)}
    m.textContent=x?` Real-time data: the median time from the first stop in the ${mBandName(band)}, ${mSince(ix)} (${x.trips} trips). Orange is 2 min or more slower than timetabled.`+(have<lis.length-1?" ≈ marks stops after a stretch with no recordings yet.":"")
      :` Real-time data: ${ix.meta&&ix.meta.from?"not enough recordings yet for this route in "+(band==="all"?"the AM or PM windows":"the "+(band==="am"?"AM":"PM")+" window")+".":"recordings start with the next weekday peak."}`}}
function mHeadHTML(){return `<div class="tvh" id="tvHead" style="display:none"><span class="mbs">Real-time data <button data-mb="all">All</button><button data-mb="am">AM</button><button data-mb="pm">PM</button></span><span class="tm">Real-time data</span><span class="tf">Here</span><span class="tv">From start</span><span class="tc">Timetable</span></div>`}
function mWireHead(){const h=document.getElementById("tvHead");if(!h)return;h.querySelectorAll("[data-mb]").forEach(b=>b.onclick=e=>{e.stopPropagation();mBand=b.dataset.mb;applyTravel()})}

// ---------- period and kind-of-day filters, shared by Real time average and the delay heat map
// data/measured: day/<date>, month/<YYYY-MM>-<k>, live/<k> (past 7 days), w4/<k> (past 4 weeks), all/<k> (finished months),
// k = t school-term weekday, s school-holiday weekday, w weekend, p public holiday. Mixes are weighted by trips.
let MM=null,MMp=null;const MPC={};
const MF={per:"all",m1:null,m2:null,d1:null,d2:null,k:{t:1,s:1,w:0,p:0}};
const MK=[["t","School-term weekdays"],["s","School-holiday weekdays"],["w","Weekends"],["p","Public holidays"]];
const MDAYCAP=92;
function mMeta(){if(MM)return Promise.resolve(MM);if(!MMp)MMp=fetch(BASE+"data/measured/meta.json?t="+Math.floor(Date.now()/9e5)).then(r=>r.ok?r.json():null).catch(()=>null).then(x=>MM=x&&x.days?x:{days:{},months:{},all:{months:[]},hs:{}});return MMp}
// most files are gzipped (.json.gz) to keep the site small; the browser unzips them
async function mGz(r){const b=new Uint8Array(await r.arrayBuffer());if(b[0]===0x1f&&b[1]===0x8b){const st=new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));return JSON.parse(await new Response(st).text())}return JSON.parse(new TextDecoder().decode(b))}
function mGet(path){if(!(path in MPC))MPC[path]=fetch(BASE+"data/measured/"+path+".json.gz?v="+encodeURIComponent((MM&&MM.built)||"")).then(r=>r.ok?mGz(r):null).catch(()=>null);return MPC[path]}
function mCombine(ps){const acc={};
  for(const P of ps)for(const [k,dd] of Object.entries(P||{}))for(const [d,bb] of Object.entries(dd))for(const [b,x] of Object.entries(bb)){
    const a=((acc[k]=acc[k]||{})[d]=acc[k][d]||{})[b]=acc[k][d][b]||{seg:{},stop:{},e2e:{},trips:0,days:0};a.trips+=x.trips;a.days+=x.days;
    for(const [ab,q] of Object.entries(x.seg)){const t=a.seg[ab]=a.seg[ab]||[0,0,0,0,0];t[0]+=q[0]*q[2];t[1]+=q[1]*q[2];t[3]+=q[3]*q[2];t[4]+=q[4]*q[2];t[2]+=q[2]}
    for(const [c,q] of Object.entries(x.stop)){const t=a.stop[c]=a.stop[c]||[0,0];t[0]+=q[0]*q[1];t[1]+=q[1]}
    for(const e of x.e2e){const t=a.e2e[e[0]+">"+e[1]]=a.e2e[e[0]+">"+e[1]]||[0,0,0];t[0]+=e[2]*e[4];t[1]+=e[3]*e[4];t[2]+=e[4]}}
  for(const dd of Object.values(acc))for(const bb of Object.values(dd))for(const a of Object.values(bb)){
    for(const [ab,t] of Object.entries(a.seg))a.seg[ab]=[Math.round(t[0]/t[2]),Math.round(t[1]/t[2]),t[2],Math.round(t[3]/t[2]),Math.round(t[4]/t[2])];
    for(const [c,t] of Object.entries(a.stop))a.stop[c]=[Math.round(t[0]/t[1]),t[1]];
    const L=Object.entries(a.e2e).map(([k,t])=>{const [A,B]=k.split(">");return [A,B,Math.round(t[0]/t[2]),Math.round(t[1]/t[2]),t[2]]});const lg=Math.max(0,...L.map(e=>e[3]));
    a.e2e=L.sort((x,y)=>((x[3]<.8*lg)-(y[3]<.8*lg))||y[4]-x[4]).slice(0,4)}
  return acc}
const mMonName=m=>new Date(m+"-01T00:00:00+10:00").toLocaleDateString("en-AU",{month:"long",year:"numeric",timeZone:"Australia/Brisbane"});
const mDateY=d=>d?new Date(d+"T00:00:00+10:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric",timeZone:"Australia/Brisbane"}):"";
const mAddDays=(d,n)=>{const t=new Date(d+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
const mKindsOn=()=>MK.map(x=>x[0]).filter(k=>MF.k[k]);
function mKindsLabel(){const k=MF.k;if(k.t&&k.s&&k.w&&k.p)return "Every day";const parts=[];
  if(k.t&&k.s)parts.push("weekdays");else{if(k.t)parts.push("school-term weekdays");if(k.s)parts.push("school-holiday weekdays")}
  if(k.w)parts.push("weekends");if(k.p)parts.push("public holidays");
  const t=parts.length>1?parts.slice(0,-1).join(", ")+" and "+parts[parts.length-1]:parts[0]||"";return t.charAt(0).toUpperCase()+t.slice(1)}
function mPerLabel(){const M=MM||{};
  if(MF.per==="live")return `Live: past 7 days`+(M.live&&M.live.from?` (${mDate(M.live.from)}–${mDate(M.live.to)})`:"");
  if(MF.per==="w4")return `Last 4 weeks`+(M.w4&&M.w4.from?` (${mDate(M.w4.from)}–${mDate(M.w4.to)})`:"");
  if(MF.per==="month")return mMonName(MF.m1)+(M.months&&M.months[MF.m1]&&!M.months[MF.m1].final?" (so far)":"");
  if(MF.per==="range")return MF.m1===MF.m2?mMonName(MF.m1):`${mMonName(MF.m1)} – ${mMonName(MF.m2)}`;
  if(MF.per==="days")return MF.d1===MF.d2?mDateY(MF.d1):`${mDateY(MF.d1)} – ${mDateY(MF.d2)}`;
  return "All time"+(M.first?`, since ${mDateY(M.first)}`:"")}
function mPaths(){const M=MM,ks=mKindsOn(),out=[];const months=Object.keys(M.months).sort();const addM=m=>ks.forEach(k=>{if(M.months[m]&&M.months[m].kinds[k])out.push(`month/${m}-${k}`)});
  if(MF.per==="live"||MF.per==="w4")ks.forEach(k=>{if(M[MF.per]&&M[MF.per].kinds&&M[MF.per].kinds[k])out.push(MF.per+"/"+k)});
  else if(MF.per==="all"){if(M.all.months.length)ks.forEach(k=>out.push("all/"+k));months.filter(m=>!M.all.months.includes(m)).forEach(addM)}
  else if(MF.per==="month")addM(MF.m1);
  else if(MF.per==="range")months.filter(m=>m>=MF.m1&&m<=MF.m2).forEach(addM);
  else if(MF.per==="days")Object.entries(M.days).forEach(([d,k])=>{if(d>=MF.d1&&d<=MF.d2&&MF.k[k])out.push("day/"+d)});
  return out}
async function mData(){await mMeta();const paths=mPaths(),key=paths.join("|")+"#"+(MM.built||"")+"#"+mPerLabel()+"#"+mKindsLabel();if(mData.c&&mData.c.key===key)return mData.c.r;
  const ps=(await Promise.all(paths.map(mGet))).filter(Boolean);const P=ps.length===1?ps[0]:mCombine(ps);const v=[];
  for(const [k,dd] of Object.entries(P))for(const [d,bb] of Object.entries(dd))for(const [band,x] of Object.entries(bb)){const segs=Object.values(x.seg);const n=segs.reduce((a,q)=>a+q[2],0)||1;const e=x.e2e[0];
    v.push([k,d,band,((MM.hs||{})[k]||{})[d]||"",x.trips,segs.reduce((a,q)=>a+(q[0]-q[1])*q[2],0)/n,e?e[2]:null,e?e[3]:null])}
  const r={P,v,label:mPerLabel(),kinds:mKindsLabel(),meta:MM,empty:!Object.keys(MM.days).length};mData.c={key,r};return r}
function mFiltHTML(){const M=MM,months=Object.keys(M.months).sort().reverse(),cur=MF.per==="month"?"m:"+MF.m1:MF.per;
  const o=(v,t)=>`<option value="${v}"${cur===v?" selected":""}>${esc(t)}</option>`;
  let h=`<div class="mfil"><select id="mPer" class="mfsel" aria-label="Period">${o("live","Live (past 7 days)")}${o("w4","Last 4 weeks")}${o("all","All time")}`+
    (months.length?`<optgroup label="Month">${months.map(m=>o("m:"+m,mMonName(m)+(M.months[m].final?"":" (so far)"))).join("")}</optgroup>`:"")+
    (months.length?o("range","Range of months…"):"")+(Object.keys(M.days).length?o("days","Specific days…"):"")+`</select>`;
  if(MF.per==="range"){const mo=sel=>months.slice().reverse().map(m=>`<option value="${m}"${sel===m?" selected":""}>${esc(mMonName(m))}</option>`).join("");h+=`<span class="mfx"><select id="mM1" class="mfsel">${mo(MF.m1)}</select> to <select id="mM2" class="mfsel">${mo(MF.m2)}</select></span>`}
  if(MF.per==="days"){const ds=Object.keys(M.days).sort(),a=ds[0]||"",b=ds[ds.length-1]||"";h+=`<span class="mfx"><input type="date" id="mD1" class="mfsel" min="${a}" max="${b}" value="${MF.d1||""}"> to <input type="date" id="mD2" class="mfsel" min="${a}" max="${b}" value="${MF.d2||""}"></span>`}
  h+=`<details class="mdd" id="mKinds"${mFiltHTML.open?" open":""}><summary>${esc(mKindsLabel())} ▾</summary><div class="mddb"><label class="mkall"><input type="checkbox" data-mkall${MK.every(([k])=>MF.k[k])?" checked":""}> <b>Every day</b></label>${MK.map(([k,t])=>`<label><input type="checkbox" data-mk="${k}"${MF.k[k]?" checked":""}> ${t}</label>`).join("")}<div class="odnm">Every day ticks all four; untick it to go back to weekdays. Weekdays (both kinds) are the usual choice; weekends and public holidays have quieter traffic and fewer services.</div></div></details></div>`;
  if(MF.per==="days")h+=`<div class="odnm mfcap">Up to ${MDAYCAP} days; pick months for longer periods.</div>`;
  return h}
function mWireFilt(onChange){const go=()=>{mFiltHTML.open=!!(document.getElementById("mKinds")||{}).open;onChange()};const months=Object.keys(MM.months).sort(),ds=Object.keys(MM.days).sort();
  const per=document.getElementById("mPer");if(!per)return;
  per.onchange=()=>{const v=per.value;mFiltHTML.open=false;if(v.startsWith("m:")){MF.per="month";MF.m1=v.slice(2)}else{MF.per=v;
      if(v==="range"){MF.m1=months[0];MF.m2=months[months.length-1]}
      if(v==="days"){MF.d2=MF.d2&&ds.includes(MF.d2)?MF.d2:ds[ds.length-1];MF.d1=MF.d1&&MF.d1<=MF.d2?MF.d1:(mAddDays(MF.d2,-6)<ds[0]?ds[0]:mAddDays(MF.d2,-6))}}onChange()};
  const m1=document.getElementById("mM1"),m2=document.getElementById("mM2");
  if(m1)m1.onchange=m2.onchange=()=>{MF.m1=m1.value;MF.m2=m2.value;if(MF.m1>MF.m2)[MF.m1,MF.m2]=[MF.m2,MF.m1];go()};
  const d1=document.getElementById("mD1"),d2=document.getElementById("mD2");
  if(d1)d1.onchange=d2.onchange=e=>{let a=d1.value||MF.d1,b=d2.value||MF.d2;if(a>b)[a,b]=[b,a];
    if(mAddDays(a,MDAYCAP-1)<b){if(e.target===d1)b=mAddDays(a,MDAYCAP-1);else a=mAddDays(b,-(MDAYCAP-1))}MF.d1=a;MF.d2=b;go()};
  const all=document.querySelector("#mKinds [data-mkall]");if(all)all.onchange=()=>{MK.forEach(([k])=>MF.k[k]=all.checked?1:(k==="t"||k==="s"?1:0));mFiltHTML.open=true;onChange()};
  document.querySelectorAll("#mKinds [data-mk]").forEach(c=>c.onchange=()=>{MF.k[c.dataset.mk]=c.checked?1:0;if(!mKindsOn().length){MF.k[c.dataset.mk]=1;c.checked=true;return}mFiltHTML.open=true;onChange()})}

// ---------- "Real time average" tab
let RTAF="all",RTAQ="",rtaBack=null;
const mLabel=k=>TNAME[k]?k+" "+TNAME[k]:k;
const mLong=k=>{if(TNAME[k])return "Train line";const i=nameIdx[k];return i!=null?R[i].l:""};
async function showRTA(back){if(back!==undefined)rtaBack=back;focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  const ix=await mData();
  const fb=(k,t)=>`<button class="gcb${RTAF===k?" on":""}" data-rf="${k}">${t}</button>`;
  openPanel("Real time average",`Measured travel times · ${esc(ix.label)} · ${esc(ix.kinds)}`,
    `${mFiltHTML()}<div class="rtabar"><input id="rtaQ" class="ttf schq" placeholder="Search a route, line or destination" autocomplete="off" value="${esc(RTAQ)}"><div class="gcbs">${fb("all","All")}${fb("am","AM")}${fb("pm","PM")}<button class="gcb hmb" id="rtaHeat">Heat map</button></div></div><div class="gcn" id="rtaCount"></div><div id="rtaList"></div>
    <div class="odnote">How long services actually take, from Translink's live data, recorded every 30 seconds in the AM (6:30–9:30 am) and PM (3:30–6:30 pm) windows, Brisbane time, every day. Choose a period (live is the past 7 days) and which kinds of day to include; weekdays are the default. A single day, month, live or last 4 weeks is the median of its trips; all time, ranges and mixes of kinds of day combine those, weighted by trips. Months are kept for 12 months; all time keeps everything since recording began. Figures update after every window. Tap a route for its overview and stop-by-stop times. Unofficial; from Translink's real-time feeds.</div>`,{view:"rta",wide:true});
  mWireFilt(()=>showRTA());
  const q=document.getElementById("rtaQ");q.oninput=()=>{RTAQ=q.value;rtaList(ix)};
  pB.querySelectorAll("[data-rf]").forEach(b=>b.onclick=()=>{RTAF=b.dataset.rf;pB.querySelectorAll("[data-rf]").forEach(x=>x.classList.toggle("on",x===b));rtaList(ix)});
  document.getElementById("rtaHeat").onclick=()=>toggleHM(RTAF);if(rtaBack)setBack(rtaBack);rtaList(ix)}
function rtaList(ix){const box=document.getElementById("rtaList");if(!box)return;const q=RTAQ.trim().toLowerCase();
  const rows=ix.v.map((v,i)=>({v,i})).filter(({v})=>(RTAF==="all"||v[2]===RTAF)&&(!q||[v[0],mLabel(v[0]),v[3],mLong(v[0])].join(" ").toLowerCase().includes(q)))
    .sort((a,b)=>cmpRoute(a.v[0],b.v[0])||a.v[2].localeCompare(b.v[2])||a.v[1].localeCompare(b.v[1]));
  document.getElementById("rtaCount").textContent=ix.v.length?`${rows.length} route version${rows.length===1?"":"s"} (route, AM or PM, and direction)`:"";
  if(!ix.v.length){box.innerHTML=`<div class="sub">${ix.empty?"Nothing has been recorded yet. Recording runs every morning and afternoon, so the first figures appear after the next window.":"Nothing recorded for this period and these days. Try another period, or include more kinds of day."}</div>`;return}
  box.innerHTML=rows.slice(0,400).map(({v,i})=>{const d=v[6]!=null&&v[7]!=null?v[6]-v[7]:null;const ri=nameIdx[v[0]];const col=TCOL[v[0]]||(ri!=null?R[ri].c:"#888"),tc=TCOL[v[0]]?(/T2|T5/.test(v[0])?"#111":"#fff"):(ri!=null?R[ri].tc:"#fff");
    return `<a href="#" class="rtar" data-rta="${i}"><span class="rb" style="background:${col};color:${tc}">${esc(v[0])}</span><span class="rtan"><b>${esc(v[0])} · ${v[2].toUpperCase()} · to ${esc(v[3]||"—")}</b><span>${esc(mLong(v[0]))}</span></span><span class="rbp ${v[2]}" title="${v[2]==="am"?"AM window, 6:30–9:30 am":"PM window, 3:30–6:30 pm"}">${v[2].toUpperCase()}</span><span class="rtad${d!=null&&d>=120?" slow":d!=null&&d<=-90?" fast":""}">${d!=null?mSigned(d):""}<small>${v[4]} trip${v[4]===1?"":"s"}</small></span></a>`}).join("")+(rows.length>400?`<div class="sub">Showing 400 of ${rows.length}; search to narrow the list.</div>`:"")+(rows.length?"":`<div class="sub">Nothing matches.</div>`);
  box.querySelectorAll("[data-rta]").forEach(a=>a.onclick=e=>{e.preventDefault();rtaDetail(+a.dataset.rta)})}
// the commonest path through a route's recorded stretches
function mChain(x,o,start){const from=new Map();for(const [k,s] of Object.entries(x.seg)){const [A,B]=k.split(">");if(!from.has(A))from.set(A,[]);from.get(A).push([B,s])}
  const pos=new Map();o.forEach((id,j)=>{if(!pos.has(id))pos.set(id,j)});
  if(!start){const inc=new Set([...from.values()].flat().map(x=>x[0]));start=[...from.keys()].filter(a=>!inc.has(a)).sort((a,b)=>(pos.get(a)??1e9)-(pos.get(b)??1e9))[0]||[...from.keys()][0]}
  const out=[{id:start}],seen=new Set([start]);let cur=start;
  while(from.has(cur)){const nx=from.get(cur).filter(([B])=>!seen.has(B)).sort((a,b)=>b[1][2]-a[1][2]||(pos.get(a[0])??1e9)-(pos.get(b[0])??1e9))[0];if(!nx)break;
    out.push({id:nx[0],seg:nx[1]});seen.add(nx[0]);cur=nx[0];if(out.length>400)break}
  return out}
// the headsign of the route direction that passes these stops in this order
function mDirFor(ris,ids){let best=null;ris.forEach(i=>R[i].d.forEach((d,k)=>{const pos=ids.map(x=>d.s.indexOf(x)).filter(j=>j>=0);let sc=0;for(let n=1;n<pos.length;n++)sc+=pos[n]>pos[n-1]?1:-1;sc+=pos.length/1000;if(!best||sc>best.sc)best={sc,i,k}}));return best}
async function rtaDetail(i){const ix=await mData();const v=ix.v[i];if(!v)return showRTA();const [key,d,band,hs]=v;
  const data=ix.P[key];const x=data&&data[d]&&data[d][band];if(!x)return showRTA();
  let o=[];try{if(!RTC[key])RTC[key]=await (await fetch(BASE+"data/rt/"+mSafe(key)+".json"+DV)).json();o=(RTC[key][d]||{}).o||[]}catch(e){}
  const e0=x.e2e[0];const chain=mChain(x,o,e0&&e0[0]);let ct=0,cm=0;const rows=chain.map((c,n)=>{if(c.seg){ct+=c.seg[1];cm+=c.seg[0]}return {...c,ct,cm,late:x.stop[c.id]}});
  const nm=id=>ST[id]?ST[id][0]:id;
  const runT=e0?e0[3]:ct,runM=e0?e0[2]:cm,runN=e0?e0[4]:null;const lates=Object.values(x.stop);const lw=lates.reduce((s,l)=>s+l[1],0)||1;
  const lateAvg=lates.reduce((s,l)=>s+l[0]*l[1],0)/lw;
  const segs=Object.entries(x.seg).map(([k,s])=>{const [A,B]=k.split(">");return {A,B,s,x:s[0]-s[1]}}).filter(z=>z.s[2]>=1);
  const worst=segs.filter(z=>z.x>=30).sort((a,b)=>b.x-a.x).slice(0,6),best=segs.filter(z=>z.x<=-30).sort((a,b)=>a.x-b.x).slice(0,3);
  const tile=(t,val,sub,cls)=>`<div class="mtile${cls?" "+cls:""}"><span>${t}</span><b>${val}</b>${sub?`<small>${sub}</small>`:""}</div>`;
  const dRun=runM-runT;
  let h=mFiltHTML()+`<div class="mtiles">${tile("Timetabled",mMin(runT)+" min",e0?"commonest whole run":"recorded stretches")}${tile("Measured",mMin(runM)+" min","median"+(runN?", "+runN+" runs":""),dRun>=120?"slow":dRun<=-90?"fast":"")}${tile("Difference",mSigned(dRun),Math.round(100*runM/Math.max(runT,1))+"% of timetabled",dRun>=120?"slow":dRun<=-90?"fast":"")}${tile("Running late",mSigned(lateAvg).replace(/^\+/,""),"typical, at each stop")}</div>`;
  h+=`<p class="pjp">${esc(key)} ${band.toUpperCase()} to ${esc(hs||"—")}${e0?`: the commonest whole run is <b>${esc(nm(e0[0]))}</b> to <b>${esc(nm(e0[1]))}</b>, timetabled ${mMin(e0[3])} min and measured at ${mMin(e0[2])} min (median of ${e0[4]} runs).`:"."} Recorded in the ${mBandName(band)} on ${x.days} day${x.days===1?"":"s"} (${esc(ix.label)}, ${esc(ix.kinds.toLowerCase())}): ${x.trips} trips over ${Object.keys(x.seg).length} stretches between stops.</p>`;
  // lateness along the route
  const L=rows.map(r=>r.late?r.late[0]:null);const mx=Math.max(120,...L.filter(z=>z!=null).map(Math.abs));
  if(rows.length>2){const W=640,H=70,bw=W/rows.length;h+=`<div class="grp">How late services run along the route</div><svg class="mspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Median lateness at each stop"><line x1="0" x2="${W}" y1="${H/2}" y2="${H/2}" class="axis"/>`+rows.map((r,n)=>{const l=L[n];if(l==null)return "";const hh=Math.max(1,Math.abs(l)/mx*(H/2-2));return `<rect x="${n*bw+bw*.15}" width="${Math.max(1,bw*.7)}" y="${l>=0?H/2-hh:H/2}" height="${hh}" class="${l>=120?"slow":l<=-60?"fast":"ok"}"><title>${esc(nm(r.id))}: ${mSigned(l)}</title></rect>`}).join("")+`</svg><div class="msparkl"><span>${esc(nm(rows[0].id))}</span><span>bars above the line: behind timetable · below: ahead</span><span>${esc(nm(rows[rows.length-1].id))}</span></div>`}
  const segLine=z=>`<li><a href="#" data-ms="${esc(z.A)}">${esc(nm(z.A))}</a> → <a href="#" data-ms="${esc(z.B)}">${esc(nm(z.B))}</a>: <b>${mSigned(z.x)}</b> <span class="odnm">(${mMin(z.s[1])} min timetabled, ${(z.s[0]/60).toFixed(1)} min measured, ${z.s[2]} trips)</span></li>`;
  if(worst.length)h+=`<div class="grp">Slowest stretches against the timetable</div><ul class="pjn">${worst.map(segLine).join("")}</ul>`;
  if(best.length)h+=`<div class="grp">Quicker than timetabled</div><ul class="pjn">${best.map(segLine).join("")}</ul>`;
  h+=`<div class="grp">Stop by stop${rows.length<Object.keys(x.stop).length?" (the commonest path)":""}</div><div class="mtw"><table class="mtab"><thead><tr><th>Stop</th><th>Timetabled</th><th>Measured</th><th>Difference</th><th>Late by</th><th>This stretch</th><th>Range</th><th>Trips</th></tr></thead><tbody>`+
    rows.map((r,n)=>{const s=r.seg,df=r.cm-r.ct;return `<tr><td><a href="#" data-ms="${esc(r.id)}">${esc(nm(r.id))}</a></td><td>${n?mMin(r.ct)+" min":"Start"}</td><td>${n?mMin(r.cm)+" min":"Start"}</td><td class="${df>=120?"slow":df<=-90?"fast":""}">${n?mSigned(df):""}</td><td>${r.late?mSigned(r.late[0]).replace(/^\+/,""):"—"}</td><td>${s?`${(s[1]/60).toFixed(1)} → ${(s[0]/60).toFixed(1)} min`:""}</td><td>${s?`${(s[3]/60).toFixed(1)}–${(s[4]/60).toFixed(1)} min`:""}</td><td>${s?s[2]:r.late?r.late[1]:""}</td></tr>`}).join("")+`</tbody></table></div>`;
  h+=`<div class="odnote">Timetabled and measured columns count minutes from the first stop. <b>Late by</b> is how far behind the timetable services typically are at that stop (a minus means early). <b>This stretch</b> is timetabled → measured minutes from the previous stop, and <b>Range</b> is the quickest to slowest 10% of trips. Trips recorded in the ${mBandName(band)}, ${esc(ix.label)}, ${esc(ix.kinds.toLowerCase())}.</div>`;
  h+=`<div class="webrow"><button class="btn" id="rtaShow">Open route card</button><button class="btn" id="rtaHeat2">Heat map</button></div><div class="odnote"><a href="#" id="rtaAll">‹ All routes</a></div>`;
  openPanel(`${key} · ${band.toUpperCase()} · to ${hs||"—"}`,`${esc(mLong(key))} · ${esc(mBandName(band))} · ${esc(ix.label)} · ${esc(ix.kinds)}`,h,{view:"rtav",wide:true});setBack({kind:"rta"});
  mWireFilt(async()=>{const nx=await mData();const j=nx.v.findIndex(w=>w[0]===key&&w[1]===d&&w[2]===band);if(j>=0)rtaDetail(j);else{openPanel(`${key} · ${band.toUpperCase()} · to ${hs||"—"}`,esc(nx.label+" · "+nx.kinds),mFiltHTML()+`<div class="sub">Nothing recorded for this route in this period and these days.</div><div class="odnote"><a href="#" id="rtaAll">‹ All routes</a></div>`,{view:"rtav",wide:true});setBack({kind:"rta"});document.getElementById("rtaAll").onclick=e=>{e.preventDefault();showRTA()};mWireFilt(()=>rtaDetail(i))}});
  document.getElementById("rtaAll").onclick=e=>{e.preventDefault();showRTA()};
  document.getElementById("rtaHeat2").onclick=()=>toggleHM(band);
  document.getElementById("rtaShow").onclick=()=>{mBand=band;const ids=rows.map(r=>r.id);if(TNAME[key]){const f=mDirFor(lineRoutes[key]||[],ids);showLine(key,false,null,null,f&&f.sc>0?f:null)}else if(nameIdx[key]!=null){const f=mDirFor([nameIdx[key]],ids);showRoute(nameIdx[key],false,null,f?R[f.i].d[f.k].h:hs)}setBack({kind:"rtav",i})};
  pB.querySelectorAll("[data-ms]").forEach(a=>a.onclick=e=>{e.preventDefault();const s=ST[a.dataset.ms];if(s){map.flyTo({center:[s[2],s[1]],zoom:Math.max(map.getZoom(),15),duration:700});selPt([s[2],s[1]])}});
  // the route on the map
  const cs=rows.filter(r=>ST[r.id]).map(r=>[ST[r.id][2],ST[r.id][1]]);if(cs.length>1){map.getSource("hl").setData(FC([{type:"Feature",properties:{c:TCOL[key]||(nameIdx[key]!=null?R[nameIdx[key]].c:"#888"),mode:"route"},geometry:{type:"LineString",coordinates:cs}}]));pjFit(cs,14)}}
document.getElementById("rtaBtn").onclick=()=>showRTA(null);

// ---------- delay heat map: each stretch between two stops, darker red the further it runs behind its timetabled time
let HM=null,HMG=null,hmOn=false,hmSnap=null,HMF="all";
// stretches for the chosen period and days, all routes combined: [A, B, path, am extra s, am timetabled s, am trips, pm ..., routes]
function hmBuild(ix){const pr=new Map();
  for(const [key,dd] of Object.entries(ix.P))for(const bb of Object.values(dd))for(const [band,x] of Object.entries(bb))for(const [ab,q] of Object.entries(x.seg)){
    let r=pr.get(ab);if(!r){r={am:[0,0,0],pm:[0,0,0],r:new Set()};pr.set(ab,r)}const t=r[band];t[0]+=(q[0]-q[1])*q[2];t[1]+=q[1]*q[2];t[2]+=q[2];r.r.add(key)}
  const f=t=>t[2]?[Math.round(t[0]/t[2]),Math.round(t[1]/t[2]),t[2]]:[null,null,0];const s=[];
  for(const [ab,r] of pr){const g=HMG&&HMG[ab];if(!g)continue;const [A,B]=ab.split(">");s.push([A,B,g,...f(r.am),...f(r.pm),[...r.r].sort(cmpRoute).slice(0,12)])}
  HM={s,label:ix.label,kinds:ix.kinds,empty:ix.empty}}
function hmFeatures(){return FC(HM.s.map((r,i)=>{const an=r[5]||0,pn=r[8]||0,n=an+pn;const x=n?((r[3]||0)*an+(r[6]||0)*pn)/n:null;
    return {type:"Feature",properties:{i,a:r[3],an,p:r[6],pn,x,n},geometry:{type:"LineString",coordinates:dec(r[2])}}}))}
const HM_K={all:"x",am:"a",pm:"p"};
function hmSetup(){if(map.getSource("hm")){map.getSource("hm").setData(hmFeatures());return}
  map.addSource("hm",{type:"geojson",data:hmFeatures()});
  const below=map.getLayer("sel")?"sel":undefined;
  map.addLayer({id:"hm-line",type:"line",source:"hm",layout:{"line-cap":"round","line-join":"round"},paint:{"line-width":["interpolate",["linear"],["zoom"],9,1.6,13,4,16,7],"line-offset":["interpolate",["linear"],["zoom"],9,0.8,13,2.2,16,4]}},below);
  L.push("hm-line");hmPaint();
  map.on("mouseenter","hm-line",()=>{map.getCanvas().style.cursor="pointer"});map.on("mouseleave","hm-line",()=>{map.getCanvas().style.cursor=""})}
function hmPaint(){if(!map.getLayer("hm-line"))return;const k=HM_K[HMF];const d=theme!=="light";
  map.setFilter("hm-line",["!=",["get",k],null]);
  map.setPaintProperty("hm-line","line-color",["interpolate",["linear"],["coalesce",["get",k],0],0,d?"rgba(255,255,255,0.22)":"rgba(120,120,120,0.25)",20,"#fecaca",45,"#fca5a5",75,"#f87171",120,"#dc2626",200,"#991b1b",300,"#5f0f0f"]);
  map.setPaintProperty("hm-line","line-opacity",1)}
function hmVis(v){map.getLayer("hm-line")&&map.setLayoutProperty("hm-line","visibility",v?"visible":"none")}
function hmLayers(on){if(on){hmSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{hmSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(hmSnap){Object.entries(hmSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});hmSnap=null}
  renderAll();hint()}
const hmVal=r=>HMF==="am"?r[3]:HMF==="pm"?r[6]:((r[5]||0)+(r[8]||0)?((r[3]||0)*(r[5]||0)+(r[6]||0)*(r[8]||0))/((r[5]||0)+(r[8]||0)):null);
function hmOverview(){const fb=(k,t)=>`<button class="gcb${HMF===k?" on":""}" data-hf="${k}">${t}</button>`;const nm=id=>ST[id]?ST[id][0]:id;
  const top=HM.s.map((r,i)=>({r,i,v:hmVal(r),n:HMF==="am"?r[5]:HMF==="pm"?r[8]:(r[5]||0)+(r[8]||0)})).filter(z=>z.v!=null&&z.v>=20&&z.n>=3).sort((a,b)=>b.v-a.v).slice(0,12);
  const h=mFiltHTML().replace("</details></div>",`</details><button class="hmsearch hmtop" data-hmsearch title="Route, Line or Destination search">🔍 Search</button></div>`)+`<div class="gcf"><div class="gcfl">Window</div><div class="gcbs">${fb("all","All")}${fb("am","AM")}${fb("pm","PM")}</div></div>
    <div class="hmleg"><span class="hmbar"></span><div class="hmlab"><span style="left:0">On time</span><span style="left:20%">+1 min</span><span style="left:40%">+2 min</span><span style="right:0">+5 min or more</span></div></div>
    <div class="grp">Biggest gaps from the timetable</div>${top.length?`<ul class="pjn">`+top.map(z=>`<li><a href="#" data-hs="${z.i}">${esc(nm(z.r[0]))} → ${esc(nm(z.r[1]))}</a> <b>${mSigned(z.v)}</b> <span class="odnm">${z.n} trips · ${esc(z.r[9].slice(0,5).join(", "))}</span></li>`).join("")+`</ul>`:`<div class="sub">${HM.s.length?"No stretches stand out in this period.":HM.empty?"Nothing recorded yet. Recording runs every morning and afternoon, so the map fills in after the next window.":"Nothing recorded for this period and these days."}</div>`}
    <div class="odnote">Each line is the stretch between two stops, coloured by how much longer it takes than timetabled: clear where services keep to time, through to dark red for the biggest gaps. All routes on a stretch are combined, and each direction is drawn on its own side. AM 6:30–9:30 am and PM 3:30–6:30 pm, ${esc(HM.label)}, ${esc(HM.kinds.toLowerCase())}. Tap a stretch for details. The – button shrinks this card.</div><div class="hmbot"><button class="hmsearch" data-hmsearch>🔍 Route, Line or Destination search</button></div>`;
  openPanel("Delay heat map",`Where services run slower than timetabled · ${esc(HM.label)} · ${esc(HM.kinds)}`,h,{view:"hm"});backState=null;pBack.style.display="none";
  mWireFilt(async()=>{const ix=await mData();hmBuild(ix);hmSetup();hmPaint();hmOverview()});
  pB.querySelectorAll("[data-hf]").forEach(b=>b.onclick=()=>{HMF=b.dataset.hf;hmPaint();hmOverview()});
  pB.querySelectorAll("[data-hs]").forEach(a=>a.onclick=e=>{e.preventDefault();hmCard(+a.dataset.hs,true)});
  pB.querySelectorAll("[data-hmsearch]").forEach(b=>b.onclick=async()=>{const f=HMF;await toggleHM();showRTA({kind:"hmon",f})})}
function hmCard(i,fit){const r=HM.s[i];const nm=id=>ST[id]?ST[id][0]:id;
  const band=(b,x,s,n)=>n?`<div class="hmrow"><b>${b}</b> ${mSigned(x)} <span class="odnm">· ${(s/60).toFixed(1)} min timetabled, ${((s+x)/60).toFixed(1)} min measured · ${n} trip${n===1?"":"s"}</span></div>`:`<div class="hmrow"><b>${b}</b> <span class="odnm">not recorded</span></div>`;
  const h=`<div class="odnm">${esc(HM.label)} · ${esc(HM.kinds)}</div>`+band("AM (6:30–9:30)",r[3],r[4],r[5])+band("PM (3:30–6:30)",r[6],r[7],r[8])+`<div class="grp">Routes on this stretch</div><div class="badges">${r[9].map(k=>{const ri=nameIdx[k];return TNAME[k]?`<span class="rb" data-hk="${esc(k)}" style="background:${TCOL[k]};color:${/T2|T5/.test(k)?"#111":"#fff"}">${esc(k)}</span>`:ri!=null?`<span class="rb" data-hk="${esc(k)}" style="background:${R[ri].c};color:${R[ri].tc}">${esc(k)}</span>`:""}).join("")}</div><div class="pjhint">Tap a route for its real time average.</div><div class="odnote"><a href="#" id="hmAll">‹ Heat map overview</a></div>`;
  openPanel(`${nm(r[0])} → ${nm(r[1])}`,"Stretch between two stops",h,{view:"hmv"});setBack({kind:"hm"});
  document.getElementById("hmAll").onclick=e=>{e.preventDefault();hmOverview()};
  pB.querySelectorAll("[data-hk]").forEach(b=>b.onclick=async()=>{const ix=await mData();const k=b.dataset.hk;const want=HMF==="all"?null:HMF;
    const pick=want||mPeakNow();let j=ix.v.findIndex(v=>v[0]===k&&v[2]===pick);if(j<0)j=ix.v.findIndex(v=>v[0]===k);if(j<0)return;const f=HMF;await toggleHM();rtaBack={kind:"hmon",f};rtaDetail(j)});
  const c=dec(r[2]);selPt(c[Math.floor(c.length/2)]);if(fit)pjFit(c,16)}
async function toggleHM(f){const btn=document.getElementById("hmBtn");
  if(hmOn){hmOn=false;hmVis(false);hmLayers(false);btn.classList.remove("odon");if(view==="hm"||view==="hmv")closePanel();return}
  if(odOn)await toggleOD();if(pjOn)await togglePJ(pjOn);if(gcOn)await toggleGC();if(typeof rbOn!=="undefined"&&rbOn)await toggleRB();
  await mMeta();if(!HMG)HMG=(await mGet("heatgeo"))||{};hmBuild(await mData());
  if(f&&HM_K[f])HMF=f;
  hmSetup();hmOn=true;hmVis(true);hmPaint();hmLayers(true);btn.classList.add("odon");focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  hmOverview();if(!map.getBounds().contains([153.025,-27.47]))map.flyTo({center:[153.03,-27.48],zoom:11,duration:700})}
document.getElementById("hmBtn").onclick=()=>toggleHM();
map.on("click",e=>{if(!hmOn)return;const box=[[e.point.x-5,e.point.y-5],[e.point.x+5,e.point.y+5]];
  const f=map.queryRenderedFeatures(box,{layers:["hm-line"]});if(!f.length)return;f.sort((a,b)=>(b.properties[HM_K[HMF]]||0)-(a.properties[HM_K[HMF]]||0));hmCard(+f[0].properties.i,false)});
// ---------- Rail replacement buses (More ▾): planned train closures from Translink's timetable feed (data/railbus.json,
// rebuilt daily by .github/workflows/railbus.yml). The menu item turns orange while a closure is on and light blue when one
// is coming up; the card lists them, and each closure greys out the closed track, names its stations and draws the buses.
let RBI=null,RB=null,rbOn=false,rbSel=null,rbSnap=null;const RBC="#ea580c";
const rbYmd=d=>d.replace(/-/g,"");
const rbWin=(d,w)=>{const t0=Date.parse(d+"T00:00:00+10:00");return [t0+w[0]*6e4,t0+w[1]*6e4]};
// 'now' = buses running (from 15 min before the first bus to the last arrival); 'soon' = still to come
function rbStatus(c){const now=Date.now();let soon=null;for(const [d,w] of Object.entries(c.days)){const [a,b]=rbWin(d,w);if(now>=a-9e5&&now<=b)return {s:"now",a,b};if(a>now&&(!soon||a<soon.a))soon={s:"soon",a,b}}return soon||{s:"past"}}
const rbT=ms=>new Date(ms).toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit",timeZone:"Australia/Brisbane"}).replace(/\s?([ap])\.?m\.?/i,(m,x)=>" "+x.toLowerCase()+"m");
const rbD=(d,o)=>new Date(d+"T12:00:00+10:00").toLocaleDateString("en-AU",Object.assign({weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Brisbane"},o||{}));
const rbHM=m=>{m=((m%1440)+1440)%1440;const h=Math.floor(m/60),mm=m%60;return (h%12||12)+(mm?":"+String(mm).padStart(2,"0"):"")+(h<12?" am":" pm")};
// days in runs of consecutive dates with the same hours: "Mon 23 – Thu 26 Nov · 7:39 pm – 1:15 am"
function rbRuns(c){const ds=Object.keys(c.days).sort(),out=[];let cur=null;
  for(const d of ds){const w=c.days[d],k=w.join("-");if(cur&&cur.k===k&&Date.parse(d)-Date.parse(cur.to)===864e5)cur.to=d;else{cur={from:d,to:d,k,w};out.push(cur)}}
  return out.map(r=>({...r,txt:(r.from===r.to?rbD(r.from):rbD(r.from,{month:undefined})+" – "+rbD(r.to))+" · "+rbHM(r.w[0])+" – "+rbHM(r.w[1])+(r.w[1]>=1440?" (next day)":"")}))}
function rbWhen(c){const st=rbStatus(c);if(st.s==="now")return "On now, buses until "+rbT(st.b);if(st.s!=="soon")return "Finished";
  const n=bneNow(),d=new Date(st.a).toLocaleDateString("en-CA",{timeZone:"Australia/Brisbane"}).replace(/-/g,""),days=Math.round((Date.parse(d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6)+"T00:00:00+10:00")-Date.parse(n.ymd.slice(0,4)+"-"+n.ymd.slice(4,6)+"-"+n.ymd.slice(6)+"T00:00:00+10:00"))/864e5);
  const at=new Date(st.a).getUTCHours()+10>=18||new Date(st.a).getUTCHours()+10<4?"night":"day";
  return days===0?(at==="night"?"Tonight from ":"Today from ")+rbT(st.a):days===1?(at==="night"?"Tomorrow night from ":"Tomorrow from ")+rbT(st.a):"Starts "+new Date(st.a).toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Brisbane"})}
async function rbIndex(){if(RBI)return RBI;try{RBI=await (await fetch(BASE+"data/railbus-days.json"+DV)).json()}catch(e){RBI={closures:[]}}return RBI}
function rbColour(){const b=document.getElementById("rbBtn");if(!b||!RBI)return;const ss=RBI.closures.map(rbStatus);const now=ss.some(x=>x.s==="now"),soon=ss.some(x=>x.s==="soon");
  b.classList.toggle("rbnow",now);b.classList.toggle("rbsoon",!now&&soon);
  const sp=b.querySelector("span");if(sp)sp.textContent=now?"Planned track closure in effect":soon?"Planned track closure coming up":"No planned track closures listed"}
rbIndex().then(rbColour);setInterval(rbColour,6e4);
// station cards: a note when buses replace trains there in the next 7 days
function rbStationHTML(id){if(!RBI)return "";const ids=new Set([id,parentOf[id]].filter(Boolean));const now=Date.now(),wk=now+7*864e5;
  const L=RBI.closures.map(c=>{const k=Object.keys(c.st).find(x=>ids.has(x));if(k==null)return null;const st=rbStatus(c);if(st.s==="past"||(st.s==="soon"&&st.a>wk))return null;return {c,k:c.st[k],st}}).filter(Boolean);
  if(!L.length)return "";
  return L.map(({c,k,st})=>`<a href="#" class="rbnote ${st.s==="now"?"now":""}" data-rbopen="${esc(c.id)}">🚌 <b>${k===2?"Rail buses connect here":k===1?"Rail buses run from here":"Buses replace trains here"}</b> · ${esc(rbWhen(c))} · ${esc(c.title)} (${esc(c.routes.join(", "))}) ›</a>`).join("")}
// top of a rail replacement route's card and timetable: when it runs and what it replaces
function rbRouteBanner(n){const c=RBI&&RBI.closures.find(x=>x.routes.includes(n));if(!c)return `<div class="rbnote">🚌 <b>Rail replacement bus</b> · runs only on the dates in the day menu</div>`;
  const st=rbStatus(c),runs=rbRuns(c);
  return `<a href="#" class="rbnote rbban ${st.s==="now"?"now":""}" data-rbopen="${esc(c.id)}">🚌 <b>Replaces trains ${esc(c.title)}</b> · ${esc(rbWhen(c))}<span class="rbbd">${runs.slice(0,4).map(r=>esc(r.txt)).join("<br>")}${runs.length>4?`<br>+ ${runs.length-4} more`:""}</span><span class="rbbl">Show the closure on the map ›</span></a>`}
function rbWireNotes(){pB.querySelectorAll("[data-rbopen]").forEach(a=>a.onclick=async e=>{e.preventDefault();const id=a.dataset.rbopen;if(!rbOn)await toggleRB(true);rbCard(id,true)})}
// map layers
function rbSetup(){if(map.getSource("rb-t"))return;const tf=[],bf=[],sf=[],nf=[];
  for(const c of RB.closures){c.track.forEach(cs=>tf.push({type:"Feature",properties:{c:c.id},geometry:{type:"LineString",coordinates:cs}}));
    c.stations.forEach(s=>nf.push({type:"Feature",properties:{c:c.id,n:s[1],k:s[4],l:s[4]===2?s[1]+" (buses connect)":s[1]},geometry:{type:"Point",coordinates:[s[2],s[3]]}}));
    for(const n of c.routes){const r=RB.routes[n];if(!r)continue;r.shapes.forEach(cs=>bf.push({type:"Feature",properties:{c:c.id,r:n},geometry:{type:"LineString",coordinates:cs}}));
      r.stops.forEach(s=>sf.push({type:"Feature",properties:{c:c.id,n:s[1].replace(/\s*\(temporary\)/i,""),tmp:/temporary/i.test(s[1])?1:0},geometry:{type:"Point",coordinates:[s[2],s[3]]}}))}}
  map.addSource("rb-t",{type:"geojson",data:FC(tf)});map.addSource("rb-b",{type:"geojson",data:FC(bf)});map.addSource("rb-s",{type:"geojson",data:FC(sf)});map.addSource("rb-n",{type:"geojson",data:FC(nf)});
  const below="sel";
  map.addLayer({id:"rb-all",type:"line",source:"rb-t",layout:{"line-cap":"round"},paint:{"line-color":"#6b7280","line-width":["interpolate",["linear"],["zoom"],9,3.5,14,6],"line-opacity":.8,"line-dasharray":[2,1.2]}},below);
  map.addLayer({id:"rb-trk-c",type:"line",source:"rb-t",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#4b5563","line-width":["interpolate",["linear"],["zoom"],9,6,14,11],"line-opacity":.35}},below);
  map.addLayer({id:"rb-trk",type:"line",source:"rb-t",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#9ca3af","line-width":["interpolate",["linear"],["zoom"],9,3.5,14,7],"line-dasharray":[2,1.2]}},below);
  map.addLayer({id:"rb-bus",type:"line",source:"rb-b",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":RBC,"line-width":["interpolate",["linear"],["zoom"],9,2.2,14,4.5],"line-opacity":.9}},below);
  map.addLayer({id:"rb-bus-lbl",type:"symbol",source:"rb-b",minzoom:11,layout:{"symbol-placement":"line","symbol-spacing":260,"text-field":["get","r"],"text-font":FONT,"text-size":11,"text-keep-upright":true},paint:{"text-color":"#ffffff","text-halo-color":RBC,"text-halo-width":2.2}},below);
  map.addLayer({id:"rb-arr",type:"symbol",source:"rb-b",layout:{"symbol-placement":"line","symbol-spacing":110,"icon-image":"rbArrow","icon-size":["interpolate",["linear"],["zoom"],9,0.8,15,1.05],"icon-rotation-alignment":"map","icon-allow-overlap":false,"icon-padding":2}},below);
  map.addLayer({id:"rb-stop",type:"circle",source:"rb-s",minzoom:11,paint:{"circle-radius":["interpolate",["linear"],["zoom"],11,2.5,15,5.5],"circle-color":"#ffffff","circle-stroke-color":RBC,"circle-stroke-width":["case",["==",["get","tmp"],1],2.6,1.6]}},below);
  map.addLayer({id:"rb-stop-lbl",type:"symbol",source:"rb-s",minzoom:14.5,layout:{"text-field":["case",["==",["get","tmp"],1],["concat",["get","n"]," (temporary)"],["get","n"]],"text-font":FONT,"text-size":10.5,"text-offset":[0,1],"text-anchor":"top","text-optional":true},paint:{"text-color":RBC,"text-halo-color":"#ffffff","text-halo-width":1.6}},below);
  map.addLayer({id:"rb-stn",type:"circle",source:"rb-n",paint:{"circle-radius":["interpolate",["linear"],["zoom"],9,["case",["==",["get","k"],0],3,4.5],14,["case",["==",["get","k"],0],5.5,7.5]],"circle-color":["case",["==",["get","k"],2],"#ffffff","#6b7280"],"circle-stroke-color":["case",["==",["get","k"],2],RBC,"#ffffff"],"circle-stroke-width":2}},below);
  // overview: the stations of every closure on now or coming up (ends named at any zoom, the rest from zoom 9.8)
  map.addSource("rb-na",{type:"geojson",data:FC([])});
  map.addLayer({id:"rb-na-dot",type:"circle",source:"rb-na",paint:{"circle-radius":["interpolate",["linear"],["zoom"],9,["case",["==",["get","e"],1],3.5,2],14,["case",["==",["get","e"],1],6,4.5]],"circle-color":"#6b7280","circle-stroke-color":"#ffffff","circle-stroke-width":1.5}});
  map.addLayer({id:"rb-na-end",type:"symbol",source:"rb-na",filter:["==",["get","e"],1],layout:{"text-field":["get","n"],"text-font":FONT,"text-size":["interpolate",["linear"],["zoom"],8,11,14,13.5],"text-offset":[0.8,0],"text-anchor":"left","text-padding":2,"symbol-sort-key":["get","o"]},paint:{"text-color":"#1f2937","text-halo-color":"#ffffff","text-halo-width":2}});
  map.addLayer({id:"rb-na-lbl",type:"symbol",source:"rb-na",minzoom:9.8,filter:["==",["get","e"],0],layout:{"text-field":["get","n"],"text-font":FONT,"text-size":["interpolate",["linear"],["zoom"],10,10.5,13,11.5],"text-offset":[0.8,0],"text-anchor":"left","text-padding":1},paint:{"text-color":"#374151","text-halo-color":"#ffffff","text-halo-width":2}});
  const lbl=(id,f,sz,ov)=>map.addLayer({id,type:"symbol",source:"rb-n",filter:f,layout:{"text-field":["get","l"],"text-font":FONT,"text-size":sz,"text-offset":[0.9,0],"text-anchor":"left","text-padding":1,"text-allow-overlap":ov,"text-ignore-placement":false},paint:{"text-color":"#374151","text-halo-color":"#ffffff","text-halo-width":2}});
  lbl("rb-stn-lbl",["==",["get","k"],0],["interpolate",["linear"],["zoom"],9,10.5,14,13],false);lbl("rb-end-lbl",["!=",["get","k"],0],["interpolate",["linear"],["zoom"],9,12,14,14],true);
  L.push("rb-all","rb-trk-c","rb-trk","rb-bus","rb-arr","rb-bus-lbl","rb-stop","rb-stop-lbl","rb-stn","rb-stn-lbl","rb-end-lbl","rb-na-dot","rb-na-end","rb-na-lbl");rbPaint();rbFilter();
  map.on("mouseenter","rb-bus",()=>{if(rbSel)map.getCanvas().style.cursor="pointer"});map.on("mouseleave","rb-bus",()=>{map.getCanvas().style.cursor=""})}
function rbPaint(){if(!map.getLayer("rb-stn-lbl"))return;const d=theme!=="light";["rb-stn-lbl","rb-end-lbl","rb-na-end","rb-na-lbl"].forEach(id=>{map.setPaintProperty(id,"text-color",d?"#e5e7eb":"#374151");map.setPaintProperty(id,"text-halo-color",d?"#0b1220":"#ffffff")});map.setPaintProperty("rb-stop-lbl","text-halo-color",d?"#0b1220":"#ffffff")}
const RB_LAYERS=["rb-all","rb-trk-c","rb-trk","rb-bus","rb-arr","rb-bus-lbl","rb-stop","rb-stop-lbl","rb-stn","rb-stn-lbl","rb-end-lbl","rb-na-dot","rb-na-end","rb-na-lbl"];
function rbFilter(){if(!map.getLayer("rb-trk"))return;const f=["==",["get","c"],rbSel||"-"];
  ["rb-trk-c","rb-trk","rb-bus","rb-arr","rb-bus-lbl","rb-stop","rb-stop-lbl","rb-stn"].forEach(id=>map.setFilter(id,f));
  map.setFilter("rb-stn-lbl",["all",f,["==",["get","k"],0]]);map.setFilter("rb-end-lbl",["all",f,["!=",["get","k"],0]]);
  // overview: the closed track of closures on now or coming up, lightly
  const lc=RB.closures.filter(c=>rbStatus(c).s!=="past"),live=lc.map(c=>c.id);map.setFilter("rb-all",rbSel?["==",["get","c"],"-"]:["in",["get","c"],["literal",live]]);
  const M=new Map();if(!rbSel)for(const c of lc)for(const s of c.stations){if(s[4]===2)continue;const x=M.get(s[0])||{n:s[1],ll:[s[2],s[3]],e:0};if(s[4]===1)x.e=1;M.set(s[0],x)}
  // busy inner-city ends give way to outer ends when zoomed out (sort key: further from the city first)
  map.getSource("rb-na").setData(FC([...M.values()].map(x=>({type:"Feature",properties:{n:x.n,e:x.e,o:-Math.hypot(x.ll[0]-153.026,x.ll[1]+27.466)},geometry:{type:"Point",coordinates:x.ll}}))))}
function rbVis(v){RB_LAYERS.forEach(id=>map.getLayer(id)&&map.setLayoutProperty(id,"visibility",v?"visible":"none"))}
function rbLayers(on){["plat-fill","plat-line","plat-dot","plat-num"].forEach(id=>map.getLayer(id)&&map.setLayoutProperty(id,"visibility",on?"none":"visible"));
  if(on){rbSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{rbSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(rbSnap){Object.entries(rbSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});rbSnap=null}
  renderAll();hint()}
const rbAll=c=>[...c.track.flat(),...c.routes.flatMap(n=>(RB.routes[n]||{shapes:[]}).shapes.flat())];
function rbBadge(n){const i=nameIdx[n];return `<span class="rb rbr" data-rbr="${esc(n)}" style="background:${RBC};color:#fff" title="Open ${esc(n)}'s timetable">${esc(n)}</span>`}
// alerts today that talk about this closure (rail buses, or works between its end stations)
function rbAlerts(c){const ends=c.stations.filter(s=>s[4]===1).map(s=>s[1]);const nm=new RegExp("\\b("+ends.map(x=>x.replace(/[^\w ]/g,"")).join("|")+")\\b","i");
  return todaysAlerts().filter(a=>{const t=(a.header||"")+" "+(a.desc||"");return /rail (replacement )?bus|buses replace|replacement bus/i.test(t)&&nm.test(t)})}
function rbClearRoute(){focusRoutes=null;clearHL();setSel(null);drawVehicles()}
function rbOverview(){rbSel=null;rbFilter();rbClearRoute();const L=RB.closures.map(c=>({c,st:rbStatus(c)})).filter(x=>x.st.s!=="past");
  const now=L.filter(x=>x.st.s==="now"),soon=L.filter(x=>x.st.s==="soon").sort((a,b)=>a.st.a-b.st.a);
  const row=({c,st})=>`<a href="#" class="rbrow ${st.s}" data-rbc="${esc(c.id)}"><span class="rbsq"></span><span class="rbtx"><b>${esc(c.title)}</b><span>${esc(rbWhen(c))}${Object.keys(c.days).length>1?" · "+esc(rbD(Object.keys(c.days)[0],{weekday:undefined}))+" to "+esc(rbD(Object.keys(c.days).slice(-1)[0],{weekday:undefined}))+", "+Object.keys(c.days).length+" days":""}</span><span class="rbrs">${c.routes.map(esc).join(" · ")}</span></span></a>`;
  let h=`<div class="rbleg"><span><i class="rbsq now"></i> On now</span><span><i class="rbsq soon"></i> Coming up</span></div>`;
  h+=now.length?`<div class="grp">On now</div>`+now.map(row).join(""):"";
  h+=soon.length?`<div class="grp">Coming up</div>`+soon.map(row).join(""):"";
  if(!L.length)h+=`<div class="sub">No planned train closures in Translink's timetable right now.</div>`;
  h+=`<div class="odnote">Planned rail replacement buses from Translink's published timetable, about four weeks ahead, checked every morning. Tap a closure to see the closed track (grey, with its stations named) and the buses that replace it (orange), with their stops. Unplanned disruptions are in ⚠ Alerts. Unofficial; check Translink's service updates before travelling.${RB.built?" Last changed "+esc(new Date(RB.built).toLocaleString("en-AU",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:"Australia/Brisbane"}))+".":""}</div>`;
  openPanel("Rail replacement buses",`${now.length?now.length+" on now · ":""}${soon.length} coming up`,h,{view:"rb"});backState=null;pBack.style.display="none";
  pB.querySelectorAll("[data-rbc]").forEach(a=>a.onclick=e=>{e.preventDefault();rbCard(a.dataset.rbc,true)})}
function rbCard(id,fit){const c=RB.closures.find(x=>x.id===id);if(!c)return rbOverview();rbSel=id;rbFilter();rbClearRoute();const st=rbStatus(c);
  const closed=c.stations.filter(s=>s[4]!==2),conn=c.stations.filter(s=>s[4]===2),al=st.s==="now"?rbAlerts(c):[];
  let h=`<div class="rbtop"><span class="rbstat ${st.s}">${esc(rbWhen(c))}</span><button class="btn" id="rbClear" title="Back to all closures on the greyed-out map">✕ Clear selection</button></div>`;
  if(al.length)h+=`<details class="alerts pjal" open><summary>⚠ Translink alert${al.length>1?"s":""} about this closure</summary>`+al.slice(0,4).map(a=>`<div class="al"><b>${esc(a.header)}</b>${a.desc?`<p>${esc(a.desc).slice(0,600)}</p>`:""}${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">More information (Translink) ↗</a>`:""}</div>`).join("")+`</details>`;
  h+=`<div class="grp">When</div><ul class="rbdays">`+rbRuns(c).map(r=>`<li>${esc(r.txt)}</li>`).join("")+`</ul>`;
  h+=`<div class="grp">Replacement buses</div><div class="badges">${c.routes.map(rbBadge).join("")}</div>`+c.routes.map(n=>{const r=RB.routes[n];if(!r)return "";const t=r.stops.filter(s=>/temporary/i.test(s[1])).length;return `<div class="odnm">${esc(n)}: ${r.stops.length} stops${t?`, ${t} temporary`:""}, ${r.trips} trips</div>`}).join("")+`<div class="pjhint">Arrows show which way the buses run. Tap a route here or its orange line on the map for its own card and timetable (‹ comes back here). Bus stops show on the map; temporary stops have a thicker ring.</div>`;
  h+=`<div class="grp">Stations on the closed stretch (${closed.length})</div><div class="rbst">${closed.map(s=>`<a href="#" data-rbst="${esc(s[0])}" class="${s[4]===1?"end":""}">${esc(s[1])}</a>`).join("")}</div>`;
  if(conn.length)h+=`<div class="grp">Buses also connect to</div><div class="rbst">${conn.map(s=>`<a href="#" data-rbst="${esc(s[0])}" class="conn">${esc(s[1])}</a>`).join("")}</div><div class="pjhint">Trains still run at these stations; change here between bus and train.</div>`;
  h+=`<div class="odnote">The grey dashed line is the closed stretch of track, worked out from where the replacement buses run; names in bold are where buses start and finish (trains on other lines may still stop there). From Translink's published timetable; unofficial, so check Translink's service updates before travelling. <a href="#" id="rbAll">‹ All closures</a></div>`;
  openPanel(c.title,"Rail replacement buses · "+esc(c.routes.join(", ")),h,{view:"rbv"});setBack({kind:"rb"});
  document.getElementById("rbAll").onclick=e=>{e.preventDefault();rbOverview()};document.getElementById("rbClear").onclick=()=>{rbOverview();const live=RB.closures.filter(c=>rbStatus(c).s!=="past");if(live.length)pjFit(live.flatMap(c=>c.track.flat()),12)};
  pB.querySelectorAll("[data-rbr]").forEach(b=>b.onclick=()=>rbOpenRoute(b.dataset.rbr,id));
  pB.querySelectorAll("[data-rbst]").forEach(a=>a.onclick=e=>{e.preventDefault();const s=c.stations.find(x=>x[0]===a.dataset.rbst);if(s){selPt([s[2],s[3]]);map.flyTo({center:[s[2],s[3]],zoom:Math.max(map.getZoom(),14),duration:600})}});
  if(fit)pjFit(rbAll(c),14)}
// a replacement route's own card (from its badge or by tapping its line on the map); ‹ comes back to the closure
function rbOpenRoute(n,cid){const i=nameIdx[n];if(i==null)return;rbPop.remove();["rb-bus","rb-arr","rb-bus-lbl","rb-stop","rb-stop-lbl"].forEach(x=>map.setFilter(x,["==",["get","c"],"-"]));showRoute(i);setBack({kind:"rbc",id:cid})}
const rbPop=new maplibregl.Popup({closeButton:true,closeOnClick:true,offset:8,className:"rbpop"});
async function toggleRB(keep){const btn=document.getElementById("rbBtn");
  if(rbOn){rbOn=false;rbSel=null;rbVis(false);rbLayers(false);btn.classList.remove("odon");if(view==="rb"||view==="rbv")closePanel();return}
  if(odOn)await toggleOD();if(pjOn)await togglePJ(pjOn);if(gcOn)await toggleGC();if(hmOn)await toggleHM();
  if(!RB){try{RB=await (await fetch(BASE+"data/railbus.json"+DV)).json()}catch(e){openPanel("Rail replacement buses","",`<div class="sub">Rail replacement information is unavailable right now.</div>`);return}}
  rbSetup();rbOn=true;rbVis(true);rbLayers(true);btn.classList.add("odon");focusRoutes=null;backState=null;pBack.style.display="none";ctx=null;clearHL();setSel(null);webCam=null;
  if(keep)return;rbOverview();const live=RB.closures.filter(c=>rbStatus(c).s!=="past");if(live.length)pjFit(live.flatMap(c=>c.track.flat()),12)}
document.getElementById("rbBtn").onclick=()=>toggleRB();
map.on("click",e=>{if(!rbOn||!rbSel||view!=="rbv")return;const box=[[e.point.x-7,e.point.y-7],[e.point.x+7,e.point.y+7]];
  const ns=[...new Set(map.queryRenderedFeatures(box,{layers:["rb-bus","rb-arr","rb-bus-lbl"]}).map(f=>f.properties.r))].sort();if(!ns.length)return;const cid=rbSel;
  if(ns.length===1)return rbOpenRoute(ns[0],cid);
  // more than one route here: pick one
  const d=document.createElement("div");d.innerHTML=`<div class="rbpt">Which route?</div>`+ns.map(n=>`<button class="rb rbr" data-pk="${esc(n)}" style="background:${RBC};color:#fff">${esc(n)}</button>`).join("");
  d.querySelectorAll("[data-pk]").forEach(b=>b.onclick=()=>rbOpenRoute(b.dataset.pk,cid));rbPop.setLngLat(e.lngLat).setDOMContent(d).addTo(map)});
map.on("click",e=>{if(!rbOn||rbSel)return;const box=[[e.point.x-6,e.point.y-6],[e.point.x+6,e.point.y+6]];const f=map.queryRenderedFeatures(box,{layers:["rb-all"]});if(f.length)rbCard(f[0].properties.c,true)});
// ---------- live tracking of one vehicle from a route card: clears the other map layers, shows the route with its stops
// and just that vehicle, and follows it (drag the map to look around; Re-centre to follow again)
let TRK=null,trkTimer=null,trkSnap=null;
function trkLayers(on){if(on){if(trkSnap)return;trkSnap={};soloSnap=null;soloKey=null;GROUPS.forEach(([g])=>{trkSnap[g]=chipState[g];chipState[g]="off";setGroup(g,false);renderChip(g)})}
  else if(trkSnap){Object.entries(trkSnap).forEach(([g,v])=>{const st=v==="only"?"on":v;chipState[g]=st;if(g==="live")syncVehVis();else setGroup(g,st!=="off");renderChip(g)});trkSnap=null}
  renderAll();hint()}
// a soft pulse around every bus on the route while tracking (the tracked one in green)
let trkRaf=null;
function trkPulse(on){if(!map.getLayer("veh-pulse"))map.addLayer({id:"veh-pulse",type:"circle",source:"veh",layout:{visibility:"none"},paint:{"circle-color":["case",["==",["get","lv"],1],"#22c55e",["get","c"]],"circle-radius":10,"circle-opacity":0,"circle-pitch-alignment":"map"}},"veh-dot");
  cancelAnimationFrame(trkRaf);map.setLayoutProperty("veh-pulse","visibility",on?"visible":"none");if(!on)return;
  const t0=performance.now();const tick=now=>{if(!TRK){map.setLayoutProperty("veh-pulse","visibility","none");return}const p=((now-t0)%1600)/1600;const z=map.getZoom(),b=z>=13.3?11:z>=12?7:5;
    map.setPaintProperty("veh-pulse","circle-radius",["case",["==",["get","trk"],1],b+4+p*16,b+p*12]);map.setPaintProperty("veh-pulse","circle-opacity",0.6*(1-p));trkRaf=requestAnimationFrame(tick)};trkRaf=requestAnimationFrame(tick)}
function trkStop(keepCard){if(!TRK)return;TRK=null;trkPulse(false);clearInterval(trkTimer);trkTimer=null;trkLayers(false);rtFocus=false;syncVehVis();const b=document.getElementById("trkBar");if(b&&keepCard)b.remove()}
function trkVehs(i,di){return (LIVE.veh||[]).filter(v=>v.ri===i&&vehDir(i,v)===di)}
// a vehicle still at its first stop (or whose trip hasn't reached its start time) hasn't started its run yet
function trkSoon(v){const r=R[v.ri],d=r&&r.d[vehDir(v.ri,v)];const at0=d&&v.stop&&stopKey(v.stop)===d.s[0];
  let sm=null;if(v.start){const [h,m]=v.start.split(":").map(Number);sm=h*60+m}const late=sm!=null&&sm>bneNow().min+1;
  return at0||late?{at:sm,where:d&&ST[d.s[0]]?shortName(ST[d.s[0]][0]):""}:null}
const trkWhere=v=>{const so=trkSoon(v);if(so)return "starting soon"+(so.at!=null?" ("+clock(so.at)+")":"");const n=v.stop&&ST[stopKey(v.stop)];return n?"next: "+shortName(n[0]):""};
const trkWord=i=>R[i].t==="ferry"?"ferry":R[i].t==="tram"?"tram":R[i].t==="train"?"train":"bus";
function trkPick(i){const di=rcState&&rcState.i===i?rcState.di:0;let box=document.getElementById("trkBox");
  if(!box){const wr=document.getElementById("trkBtn");if(!wr)return;box=document.createElement("div");box.id="trkBox";wr.closest(".webrow").insertAdjacentElement("afterend",box)}
  const go=()=>{const vs=trkVehs(i,di),w=trkWord(i),r=R[i];
    if(!vs.length){box.innerHTML=`<div class="sub">No ${w}es${w==="bus"?"":""} on route ${esc(r.n)} are reporting their position in this direction right now. Try the other direction, or again in a minute.</div>`.replace("buses","buses").replace("ferryes","ferries").replace("trames","trams");return}
    if(vs.length===1)return trkStart(i,vs[0]);
    box.innerHTML=`<div class="grp">Which ${w}?</div>`+vs.map((v,k)=>{const ns=v.stop&&ST[stopKey(v.stop)];return `<button class="btn trkv${trkSoon(v)?" soon":""}" data-trk="${k}">${v.fleet?esc((w==="bus"?"Bus ":w==="ferry"?"Vessel ":"")+v.fleet):"Service "+(k+1)}${trkWhere(v)?` · ${esc(trkWhere(v))}`:""}</button>`}).join("");
    box.querySelectorAll("[data-trk]").forEach(b=>b.onclick=()=>trkStart(i,vs[+b.dataset.trk]))};
  if(!LIVE.vehAt||Date.now()-LIVE.vehAt>30000){box.innerHTML=`<div class="sub">Finding live positions…</div>`;pollVehicles(true).then(go)}else go()}
function trkStart(i,v){const back=backState;trkStop();showRoute(i,false,v);if(back)setBack(back);TRK={trip:v.trip,ri:i,di:vehDir(i,v),follow:true};rtFocus=true;trkLayers(true);syncVehVis();trkPulse(true);
  map.easeTo({center:[v.lon,v.lat],zoom:Math.max(map.getZoom(),14.5),duration:700});trkBar();clearInterval(trkTimer);trkTimer=setInterval(()=>pollVehicles(true),10000)}
// Track live: straight away shows every vehicle on the route in this direction, in bright green; tap one to follow it
function trkAll(i){const di=rcState&&rcState.i===i?rcState.di:0;const go=()=>{trkStop();TRK={trip:null,ri:i,di,follow:false};rtFocus=true;trkLayers(true);syncVehVis();trkPulse(true);trkBar();
    const vs=trkVehs(i,di);if(vs.length)pjFit(vs.map(v=>[v.lon,v.lat]).concat(vs.length===1?[[vs[0].lon+0.01,vs[0].lat+0.01],[vs[0].lon-0.01,vs[0].lat-0.01]]:[]),14);
    clearInterval(trkTimer);trkTimer=setInterval(()=>pollVehicles(true),10000)};
  if(!LIVE.vehAt||Date.now()-LIVE.vehAt>30000)pollVehicles(true).then(go);else go()}
function trkChip(x){return `<button class="btn trkv${trkSoon(x)?" soon":""}" data-trks="${esc(x.trip)}">${x.fleet?esc(x.fleet):"Service"}${trkWhere(x)?` · ${esc(trkWhere(x).replace(/^next: /,""))}`:""}</button>`}
function trkBar(){if(!TRK)return;
  if(TRK.trip===null){let b=document.getElementById("trkBar");if(!b){b=document.createElement("div");b.id="trkBar";b.className="trk";pB.insertAdjacentElement("afterbegin",b)}
    const w=trkWord(TRK.ri),pl=w==="bus"?"buses":w==="ferry"?"ferries":w+"s",vs=trkVehs(TRK.ri,TRK.di),d=R[TRK.ri].d[TRK.di];
    b.innerHTML=`<span class="trkdot"></span><div class="trkt"><b>Live: ${vs.length} ${vs.length===1?w:pl} on this route${d&&d.h?" to "+esc(cleanHead(d.h)):""}</b><span>${vs.length?"Positions update every 10 seconds. Tap a "+w+" here or on the map to follow it.":"None are reporting their position in this direction right now."}</span></div><button class="btn" id="trkEnd">Stop</button>${vs.length?`<div class="trko">${vs.map(trkChip).join("")}</div>`:""}`;
    b.querySelectorAll("[data-trks]").forEach(x=>x.onclick=()=>{const nv=LIVE.byTrip&&LIVE.byTrip.get(x.dataset.trks);if(nv)trkStart(TRK.ri,nv)});document.getElementById("trkEnd").onclick=()=>trkStop(true);return}const v=LIVE.byTrip&&LIVE.byTrip.get(TRK.trip);let b=document.getElementById("trkBar");
  if(!b){b=document.createElement("div");b.id="trkBar";b.className="trk";pB.insertAdjacentElement("afterbegin",b)}
  const w=trkWord(TRK.ri);const ns=v&&v.stop&&ST[stopKey(v.stop)];
  const others=TRK?trkVehs(TRK.ri,TRK.di).filter(x=>x.trip!==TRK.trip):[],otherDir=TRK?(LIVE.veh||[]).filter(x=>x.ri===TRK.ri&&x.trip!==TRK.trip&&vehDir(x.ri,x)!==TRK.di):[];
  const chips=others.length?`<div class="trko"><span>Other ${w==="bus"?"buses":w==="ferry"?"ferries":w+"s"} on this route, this direction:</span>${others.map(x=>{const n=x.stop&&ST[stopKey(x.stop)];return `<button class="btn trkv${trkSoon(x)?" soon":""}" data-trks="${esc(x.trip)}">${x.fleet?esc(x.fleet):"Service"}${trkWhere(x)?` · ${esc(trkWhere(x).replace(/^next: /,""))}`:""}</button>`}).join("")}</div>`:"";
  const od=R[TRK.ri].d.find((d,k)=>k!==TRK.di);const chips2=otherDir.length?`<div class="trko"><span>Going the other way${od&&od.h?" (to "+esc(cleanHead(od.h))+")":""}:</span>${otherDir.map(x=>`<button class="btn trkv${trkSoon(x)?" soon":""}" data-trks="${esc(x.trip)}">${x.fleet?esc(x.fleet):"Service"}${trkWhere(x)?` · ${esc(trkWhere(x).replace(/^next: /,""))}`:""}</button>`).join("")}</div>`:"";
  b.innerHTML=v?`<span class="trkdot"></span><div class="trkt"><b>Tracking ${w}${v.fleet?" "+esc(v.fleet):""} live</b><span>${trkSoon(v)?(so=>"Starting soon: waiting at "+esc(so.where)+(so.at!=null?", departs "+clock(so.at):"")+" · ")(trkSoon(v)):ns?"Next stop: "+esc(ns[0])+" · ":""}position updated ${Math.max(0,Math.round(Date.now()/1000-v.ts))} s ago</span></div>${TRK.follow?"":`<button class="btn" id="trkCtr">Re-centre</button>`}<button class="btn" id="trkAllB">All ${w==="bus"?"buses":w+"s"}</button><button class="btn" id="trkEnd">Stop</button>${chips}`
    :`<div class="trkt"><b>This ${w} has stopped reporting its position</b><span>It may have finished its trip.</span></div><button class="btn" id="trkAllB">All ${w==="bus"?"buses":w+"s"}</button><button class="btn" id="trkEnd">Stop</button>${chips}`;
  b.querySelectorAll("[data-trks]").forEach(x=>x.onclick=()=>{const nv=LIVE.byTrip&&LIVE.byTrip.get(x.dataset.trks);if(nv)trkStart(TRK.ri,nv)});
  const ab=document.getElementById("trkAllB");if(ab)ab.onclick=()=>{const i=TRK.ri,b0=backState;const di=TRK.di;rcState&&(rcState.di=di);trkAll(i)};
  const c=document.getElementById("trkCtr");if(c)c.onclick=()=>{TRK.follow=true;trkFollow(true)};document.getElementById("trkEnd").onclick=()=>trkStop(true)}
function trkFollow(now){if(!TRK)return;if(TRK.trip===null)return trkBar();const v=LIVE.byTrip&&LIVE.byTrip.get(TRK.trip);if(v&&TRK.follow)map.easeTo({center:[v.lon,v.lat],duration:now?600:1200});trkBar()}
map.on("dragstart",()=>{if(TRK&&TRK.follow){TRK.follow=false;trkBar()}});
// the button lives on every route card (also after switching direction, which redraws the card)
pB.addEventListener("click",e=>{const b=e.target.closest("#trkBtn");if(!b)return;e.stopPropagation();trkAll(+b.dataset.ri)},true);
document.getElementById("cnBtn").onclick=()=>showConnections();
// ---------- status of saved stops / routes (orange = alert, red = cancelled trip still to come)
const CX={routes:{},stops:{}};
function startMin(tu){const t=tu.trip.start;if(!t)return null;const [h,m]=t.split(":").map(Number);return h*60+m}
async function pollCancellations(){if(!FAV.stops.length&&!FAV.routes.length){applyFavStatus();return}let d;try{d=await getTrips()}catch(e){return}
  const now=bneNow();const nowMin=now.min;const today=now.ymd;const rset={},sset={};
  const favStops=new Set(FAV.stops);const kidToStop={};FAV.stops.forEach(id=>{kidToStop[id]=id;(KIDS[id]||[]).forEach(k=>kidToStop[k]=id)});
  for(const e of d.entity){const tu=e.tu;if(!tu||!tu.trip)continue;const ri=riOfRoute(tu.trip.route);if(ri<0)continue;
    const tripCx=tu.trip.sr===3;const sm=startMin(tu);if(tu.trip.date&&tu.trip.date!==today&&!(sm!==null&&sm>=1440))continue;
    if(tripCx&&(sm===null||sm>nowMin)){const key=R[ri].t==="train"?(lineOf[ri]||[])[0]:R[ri].n;(rset[key]=rset[key]||[]).push(sm)}
    for(const u of tu.stu||[]){if(!(tripCx||u.sr===1))continue;const sid=kidToStop[u.stop];if(!sid)continue;const ev=u.dep||u.arr;const when=ev&&ev.time?bneMin(ev.time):sm;if(when===null||when>nowMin)(sset[sid]=sset[sid]||[]).push(when)}}
  CX.routes=rset;CX.stops=sset;applyFavStatus()}
function favAlertState(){const nowS=Date.now()/1000,mid=Math.floor((nowS+36000)/86400)*86400-36000,eod=mid+86400;
  const live=LIVE.alerts.filter(a=>!a.periods||!a.periods.length||a.periods.some(p=>(p.start||0)<eod&&(!p.end||p.end>=nowS)));
  const st={stops:{},routes:{}};
  for(const id of FAV.stops){const ids=new Set([id,...(KIDS[id]||[])]);if(live.some(a=>alertHits(a,ids,new Set())))st.stops[id]=true}
  for(const k of FAV.routes){const ids=new Set(keyIds(k));if(live.some(a=>alertHits(a,new Set(),ids)))st.routes[k]=true}
  return st}
function statusClass(alert,cx){return alert&&cx?"st-both":cx?"st-cx":alert?"st-al":""}
function applyFavStatus(){const al=favAlertState();
  const sCls=FAV.stops.map(id=>statusClass(al.stops[id],CX.stops[id]&&CX.stops[id].length));const rCls=FAV.routes.map(k=>statusClass(al.routes[k],CX.routes[k]&&CX.routes[k].length));
  const agg=a=>a.includes("st-both")||(a.includes("st-cx")&&a.includes("st-al"))?"st-both":a.includes("st-cx")?"st-cx":a.includes("st-al")?"st-al":"";
  const sb=document.getElementById("favStopsBtn"),rb=document.getElementById("favRoutesBtn");
  sb.classList.remove("st-al","st-cx","st-both");rb.classList.remove("st-al","st-cx","st-both");const a1=agg(sCls),a2=agg(rCls);if(a1)sb.classList.add(a1);if(a2)rb.classList.add(a2);
  sb.title=a1==="st-cx"||a1==="st-both"?"A saved stop has a cancelled service still to come":a1?"A saved stop has a service alert":"Your saved stops and stations";
  rb.title=a2==="st-cx"||a2==="st-both"?"A saved route has a cancelled trip still to come":a2?"A saved route has a service alert":"Your saved routes and train lines";
  if(view==="favs")FAV.stops.forEach((id,k)=>{const el=pB.querySelector(`.fav[data-fav="${id}"]`);if(!el)return;el.classList.remove("st-al","st-cx","st-both");if(sCls[k])el.classList.add(sCls[k]);
    const n=el.querySelector(".favst");const c=CX.stops[id]||[];const txt=(c.length?`<span class="cx">✕ ${c.length} cancelled service${c.length>1?"s":""} still to come</span>`:"")+(al.stops[id]?`<span class="al">⚠ alert today</span>`:"");if(n)n.innerHTML=txt});
  if(view==="favr")FAV.routes.forEach((k,j)=>{const el=pB.querySelector(`.favr[data-rt="${CSS.escape(k)}"]`);if(!el)return;el.classList.remove("st-al","st-cx","st-both");if(rCls[j])el.classList.add(rCls[j]);
    const n=el.querySelector(".favst");const c=(CX.routes[k]||[]).filter(x=>x!==null).sort((a,b)=>a-b);const txt=(CX.routes[k]&&CX.routes[k].length?`<span class="cx">✕ ${CX.routes[k].length} cancelled${c.length?" · next "+clock(c[0]):""}</span>`:"")+(al.routes[k]?`<span class="al">⚠ alert</span>`:"");if(n)n.innerHTML=txt})}
setInterval(pollCancellations,60000);setTimeout(pollCancellations,3000);

// ---------- map clicks
const CLICK=["veh-dot","busway-pt","train-pt","busstn-pt","ferry-pt","tram-pt","stops","hlstops","ends","ends-dot","hl-line","dots"];
map.on("click",e=>{const box=[[e.point.x-7,e.point.y-7],[e.point.x+7,e.point.y+7]];
  const f=map.queryRenderedFeatures(box,{layers:CLICK.filter(id=>map.getLayer(id)&&map.getLayoutProperty(id,"visibility")!=="none")});if(!f.length)return;
  f.sort((a,b)=>CLICK.indexOf(a.layer.id)-CLICK.indexOf(b.layer.id));const top=f[0];
  if(top.layer.id==="veh-dot"&&TRK&&top.properties.trip!==TRK.trip){const v=LIVE.byTrip&&LIVE.byTrip.get(top.properties.trip);if(v){trkStart(TRK.ri,v);return}}
  if(top.layer.id==="veh-dot"){const ri=+top.properties.ri;if(R[ri]){webCam={center:map.getCenter(),zoom:map.getZoom()};const keep=webCam;const v=LIVE.byTrip&&LIVE.byTrip.get(top.properties.trip);if(R[ri].t==="train")showLine((lineOf[ri]||["T1"])[0],false,v);else showRoute(ri,false,v);webCam=keep}return}
  if(["hl-line","ends","ends-dot"].includes(top.layer.id)){const ri=+top.properties.ri;if(ctx&&ctx.web)showRoute(ri,true);return}
  if(top.layer.id==="dots"){const p=top.properties;if(p.r){webCam={center:map.getCenter(),zoom:map.getZoom()};const keep=webCam;showVariant(p.r,+p.d,+p.v);webCam=keep}return}
  openStop(top.properties.id,false)});
const pop=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});
CLICK.forEach(id=>{map.on("mouseenter",id,e=>{map.getCanvas().style.cursor="pointer";const p=e.features[0].properties;const t=id==="veh-dot"?p.tip:p.n;if(t)pop.setLngLat(e.lngLat).setText(t).addTo(map)});map.on("mouseleave",id,()=>{map.getCanvas().style.cursor="";pop.remove()})});

// ---------- search
function norm(s){return String(s).toLowerCase().replace(/\bstation\b/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
const routeIndex=[];
R.forEach((r,i)=>{if(r.t==="train")return;const lab=r.t==="tram"?"G:link":r.n;routeIndex.push({k:"r",i,key:norm(lab+" "+r.l),n:lab.toLowerCase(),html:`${badge(i,lab)}<span>${esc(r.l)}</span>`,ty:r.t})});
LINE_ORDER.filter(nm=>lineRoutes[nm]).forEach(nm=>{const dests=[...new Set(lineRoutes[nm].map(i=>R[i].l))].join(" ");routeIndex.push({k:"l",nm,key:norm(nm+" "+TNAME[nm]+" line train "+dests),n:nm.toLowerCase(),html:`${lineBadge(nm)}<span>${esc(TNAME[nm])}</span>`,ty:"train"})});
// letters for the modes at a station and the stops linked to it: B bus, F ferry, L light rail (G:link), T train
const MODE_L={bus:"B",ferry:"F",tram:"L",train:"T"},modeLC={};
function modeLetters(id){if(id in modeLC)return modeLC[id];const s=ST[id];if(!s)return "";const set=new Set();
  const add=x=>{const o=ST[x];if(!o)return;(o[5]||[]).forEach(ri=>{const t=R[ri]&&R[ri].t;if(MODE_L[t])set.add(t)})};
  add(id);(KIDS[id]||[]).forEach(add);if(s[3]!=="bus")Object.values(linkedStops(id)).flat().forEach(x=>{add(x);(KIDS[x]||[]).forEach(add)});
  return modeLC[id]=["bus","ferry","tram","train"].filter(m=>set.has(m)).map(m=>`<i class="ml ml-${MODE_L[m]}" title="${m==="tram"?"Light rail (G:link)":m.charAt(0).toUpperCase()+m.slice(1)}">${MODE_L[m]}</i>`).join("")}
const placeIndex=[];
for(const [id,s] of Object.entries(ST))placeIndex.push({k:"s",id,key:norm(s[0]),rank:{train:0,busway:0,busstn:1,ferry:2,tram:2,bus:5}[s[3]],html:`<span>${esc(s[0])}</span>`,ty:KIND[s[3]]+(s[4]?" · "+s[4]:"")});
DATA.suburbs.forEach(([n,la,lo])=>placeIndex.push({k:"sub",c:[lo,la],key:norm(n),rank:-1,html:`<span><b>${esc(n)}</b></span>`,ty:"Suburb"}));
DATA.streets.forEach(([n,sub,la,lo])=>placeIndex.push({k:"st",c:[lo,la],key:norm(n+" "+sub),rank:3,html:`<span>${esc(n)}</span>`,ty:"Street · "+sub}));
function searchRoutes(q){q=norm(q);if(!q)return[];const out=[];for(const e of routeIndex){let sc=-1;if(e.n===q)sc=0;else if(e.n.startsWith(q))sc=1;else if(e.key.split(" ").some(w=>w.startsWith(q)))sc=2;else if(e.key.includes(q))sc=3;if(sc>=0)out.push([sc+(sc>0&&e.ty!=="bus"?-.5:0),e])}
  return out.sort((a,b)=>a[0]-b[0]||(a[1].ty==="train")-(b[1].ty==="train")||cmpRoute(a[1].n.toUpperCase(),b[1].n.toUpperCase())).slice(0,40).map(x=>x[1])}
function searchPlaces(q){q=norm(q);if(q.length<2)return[];const out=[];const w=q.split(" ");for(const e of placeIndex){if(!w.every(x=>e.key.includes(x)))continue;let sc=e.rank;if(e.key.startsWith(q))sc-=3;out.push([sc,e]);if(out.length>4000)break}
  const seenK=new Set();return out.sort((a,b)=>a[0]-b[0]).map(x=>x[1]).filter(e=>{const k=e.key+e.ty;if(seenK.has(k))return false;seenK.add(k);return true}).slice(0,40)}
function setupSearch(inpId,resId,fn,pick){const inp=document.getElementById(inpId),res=document.getElementById(resId),clr=document.querySelector(`.clr[data-for="${inpId}"]`);let items=[],act=-1;
  function render(){const q=inp.value;clr.style.display=q?"block":"none";items=fn(q);act=-1;if(!q){res.style.display="none";return}
    res.innerHTML=items.length?items.map((e,k)=>`<div class="r" data-k="${k}">${e.html}${e.k==="s"?`<span class="mls">${modeLetters(e.id)}</span>`:""}<span class="ty">${esc(e.ty)}</span></div>`).join(""):`<div class="empty">No matches</div>`;res.style.display="block";
    res.querySelectorAll(".r").forEach(d=>d.onclick=()=>choose(items[+d.dataset.k]))}
  function choose(e){if(!e)return;res.style.display="none";inp.blur();pick(e)}
  inp.addEventListener("input",render);inp.addEventListener("focus",()=>{if(inp.value)render()});
  inp.addEventListener("keydown",ev=>{const rows=res.querySelectorAll(".r");if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){ev.preventDefault();act=Math.max(0,Math.min(rows.length-1,act+(ev.key==="ArrowDown"?1:-1)));rows.forEach((r,k)=>r.classList.toggle("act",k===act));rows[act]&&rows[act].scrollIntoView({block:"nearest"})}else if(ev.key==="Enter")choose(items[act>=0?act:0]);else if(ev.key==="Escape")res.style.display="none"});
  clr.onclick=()=>{inp.value="";render();inp.focus()};
  document.addEventListener("click",ev=>{if(!res.contains(ev.target)&&ev.target!==inp)res.style.display="none"})}
setupSearch("qRoute","rRoute",searchRoutes,e=>{webCam=null;if(e.k==="l")showLine(e.nm,false);else showRoute(e.i,false)});
setupSearch("qPlace","rPlace",searchPlaces,e=>{if(e.k==="s")openStop(e.id,true);else{panel.style.display="none";setSel(null);clearHL();map.flyTo({center:e.c,zoom:e.k==="sub"?14.5:16.2,duration:700})}});

// ---------- info dialog
document.getElementById("lgZones").innerHTML=Object.keys(ZCOL).map(k=>`<div class="sw" style="background:${ZCOL[k]};opacity:.85"></div><div><b>${k}xx</b> ${ZDESC[k]}</div>`).join("")+
 `<div class="sw" style="background:repeating-linear-gradient(135deg,${ZCOL[1]} 0 5px,${ZCOL[2]} 5px 10px)"></div><div>Overlap: stops of more than one series within 500 m</div>`+
 `<div class="sw" style="background:repeating-linear-gradient(135deg,${ZCOL[5]} 0 5px,#969ea8 5px 10px)"></div><div>Outlying stops outside the main zones (series + grey)</div>`+
 `<div class="sw" style="background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 8px);height:3px;margin:7px 0"></div><div>Route linking outlying stops (two-way; › marks a one-way loop)</div>`+
 `<div class="sw" style="background:linear-gradient(90deg,${BWCOL.N} 0 33%,${BWCOL.SE} 33% 66%,${BWCOL.E} 66%);height:7px;margin:5px 0"></div><div>Busways — Northern, South East, Eastern. Ringed markers are busway stations (split ring = interchange; dashed = on-road section)</div>`;
document.getElementById("feedDate").textContent=DATA.feed;
const info=document.getElementById("info");
// ---------- Legend/information: travel information from Translink (data/travelinfo.json, weekly) and a search over it all
let TI=null;
async function tiLoad(){if(TI)return TI;try{TI=await (await fetch(BASE+"data/travelinfo.json"+DV)).json()}catch(e){TI={topics:[]}}tiRender();return TI}
function tiRender(){const box=document.getElementById("travelInfo");if(!box||!TI)return;
  box.innerHTML=`<h4>Travel information</h4><div class="tin">From Translink's website${TI.built?", checked "+esc(new Date(TI.built+"T12:00:00+10:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"})):""} (updated weekly). Unofficial copy: check the Translink page for the latest.</div>`+
    TI.topics.map((t,k)=>`<details data-ti="${k}"><summary>${esc(t.t)}</summary>`+t.pages.map((p,j)=>`<div class="tip"><div class="tiph">${esc(p.title)} <a href="${esc(p.url)}" target="_blank" rel="noopener">Translink page ↗</a></div>`+
      p.s.map((x,i)=>`<div class="tis" id="tis-${k}-${j}-${i}">${x.h?`<b>${esc(x.h)}</b>`:""}${x.t.map(y=>`<p>${esc(y)}</p>`).join("")}</div>`).join("")+`</div>`).join("")+`</details>`).join("")}
function tiShow(id){const q=document.getElementById("infoQ");q.value="";infoSearch();const el=document.getElementById(id);if(!el)return;const d=el.closest("details");if(d)d.open=true;
  setTimeout(()=>{el.scrollIntoView({block:"center"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),1800)},30)}
function infoSearch(){const q=document.getElementById("infoQ").value.trim(),boxEl=info.querySelector(".box"),res=document.getElementById("infoRes");
  const ws=q.toLowerCase().split(/\s+/).filter(w=>w.length>1);boxEl.classList.toggle("searching",ws.length>0);if(!ws.length){res.innerHTML="";return}
  const has=t=>{t=t.toLowerCase();return ws.every(w=>t.includes(w))};const re=new RegExp("("+ws.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")","gi");
  const hi=t=>esc(t).replace(re,"<mark>$1</mark>");const cut=t=>{if(t.length<=220)return t;const i=Math.max(0,t.toLowerCase().indexOf(ws[0])-80);return (i?"…":"")+t.slice(i,i+220)+"…"};
  const topics=[],lines=[];
  (TI?TI.topics:[]).forEach((t,k)=>{if(has(t.t+" "+t.k+" "+t.pages.map(p=>p.title).join(" ")))topics.push({lab:t.t,id:"tis-"+k+"-0-0"});
    t.pages.forEach((p,j)=>p.s.forEach((x,i)=>{const crumb=t.t+(p.title!==t.t?" › "+p.title:"")+(x.h?" › "+x.h:"");
      if(x.h&&has(x.h))topics.push({lab:t.t+" › "+x.h,id:`tis-${k}-${j}-${i}`});
      x.t.forEach(y=>{if(has(y))lines.push({crumb,txt:y,id:`tis-${k}-${j}-${i}`})})}))});
  // the legend itself
  boxEl.querySelectorAll(".isec").forEach((d,k)=>{const sec=d.querySelector("summary").textContent;if(!d.id)d.id="isec-"+k;if(has(sec))topics.unshift({lab:"Map guide › "+sec,id:d.id});
    d.querySelectorAll(".isb > p, .isb > .warn, .isb .lg > div:not(.sw), .isb .lgst > div").forEach((el,n)=>{const y=el.textContent.trim();if(y&&has(y)){if(!el.id)el.id="lgx-"+k+"-"+n;lines.push({crumb:"Map guide › "+sec,txt:y,id:el.id})}})});
  lines.sort((a,b)=>(b.crumb.startsWith("Map guide"))-(a.crumb.startsWith("Map guide")));
  const seenT=new Set(),T=topics.filter(x=>!seenT.has(x.lab)&&seenT.add(x.lab)).slice(0,12);
  res.innerHTML=(T.length?`<div class="irg">Topics</div>`+T.map(x=>`<a href="#" class="irt" data-go="${x.id}">${hi(x.lab)}</a>`).join(""):"")+
    (lines.length?`<div class="irg">Matching text (${lines.length})</div>`+lines.slice(0,60).map(x=>`<a href="#" class="irm" data-go="${x.id}"><span class="irb">${esc(x.crumb)}</span>${hi(cut(x.txt))}</a>`).join(""):"")+
    (!T.length&&!lines.length?`<div class="sub">Nothing matches “${esc(q)}”.</div>`:"");
  res.querySelectorAll("[data-go]").forEach(a=>a.onclick=e=>{e.preventDefault();tiShow(a.dataset.go)})}
document.getElementById("infoQ").addEventListener("input",infoSearch);
new MutationObserver(()=>{if(info.style.display!=="none")tiLoad()}).observe(info,{attributes:true,attributeFilter:["style"]});
document.getElementById("infoBtn").onclick=()=>info.style.display="flex";document.getElementById("legendBtn").onclick=()=>info.style.display="flex";document.getElementById("uiSetBtn").onclick=()=>showUISettings();
document.getElementById("infoClose").onclick=()=>info.style.display="none";
info.onclick=e=>{if(e.target===info)info.style.display="none"};
try{if(!localStorage.getItem("seqmap_seen")){info.style.display="flex";localStorage.setItem("seqmap_seen","1")}}catch(e){info.style.display="flex"}
// ---------- phone layout: body.phone on narrow screens or a phone on its side (iPads and desktops are unchanged)
const PHQ=matchMedia(PHONE_MQ);
function phLayout(){const on=isPhone();document.body.classList.toggle("phone",on);document.body.classList.toggle("land",on&&innerWidth>innerHeight);
  const tb=document.getElementById("titlebar");if(on&&tb)document.documentElement.style.setProperty("--barh",Math.round(tb.getBoundingClientRect().bottom)+"px");
  if(!on){phDrop(null);panel.style.removeProperty("--ph")}}
// drop-downs in the bar: one open at a time
function phDrop(which){const b=document.body;["search","layers"].forEach(k=>{const on=which===k&&!b.classList.contains("p-"+k);b.classList.toggle("p-"+k,on);const btn=document.getElementById(k+"Btn");if(btn){btn.classList.toggle("on",on);btn.setAttribute("aria-expanded",on)}});
  if(which!=="saved"){const sw=document.getElementById("savedWrap");sw.classList.remove("open");document.getElementById("savedBtn").setAttribute("aria-expanded",false)}
  if(which&&which!=="more"&&which!=="bau")["moreWrap","bauWrap"].forEach(id=>{const w=document.getElementById(id);if(w)w.classList.remove("open")})}
document.getElementById("layersBtn").onclick=e=>{e.stopPropagation();phDrop("layers")};
document.getElementById("searchBtn").onclick=e=>{e.stopPropagation();const opening=!document.body.classList.contains("p-search");phDrop("search");if(opening)setTimeout(()=>document.getElementById("qRoute").focus(),50)};
document.getElementById("searchJS").onclick=()=>{phDrop(null);showConnections()};
(()=>{const w=document.getElementById("savedWrap"),b=document.getElementById("savedBtn");
  b.onclick=e=>{e.stopPropagation();const o=!w.classList.contains("open");phDrop("saved");["moreWrap","bauWrap"].forEach(id=>{const x=document.getElementById(id);if(x)x.classList.remove("open")});w.classList.toggle("open",o);b.setAttribute("aria-expanded",o)};
  document.getElementById("savedStops").onclick=()=>{phDrop(null);document.getElementById("favStopsBtn").click()};
  document.getElementById("savedRoutes").onclick=()=>{phDrop(null);document.getElementById("favRoutesBtn").click()};
  // the Saved button shows the same counts and orange/red status as the two buttons it replaces
  const sb=document.getElementById("favStopsBtn"),rb=document.getElementById("favRoutesBtn");
  const sync=()=>{const cl=[sb,rb].flatMap(x=>[...x.classList].filter(c=>c.startsWith("st-")));b.classList.remove("st-al","st-cx","st-both");
    const k=cl.includes("st-both")||(cl.includes("st-cx")&&cl.includes("st-al"))?"st-both":cl.includes("st-cx")?"st-cx":cl.includes("st-al")?"st-al":"";if(k)b.classList.add(k);
    const n=FAV.stops.length+FAV.routes.length;b.textContent="★ Saved"+(n?" ("+n+")":"")+" ▾";
    document.querySelector("#savedStops b").textContent=sb.textContent;document.querySelector("#savedRoutes b").textContent=rb.textContent;
    document.querySelector("#savedStops span").textContent=sb.title||"";document.querySelector("#savedRoutes span").textContent=rb.title||""};
  [sb,rb].forEach(x=>new MutationObserver(sync).observe(x,{attributes:true,childList:true,characterData:true,subtree:true}));sync()})();
// More and BAU close the bar's own drop-downs
["moreBtn","bauBtn"].forEach(id=>{const x=document.getElementById(id);if(x)x.addEventListener("click",()=>{if(isPhone()){document.body.classList.remove("p-search","p-layers");["searchBtn","layersBtn"].forEach(i=>document.getElementById(i).classList.remove("on"));document.getElementById("savedWrap").classList.remove("open");document.getElementById("savedBtn").setAttribute("aria-expanded",false)}},true)});
document.addEventListener("click",e=>{if(!isPhone())return;if(e.target.closest("#searches,#chips,#layersBtn,#searchBtn,#savedWrap"))return;document.body.classList.remove("p-search","p-layers");["searchBtn","layersBtn"].forEach(i=>document.getElementById(i).classList.remove("on"));document.getElementById("savedWrap").classList.remove("open");document.getElementById("savedBtn").setAttribute("aria-expanded",false)});
// picking a search result or a layer that opens a card closes the drop-down
new MutationObserver(()=>{if(isPhone()&&panel.style.display!=="none"&&document.body.classList.contains("p-search")&&document.activeElement&&!document.activeElement.closest("#searches"))phDrop(null)}).observe(panel,{attributes:true,attributeFilter:["style"]});
addEventListener("resize",phLayout);PHQ.addEventListener?PHQ.addEventListener("change",phLayout):PHQ.addListener(phLayout);phLayout();

// cards: open at about 72% of the screen (portrait); drag the handle or title to resize; – shrinks to the title bar
const pMinBtn=document.getElementById("pMin");
const phSnaps=()=>{const top=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--barh"))||60;const H=innerHeight;return [H-top-6,Math.round(H*.72),Math.round(H*.36)]};
function phSetH(h){panel.style.setProperty("--ph",Math.round(h)+"px")}
function phMini(on){panel.classList.toggle("mini",on);pMinBtn.textContent=on?"+":"–";pMinBtn.title=on?"Expand":"Minimise";pMinBtn.setAttribute("aria-label",pMinBtn.title)}
// opening a new card (panel was hidden) starts at 72%, expanded
new MutationObserver(m=>{if(!isPhone())return;for(const r of m){if(r.attributeName==="style"&&panel.style.display!=="none"&&r.oldValue&&/display:\s*none/.test(r.oldValue)){phSetH(innerHeight*.72);phMini(false)}}}).observe(panel,{attributes:true,attributeFilter:["style"],attributeOldValue:true});
(()=>{let y0=null,h0=0,moved=false;const land=()=>document.body.classList.contains("land");
  const start=(y)=>{y0=y;h0=panel.getBoundingClientRect().height;moved=false;panel.classList.add("dragging")};
  const move=(y)=>{if(y0==null)return;const dy=y-y0;if(Math.abs(dy)>6)moved=true;if(!moved)return;
    if(land()){panel.style.transform=dy>0?`translateY(${dy}px)`:"";return}
    if(panel.classList.contains("mini")){phMini(false);h0=Math.max(h0,80)}phSetH(Math.max(70,Math.min(phSnaps()[0],h0-dy)))};
  const end=(y)=>{if(y0==null)return;const dy=y-y0;panel.classList.remove("dragging");panel.style.transform="";y0=null;if(!moved)return;
    if(land()){if(dy>60)phMini(true);else if(dy<-30)phMini(false);return}
    const h=h0-dy;const s=phSnaps();if(h<s[2]*.6){phMini(true);return}phMini(false);phSetH(s.reduce((a,b)=>Math.abs(b-h)<Math.abs(a-h)?b:a))};
  const handle=e=>!e.target.closest("button,a,input,select,summary,label");
  [document.getElementById("pGrab"),panel.querySelector(".ph")].forEach(el=>{
    el.addEventListener("pointerdown",e=>{if(!isPhone()||!handle(e))return;el.setPointerCapture(e.pointerId);start(e.clientY)});
    el.addEventListener("pointermove",e=>move(e.clientY));el.addEventListener("pointerup",e=>end(e.clientY));el.addEventListener("pointercancel",e=>end(e.clientY))});
  // pulling down on the card's content once it's scrolled to the top also moves the card
  const pb=document.getElementById("pBody");let ty=null,tracking=false;
  pb.addEventListener("touchstart",e=>{if(!isPhone())return;ty=e.touches[0].clientY;tracking=pb.scrollTop<=0},{passive:true});
  pb.addEventListener("touchmove",e=>{if(!tracking||ty==null)return;const y=e.touches[0].clientY;if(y0==null){if(y-ty>8&&pb.scrollTop<=0)start(ty);else if(y<ty){tracking=false;return}}if(y0!=null){e.preventDefault();move(y)}},{passive:false});
  pb.addEventListener("touchend",e=>{if(y0!=null)end(e.changedTouches[0].clientY);ty=null;tracking=false})})();

// on phones, map moves keep what they show in the part of the screen the card isn't covering
function phPad(){const top=(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--barh"))||60)+10;
  const open=panel.style.display!=="none";const r=open?panel.getBoundingClientRect():null;
  if(document.body.classList.contains("land"))return {top,bottom:20,left:open&&!panel.classList.contains("mini")?r.right+20:20,right:20};
  return {top,bottom:open?Math.min(innerHeight-top-80,r.height+16):30,left:20,right:20}}
(()=>{const fb=map.fitBounds.bind(map),fly=map.flyTo.bind(map),ease=map.easeTo.bind(map);
  map.fitBounds=(b,o)=>fb(b,isPhone()?{...(o||{}),padding:phPad()}:o);
  const off=o=>{if(!isPhone()||!o||!o.center||o.offset)return o;const p=phPad();return {...o,offset:[(p.left-p.right)/2,(p.top-p.bottom)/2]}};
  map.flyTo=(o,e)=>fly(off(o),e);map.easeTo=(o,e)=>ease(off(o),e)})();
// iPad and desktop: every card can shrink to its title bar — the – button, or drag the title bar down (up, or tap the title, to open it again)
function cardMini(on){if(isPhone())return phMini(on);if(on&&!panel.classList.contains("dragging")){panel.style.height="";panel.style.maxHeight=""}if(MINI_VIEWS.has(view))return setMini(on);panel.classList.toggle("mini",on);pMinBtn.textContent=on?"+":"–";pMinBtn.title=on?"Expand":"Minimise";pMinBtn.setAttribute("aria-label",pMinBtn.title)}
pMinBtn.onclick=e=>{e.stopPropagation();cardMini(!panel.classList.contains("mini"))};
// dragging the title bar resizes the card smoothly to any height; let go within ~12 px of the title bar and it minimises
(()=>{let y0=null,h0=0,moved=false;const ok=e=>!isPhone()&&!e.target.closest("button,a,input,select,summary,label");
  const hd=()=>document.getElementById("pGrab").offsetHeight+panel.querySelector(".ph").offsetHeight+6;   // the minimised height
  const maxH=()=>Math.max(200,panel.getBoundingClientRect().bottom-(document.getElementById("top")||{getBoundingClientRect:()=>({bottom:150})}).getBoundingClientRect().bottom-12);
  const setH=h=>{panel.style.height=Math.round(h)+"px";panel.style.maxHeight="none"};
  [document.getElementById("pGrab"),panel.querySelector(".ph")].forEach(el=>{
    el.addEventListener("pointerdown",e=>{if(!ok(e))return;y0=e.clientY;moved=false;h0=panel.getBoundingClientRect().height;try{el.setPointerCapture(e.pointerId)}catch(x){}});
    el.addEventListener("pointermove",e=>{if(y0==null||isPhone())return;const dy=e.clientY-y0;if(!moved&&Math.abs(dy)<4)return;
      if(!moved){moved=true;panel.classList.add("dragging");if(panel.classList.contains("mini")){cardMini(false);h0=hd()}}
      setH(Math.max(hd(),Math.min(maxH(),h0-dy)))});
    const end=e=>{if(y0==null||isPhone())return;y0=null;panel.classList.remove("dragging");
      if(!moved){if(panel.classList.contains("mini"))cardMini(false);return}
      if(panel.getBoundingClientRect().height<=hd()+12){panel.style.height="";panel.style.maxHeight="";cardMini(true)}};
    el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end)})
  // a card opened afresh (after closing) starts at its usual size
  new MutationObserver(m=>{if(isPhone())return;for(const r of m)if(panel.style.display==="none"){panel.style.height="";panel.style.maxHeight=""}}).observe(panel,{attributes:true,attributeFilter:["style"]})})();
// iPad / iPhone: after the on-screen keyboard closes (or the browser's toolbar shows or hides), Safari and Chrome can leave the
// page pushed up with a blank strip at the bottom. Put the page back and refit the map whenever the visible area changes.
function kbLift(){const vv=window.visualViewport;if(!vv)return false;const kb=innerHeight-(vv.offsetTop+vv.height);const ae=document.activeElement;
  const typing=kb>80&&ae&&ae.matches&&ae.matches("input,textarea,select")&&panel.contains(ae)&&panel.style.display!=="none";
  if(!typing){if(panel.dataset.kb){panel.style.bottom="";panel.style.maxHeight=panel.dataset.kbmh||"";delete panel.dataset.kb;delete panel.dataset.kbmh}return false}
  if(!panel.dataset.kb){panel.dataset.kb="1";panel.dataset.kbmh=panel.style.maxHeight||""}
  const topB=Math.max(vv.offsetTop,(document.getElementById("top")||panel).getBoundingClientRect().bottom)+8;let mh=vv.offsetTop+vv.height-12-topB;if(mh<220)mh=vv.height-24;
  panel.style.bottom=(kb+12)+"px";panel.style.maxHeight=Math.round(mh)+"px";if(panel.style.height&&parseInt(panel.style.height)>mh)panel.style.height=Math.round(mh)+"px";
  setTimeout(()=>{try{ae.scrollIntoView({block:"nearest"})}catch(e){}},50);return true}
document.addEventListener("focusin",e=>{if(e.target.matches&&e.target.matches("input,textarea")&&panel.contains(e.target))setTimeout(kbLift,350)});
(()=>{let t=null;const fix=()=>{clearTimeout(t);t=setTimeout(()=>{if(kbLift())return;if(window.scrollY||window.scrollX||document.documentElement.scrollTop||document.body.scrollTop){window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0}map.resize()},120)};
  if(window.visualViewport){visualViewport.addEventListener("resize",fix);visualViewport.addEventListener("scroll",fix)}
  addEventListener("orientationchange",fix);document.addEventListener("focusout",e=>{if(e.target.matches&&e.target.matches("input,textarea,select"))fix()});addEventListener("pageshow",fix)})();
window.__ready=true;window.__map=map;window.__openStop=openStop;window.__setAlerts=l=>{LIVE.alerts=l;updateAlertBtn();pjAlertsChanged()};window.__setVeh=l=>{LIVE.veh=l.map(v=>{const i=nameIdx[v.r];const d=R[i].d[v.di||0];const sid=d.s[v.k??3],st=ST[sid];return {ri:i,trip:v.trip,dir:v.di||0,stop:sid,fleet:v.fleet||"",start:"",lat:st[1]-0.001,lon:st[2],ts:Date.now()/1000}});LIVE.vehAt=Date.now();LIVE.byTrip=new Map(LIVE.veh.map(v=>[v.trip,v]));drawVehicles()};   // for tests
})().catch(err=>{console.error(err);const l=document.getElementById("loading");if(l)l.textContent="The map could not load. Please refresh the page.";});

// ---------- "More" menu (School routes, On demand, future extras)
(()=>{const w=document.getElementById("moreWrap"),b=document.getElementById("moreBtn");
  const set=o=>{w.classList.toggle("open",o);b.setAttribute("aria-expanded",o)};
  b.onclick=e=>{e.stopPropagation();const bw=document.getElementById("bauWrap");if(bw)bw.classList.remove("open");set(!w.classList.contains("open"))};
  document.getElementById("moreMenu").addEventListener("click",()=>set(false));
  document.addEventListener("click",e=>{if(!w.contains(e.target))set(false)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false)});
  const od=document.getElementById("odBtn"),gc=document.getElementById("gcBtn"),pc=document.getElementById("crrBtn"),pw=document.getElementById("waveBtn"),hm=document.getElementById("hmBtn"),rbb=document.getElementById("rbBtn");const mo=()=>b.classList.toggle("on",[od,gc,pc,pw,hm,rbb].some(x=>x.classList.contains("odon")||x.classList.contains("gcon")));[od,gc,pc,pw,hm,rbb].forEach(x=>new MutationObserver(mo).observe(x,{attributes:true,attributeFilter:["class"]}));
  b.title="More: Translink journey planner, on demand, go card vendors, Cross River Rail, The Wave, real time average, delay heat map, school routes, lost property, commuter catch-ups, feedback"})();


