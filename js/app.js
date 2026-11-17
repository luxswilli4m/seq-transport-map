(async function () {
"use strict";
const BASE = new URL(".", location.href).href;
const net = await (await fetch(BASE + "data/network.json")).json();
const DATA = net.data, ZONES = net.zones, BUSWAY = net.busway, BWS = net.bwStations;
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

// ---------- train lines
const LINES=[["Airport","Airport"],["Gold Coast","Varsity Lakes"],["Beenleigh","Beenleigh"],["Cleveland","Cleveland"],["Shorncliffe","Shorncliffe"],["Doomben","Doomben"],["Ferny Grove","Ferny Grove"],["Caboolture","Caboolture"],["Sunshine Coast","Nambour|Gympie"],["Ipswich","Ipswich"],["Rosewood","Rosewood"],["Redcliffe Peninsula","Redcliffe"],["Springfield","Springfield"]];
const lineOf={}, lineRoutes={};
R.forEach((r,i)=>{if(r.t!=="train")return;const ls=[];for(const [nm,kw] of LINES){if(new RegExp(kw).test(r.l)){ls.push(nm);(lineRoutes[nm]=lineRoutes[nm]||[]).push(i)}}lineOf[i]=ls});
function lineMain(nm){const kw=new RegExp(LINES.find(x=>x[0]===nm)[1]);let best=null,bl=-1;for(const i of lineRoutes[nm]||[]){const r=R[i];const sc=(/Brisbane City/.test(r.l)?1000:0)+Math.max(...r.d.map(d=>d.s.length));if(sc>bl&&kw.test(r.l)){bl=sc;best=i}}return best}

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
map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
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
const dotF = ZONES.dots.map(d=>({type:"Feature",properties:{},geometry:{type:"LineString",coordinates:d.map(ll)}}));
const loopF = ZONES.loop?[{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:ZONES.loop.map(ll)}}]:[];
const bwLineF = BUSWAY.pairs.map(([key,a,b,seg])=>({type:"Feature",properties:{c:BWCOL[key],road:(a==="Truro Street station"&&b==="Federation Street station")||(a==="Federation Street station"&&b==="RBWH station")?1:0},geometry:{type:"LineString",coordinates:seg.map(ll)}}));
const net2 = {train:[],ferry:[],tram:[]};const seen=new Set();
R.forEach((r,i)=>{if(r.t==="bus")return;r.d.forEach((d,di)=>{if(seen.has(d.p))return;seen.add(d.p);net2[r.t].push({type:"Feature",properties:{c:r.c},geometry:{type:"LineString",coordinates:path(i,di)}})})});
const shortName = n => n.replace(/ busway station$| bus station$| station$/i,"");
const ptF = kind => Object.entries(ST).filter(([,s])=>s[3]===kind).map(([id,s])=>{const p={id,n:s[0],sn:shortName(s[0])};if(kind==="busway"){const b=BWS[id]||{b:["SE"],road:false};p.icon=ringIcon(b.b.map(k=>BWCOL[k]),b.road)}return {type:"Feature",properties:p,geometry:{type:"Point",coordinates:[s[2],s[1]]}}});

function src(id,data){map.addSource(id,{type:"geojson",data})}
src("zones",FC(zoneF));src("chev",FC(chevF));src("zlabels",FC(zoneLbl));src("dots",FC(dotF));src("loop",FC(loopF));
src("bwlines",FC(bwLineF));src("trainl",FC(net2.train));src("ferryl",FC(net2.ferry));src("traml",FC(net2.tram));
["busway","busstn","train","ferry","tram","bus"].forEach(k=>src("pt_"+k,FC(ptF(k))));
src("hl",FC([]));src("hlstops",FC([]));src("ends",FC([]));src("sel",FC([]));

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
add({id:"train-case",type:"line",source:"trainl",paint:{"line-color":THEME[theme].casing,"line-width":["interpolate",["linear"],["zoom"],9,4.5,14,8]}});
add({id:"train-line",type:"line",source:"trainl",paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,2.6,14,5]}});
add({id:"bw-case",type:"line",source:"bwlines",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":THEME[theme].casing,"line-width":["interpolate",["linear"],["zoom"],9,6,14,11]}});
add({id:"bw-line",type:"line",source:"bwlines",filter:["==",["get","road"],0],layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,3.6,14,7]}});
add({id:"bw-road",type:"line",source:"bwlines",filter:["==",["get","road"],1],layout:{"line-cap":"round"},paint:{"line-color":["get","c"],"line-width":["interpolate",["linear"],["zoom"],9,3.6,14,7],"line-dasharray":[.1,1.8]}});
add({id:"zlabels",type:"symbol",source:"zlabels",maxzoom:12.5,layout:{"text-field":["get","t"],"text-font":["Noto Sans Medium"],"text-size":["interpolate",["linear"],["zoom"],8,18,11,30],"text-allow-overlap":true},paint:{"text-color":THEME[theme].zoneText,"text-halo-color":THEME[theme].zoneHalo,"text-halo-width":2.2}});
// highlight (route / all routes)
add({id:"hl-case",type:"line",source:"hl",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#ffffff","line-width":["case",["==",["get","mode"],"web"],6,10],"line-opacity":.95}});
add({id:"hl-line",type:"line",source:"hl",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":["get","c"],"line-width":["case",["==",["get","mode"],"web"],3.4,6]}});
// stops & stations
add({id:"stops",type:"circle",source:"pt_bus",minzoom:13.5,paint:{"circle-color":"#E463A4","circle-radius":["interpolate",["linear"],["zoom"],14,3.6,17,6.5],"circle-stroke-color":THEME[theme].stopStroke,"circle-stroke-width":1.4}});
add({id:"hlstops",type:"circle",source:"hlstops",paint:{"circle-color":"#ffffff","circle-radius":4.5,"circle-stroke-color":["get","c"],"circle-stroke-width":2.5}});
add({id:"ferry-pt",type:"circle",source:"pt_ferry",paint:{"circle-color":"#36A9B4","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6],"circle-stroke-color":THEME[theme].stopStroke,"circle-stroke-width":1.8}});
add({id:"tram-pt",type:"circle",source:"pt_tram",paint:{"circle-color":"#FFD400","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6],"circle-stroke-color":"#0b0f17","circle-stroke-width":1.6}});
add({id:"train-pt",type:"circle",source:"pt_train",paint:{"circle-color":"#ffffff","circle-radius":["interpolate",["linear"],["zoom"],9,3,14,6.5],"circle-stroke-color":"#0b0f17","circle-stroke-width":2}});
add({id:"busstn-pt",type:"circle",source:"pt_busstn",paint:{"circle-color":"#ffffff","circle-radius":["interpolate",["linear"],["zoom"],9,3.4,14,6.5],"circle-stroke-color":"#0b0f17","circle-stroke-width":2}});
add({id:"busway-pt",type:"symbol",source:"pt_busway",layout:{"icon-image":["get","icon"],"icon-size":["interpolate",["linear"],["zoom"],9,.62,12,.85,15,1.1],"icon-allow-overlap":true,"icon-ignore-placement":true}});
add({id:"busway-lbl",type:"symbol",source:"pt_busway",minzoom:11.3,layout:{"text-field":["get","sn"],"text-font":FONT,"text-size":12.5,"text-offset":[0,1.25],"text-anchor":"top","text-optional":true,"text-padding":2},paint:{"text-color":THEME[theme].lblText,"text-halo-color":THEME[theme].lblHalo,"text-halo-width":1.8}});
add({id:"ends",type:"symbol",source:"ends",layout:{"text-field":["get","t"],"text-font":FONT,"text-size":12,"text-anchor":"left","text-offset":[.7,0],"text-allow-overlap":false,"text-padding":1},paint:{"text-color":["get","c"],"text-halo-color":"#ffffff","text-halo-width":2.2}});
add({id:"ends-dot",type:"circle",source:"ends",paint:{"circle-color":["get","c"],"circle-radius":4,"circle-stroke-color":"#fff","circle-stroke-width":1.5}});
add({id:"sel",type:"circle",source:"sel",paint:{"circle-color":"rgba(0,0,0,0)","circle-radius":12,"circle-stroke-color":"#ff2d55","circle-stroke-width":3}});
const FIRST_OVERLAY = L[0];

// ---------- theme switch
function applyThemePaint(){const T=THEME[theme];
  map.setPaintProperty("zones-fill","fill-opacity",["interpolate",["linear"],["zoom"],12,T.zoneFill,13,.16,15,.07]);
  [["dots","line-color",T.dots],["loop","line-color",T.dots],["chev-line","line-color",T.chevLine],["tram-case","line-color",T.casing],["train-case","line-color",T.casing],["bw-case","line-color",T.casing],
   ["zlabels","text-color",T.zoneText],["zlabels","text-halo-color",T.zoneHalo],["stops","circle-stroke-color",T.stopStroke],["ferry-pt","circle-stroke-color",T.stopStroke],["busway-lbl","text-color",T.lblText],["busway-lbl","text-halo-color",T.lblHalo]].forEach(([l,p,v])=>map.setPaintProperty(l,p,v))}
document.getElementById("themeBtn").onclick=()=>{
  theme = theme==="light"?"dark":"light"; document.body.classList.toggle("light",theme==="light");
  try{localStorage.setItem("seqmap_theme",theme)}catch(e){}
  const keep=new Set(L); map.getStyle().layers.map(l=>l.id).filter(id=>!keep.has(id)).forEach(id=>map.removeLayer(id));
  map.setSprite(BASE+"assets/sprites/v4/"+THEME[theme].sprite);
  baseLayers(theme).forEach(l=>map.addLayer(l,FIRST_OVERLAY)); applyThemePaint();
};

// ---------- layer toggles
const GROUPS=[
 ["zones","Bus zones","#9B5DE5",["zones-fill","chev-fill","chev-line","zones-line","dots","loop","loop-arrows","zlabels"]],
 ["busway","Busways","#1FAE98",["bw-case","bw-line","bw-road","busway-pt","busway-lbl"]],
 ["busstn","Bus stations","#ffffff",["busstn-pt"]],
 ["stops","Bus stops","#E463A4",["stops"]],
 ["train","Trains","#4778B2",["train-case","train-line","train-pt"]],
 ["ferry","Ferries","#36A9B4",["ferry-line","ferry-pt"]],
 ["tram","Tram","#FFD400",["tram-case","tram-line","tram-pt"]]];
const chipBox=document.getElementById("chips");
GROUPS.forEach(([k,label,col,ids])=>{const el=document.createElement("div");el.className="chip on";el.innerHTML=`<span class="dot" style="background:${col};border:1px solid #0004"></span>${label}`;
  el.onclick=()=>{const on=!el.classList.contains("on");el.classList.toggle("on",on);ids.forEach(id=>map.setLayoutProperty(id,"visibility",on?"visible":"none"));if(k==="stops")hint()};chipBox.appendChild(el)});
const stopsOn=()=>map.getLayoutProperty("stops","visibility")!=="none";
function hint(){const z=map.getZoom();document.getElementById("hint").style.display=(stopsOn()&&z>=12&&z<13.5)?"block":"none"}
map.on("zoomend",hint);hint();

// ---------- badges & panel
function badge(i,label){const r=R[i];return `<span class="rb" data-r="${i}" style="background:${r.c};color:${r.tc}">${esc(label||r.n)}</span>`}
function lineBadge(nm){const i=lineMain(nm);return `<span class="rb" data-line="${esc(nm)}" style="background:${R[i].c};color:#fff">${esc(nm)}</span>`}
const panel=document.getElementById("panel"),pT=document.getElementById("pTitle"),pS=document.getElementById("pSub"),pB=document.getElementById("pBody"),pBack=document.getElementById("pBack");
let ctx=null;      // current stop context {id, web}
let backState=null;// set when a route is opened from a stop card
function openPanel(t,s,html){pT.textContent=t;pS.innerHTML=s;pB.innerHTML=html;panel.style.display="flex";wire()}
function wire(){pB.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>showRoute(+b.dataset.r,true));pB.querySelectorAll("[data-line]").forEach(b=>b.onclick=()=>showLine(b.dataset.line,true));
  pB.querySelectorAll("[data-near]").forEach(el=>el.onclick=()=>openStop(el.dataset.near,true));pB.querySelectorAll("[data-s]").forEach(li=>li.onclick=()=>openStop(li.dataset.s,true))}
function setSel(id){const s=id&&ST[id];map.getSource("sel").setData(FC(s?[{type:"Feature",properties:{},geometry:{type:"Point",coordinates:[s[2],s[1]]}}]:[]))}
function clearHL(){map.getSource("hl").setData(FC([]));map.getSource("hlstops").setData(FC([]));map.getSource("ends").setData(FC([]))}
document.getElementById("pClose").onclick=()=>{panel.style.display="none";clearHL();setSel(null);ctx=null;backState=null;pBack.style.display="none"};
pBack.onclick=()=>{if(!backState)return;const b=backState;backState=null;pBack.style.display="none";map.jumpTo(b.cam);openStop(b.id,false,b.web)};
function sortRoutes(ids){return ids.slice().sort((a,b)=>{const A=R[a].n,B=R[b].n,na=parseInt(A.replace(/\D/g,"")),nb=parseInt(B.replace(/\D/g,""));return (isNaN(na)?1e9:na)-(isNaN(nb)?1e9:nb)||A.localeCompare(B)})}
function dist(a,b){const k=Math.PI/180,x=(b[2]-a[2])*Math.cos((a[1]+b[1])/2*k),y=b[1]-a[1];return Math.sqrt(x*x+y*y)*111320}

function openStop(id,fly,web){const s=ST[id];if(!s)return;ctx={id,web:!!web};backState=null;pBack.style.display="none";clearHL();setSel(id);
  if(fly)map.flyTo({center:[s[2],s[1]],zoom:Math.max(map.getZoom(),s[3]==="bus"?16:15),duration:600});
  const groups={bus:[],train:new Set(),ferry:[],tram:[]};
  s[5].forEach(i=>{const t=R[i].t;if(t==="train")(lineOf[i]||[]).forEach(l=>groups.train.add(l));else groups[t].push(i)});
  const near=[];for(const [oid,o] of Object.entries(ST)){if(oid===id||o[3]==="bus")continue;const d=dist(s,o);if(d<250)near.push([d,oid,o])}near.sort((a,b)=>a[0]-b[0]);
  let h="";
  if(groups.train.size)h+=`<div class="grp">Train lines</div><div class="badges">${[...groups.train].sort().map(lineBadge).join("")}</div>`;
  if(groups.bus.length)h+=`<div class="grp">Bus routes (${groups.bus.length})</div><div class="badges">${sortRoutes(groups.bus).map(i=>badge(i)).join("")}</div>`;
  if(groups.ferry.length)h+=`<div class="grp">Ferry</div><div class="badges">${groups.ferry.map(i=>badge(i)).join("")}</div>`;
  if(groups.tram.length)h+=`<div class="grp">Tram</div><div class="badges">${groups.tram.map(i=>badge(i,"G:link")).join("")}</div>`;
  if(s[5].length)h+=`<div style="margin-top:10px"><button class="btn${web?" on":""}" id="webBtn">${web?"Hide all routes":"Show all routes"}</button></div>`;
  else h+=`<div class="sub">No scheduled services in this timetable.</div>`;
  if(near.length)h+=`<div class="grp">Also here</div>`+near.slice(0,4).map(([d,oid,o])=>`<div class="near" data-near="${oid}">${esc(o[0])} <span>· ${KIND[o[3]]} · ${Math.round(d)} m</span></div>`).join("");
  let sub=KIND[s[3]];if(s[3]==="busway"&&BWS[id])sub+=" · "+BWS[id].b.map(k=>BWNAME[k]).join(" / ")+(BWS[id].road?" (on-road section)":"");if(s[4])sub+=" · "+esc(s[4]);
  openPanel(s[0],sub,h);
  const wb=document.getElementById("webBtn");if(wb)wb.onclick=()=>openStop(id,false,!ctx.web);
  if(web)drawWeb(id)}

// all routes from a stop ("spider web") with end labels
function drawWeb(id){const s=ST[id];const lines=[],ends=[];const seenEnd=new Set();let bb=null;
  s[5].forEach(i=>{const r=R[i];r.d.forEach((d,di)=>{const p=path(i,di);lines.push({type:"Feature",properties:{c:r.c,ri:i,mode:"web"},geometry:{type:"LineString",coordinates:p}});
    p.forEach(([x,y])=>{bb=bb?[Math.min(bb[0],x),Math.min(bb[1],y),Math.max(bb[2],x),Math.max(bb[3],y)]:[x,y,x,y]});
    const last=d.s[d.s.length-1];const ls=ST[last];if(!ls||last===id)return;const dest=(d.h&&d.h.length<34?d.h:ls[0]).replace(/\s*,\s*stop\s+\w+$/i,"").replace(/\s+(near|at|opp)\s+.*$/i,"");const lab=(r.t==="train"?(lineOf[i]||[r.n]).join("/"):r.t==="tram"?"G:link":r.n)+" → "+shortName(dest);const key=lab;if(seenEnd.has(key))return;seenEnd.add(key);
    ends.push({type:"Feature",properties:{t:lab,c:r.c,ri:i},geometry:{type:"Point",coordinates:[ls[2],ls[1]]}})})});
  map.getSource("hl").setData(FC(lines));map.getSource("ends").setData(FC(ends));
  if(bb)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?400:30,right:40},duration:700,maxZoom:15})}

// single route view
function routeStops(i,di){const r=R[i],d=r.d[di];map.getSource("hlstops").setData(FC(d.s.filter(id=>ST[id]).map(id=>({type:"Feature",properties:{c:r.c,id},geometry:{type:"Point",coordinates:[ST[id][2],ST[id][1]]}}))));
  return `<ol class="stops" style="--rc:${r.c}">`+d.s.map(id=>{const s=ST[id];return s?`<li data-s="${id}">${esc(s[0])}${s[4]?`<span class="s2">${esc(s[4])}</span>`:""}</li>`:""}).join("")+"</ol>"}
function routeBody(i,di){const r=R[i];const dirs=r.d.length>1?`<div class="dirs">${r.d.map((d,k)=>`<button data-d="${k}" class="${k===di?"on":""}">To ${esc(d.h||("direction "+(k+1)))}</button>`).join("")}</div>`:(r.d[0]&&r.d[0].h?`<div class="sub" style="margin-bottom:8px">To ${esc(r.d[0].h)}</div>`:"");
  return dirs+`<div class="grp">${r.d[di]?r.d[di].s.length:0} stops</div>`+routeStops(i,di)}
function wireDirs(i){pB.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{pB.innerHTML=routeBody(i,+b.dataset.d);wire();wireDirs(i)})}
function rememberStop(fromStop){if(fromStop&&ctx){backState={id:ctx.id,web:ctx.web,cam:{center:map.getCenter(),zoom:map.getZoom()}};pBack.style.display="block"}else{backState=null;pBack.style.display="none"}}
function drawPaths(ids,col){const f=[];let bb=null;ids.forEach(i=>R[i].d.forEach((d,di)=>{const p=path(i,di);f.push({type:"Feature",properties:{c:col||R[i].c,ri:i,mode:"route"},geometry:{type:"LineString",coordinates:p}});p.forEach(([x,y])=>{bb=bb?[Math.min(bb[0],x),Math.min(bb[1],y),Math.max(bb[2],x),Math.max(bb[3],y)]:[x,y,x,y]})}));
  map.getSource("hl").setData(FC(f));map.getSource("ends").setData(FC([]));if(bb)map.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]],{padding:{top:170,bottom:60,left:innerWidth>640?400:30,right:40},duration:700,maxZoom:15})}
function showRoute(i,fromStop){const keep=fromStop?ctx:null;rememberStop(fromStop);ctx=null;setSel(null);const r=R[i];drawPaths([i]);
  const tl=r.t==="tram"?"G:link light rail":r.t==="ferry"?"Ferry":r.t==="train"?"Train":"Bus";
  openPanel(`${r.t==="tram"?"G:link":r.n} — ${r.l}`,`${tl} route`,routeBody(i,0));wireDirs(i);if(backState)pBack.style.display="block"}
function showLine(nm,fromStop){rememberStop(fromStop);ctx=null;setSel(null);const ids=lineRoutes[nm]||[];const main=lineMain(nm);drawPaths(ids,R[main].c);
  const other=ids.filter(i=>i!==main);let h=routeBody(main,0);
  if(other.length)h=`<div class="grp">Services on this line</div><div class="badges" style="margin-bottom:8px">${other.slice(0,14).map(i=>badge(i,R[i].l)).join("")}</div>`+h;
  openPanel(`${nm} line`,`Train · main service ${esc(R[main].l)}`,h);wireDirs(main);if(backState)pBack.style.display="block"}

// ---------- map clicks
const CLICK=["busway-pt","train-pt","busstn-pt","ferry-pt","tram-pt","stops","hlstops","ends","ends-dot","hl-line"];
map.on("click",e=>{const box=[[e.point.x-7,e.point.y-7],[e.point.x+7,e.point.y+7]];
  const f=map.queryRenderedFeatures(box,{layers:CLICK.filter(id=>map.getLayer(id)&&map.getLayoutProperty(id,"visibility")!=="none")});if(!f.length)return;
  f.sort((a,b)=>CLICK.indexOf(a.layer.id)-CLICK.indexOf(b.layer.id));const top=f[0];
  if(["hl-line","ends","ends-dot"].includes(top.layer.id)){const ri=+top.properties.ri;if(ctx&&ctx.web)showRoute(ri,true);return}
  openStop(top.properties.id,false)});
const pop=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});
CLICK.forEach(id=>{map.on("mouseenter",id,e=>{map.getCanvas().style.cursor="pointer";const p=e.features[0].properties;if(p.n)pop.setLngLat(e.lngLat).setText(p.n).addTo(map)});map.on("mouseleave",id,()=>{map.getCanvas().style.cursor="";pop.remove()})});

// ---------- search
function norm(s){return String(s).toLowerCase().replace(/\bstation\b/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
const routeIndex=[];
R.forEach((r,i)=>{if(r.t==="train")return;const lab=r.t==="tram"?"G:link":r.n;routeIndex.push({k:"r",i,key:norm(lab+" "+r.l),n:lab.toLowerCase(),html:`${badge(i,lab)}<span>${esc(r.l)}</span>`,ty:r.t})});
Object.keys(lineRoutes).forEach(nm=>routeIndex.push({k:"l",nm,key:norm(nm+" line train"),n:nm.toLowerCase(),html:`${lineBadge(nm)}<span>${esc(nm)} line</span>`,ty:"train"}));
const placeIndex=[];
for(const [id,s] of Object.entries(ST))placeIndex.push({k:"s",id,key:norm(s[0]),rank:{train:0,busway:0,busstn:1,ferry:2,tram:2,bus:5}[s[3]],html:`<span>${esc(s[0])}</span>`,ty:KIND[s[3]]+(s[4]?" · "+s[4]:"")});
DATA.suburbs.forEach(([n,la,lo])=>placeIndex.push({k:"sub",c:[lo,la],key:norm(n),rank:-1,html:`<span><b>${esc(n)}</b></span>`,ty:"Suburb"}));
DATA.streets.forEach(([n,sub,la,lo])=>placeIndex.push({k:"st",c:[lo,la],key:norm(n+" "+sub),rank:3,html:`<span>${esc(n)}</span>`,ty:"Street · "+sub}));
function searchRoutes(q){q=norm(q);if(!q)return[];const out=[];for(const e of routeIndex){let sc=-1;if(e.n===q)sc=0;else if(e.n.startsWith(q))sc=1;else if(e.key.split(" ").some(w=>w.startsWith(q)))sc=2;else if(e.key.includes(q))sc=3;if(sc>=0)out.push([sc+(sc>0&&e.ty!=="bus"?-.5:0),e])}
  return out.sort((a,b)=>a[0]-b[0]||a[1].n.localeCompare(b[1].n,undefined,{numeric:true})).slice(0,40).map(x=>x[1])}
function searchPlaces(q){q=norm(q);if(q.length<2)return[];const out=[];const w=q.split(" ");for(const e of placeIndex){if(!w.every(x=>e.key.includes(x)))continue;let sc=e.rank;if(e.key.startsWith(q))sc-=3;out.push([sc,e]);if(out.length>4000)break}
  const seenK=new Set();return out.sort((a,b)=>a[0]-b[0]).map(x=>x[1]).filter(e=>{const k=e.key+e.ty;if(seenK.has(k))return false;seenK.add(k);return true}).slice(0,40)}
function setupSearch(inpId,resId,fn,pick){const inp=document.getElementById(inpId),res=document.getElementById(resId),clr=document.querySelector(`.clr[data-for="${inpId}"]`);let items=[],act=-1;
  function render(){const q=inp.value;clr.style.display=q?"block":"none";items=fn(q);act=-1;if(!q){res.style.display="none";return}
    res.innerHTML=items.length?items.map((e,k)=>`<div class="r" data-k="${k}">${e.html}<span class="ty">${esc(e.ty)}</span></div>`).join(""):`<div class="empty">No matches</div>`;res.style.display="block";
    res.querySelectorAll(".r").forEach(d=>d.onclick=()=>choose(items[+d.dataset.k]))}
  function choose(e){if(!e)return;res.style.display="none";inp.blur();pick(e)}
  inp.addEventListener("input",render);inp.addEventListener("focus",()=>{if(inp.value)render()});
  inp.addEventListener("keydown",ev=>{const rows=res.querySelectorAll(".r");if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){ev.preventDefault();act=Math.max(0,Math.min(rows.length-1,act+(ev.key==="ArrowDown"?1:-1)));rows.forEach((r,k)=>r.classList.toggle("act",k===act));rows[act]&&rows[act].scrollIntoView({block:"nearest"})}else if(ev.key==="Enter")choose(items[act>=0?act:0]);else if(ev.key==="Escape")res.style.display="none"});
  clr.onclick=()=>{inp.value="";render();inp.focus()};
  document.addEventListener("click",ev=>{if(!res.contains(ev.target)&&ev.target!==inp)res.style.display="none"})}
setupSearch("qRoute","rRoute",searchRoutes,e=>{if(e.k==="l")showLine(e.nm,false);else showRoute(e.i,false)});
setupSearch("qPlace","rPlace",searchPlaces,e=>{if(e.k==="s")openStop(e.id,true);else{panel.style.display="none";setSel(null);clearHL();map.flyTo({center:e.c,zoom:e.k==="sub"?14.5:16.2,duration:700})}});

// ---------- info dialog
document.getElementById("lgZones").innerHTML=Object.keys(ZCOL).map(k=>`<div class="sw" style="background:${ZCOL[k]};opacity:.85"></div><div><b>${k}xx</b> ${ZDESC[k]}</div>`).join("")+
 `<div class="sw" style="background:repeating-linear-gradient(135deg,${ZCOL[1]} 0 5px,${ZCOL[2]} 5px 10px)"></div><div>Overlap: stops of more than one series within 500 m</div>`+
 `<div class="sw" style="background:repeating-linear-gradient(135deg,${ZCOL[5]} 0 5px,#969ea8 5px 10px)"></div><div>Outlying stops outside the main zones (series + grey)</div>`+
 `<div class="sw" style="background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 8px);height:3px;margin:7px 0"></div><div>Route linking outlying stops (two-way; › marks a one-way loop)</div>`+
 `<div class="sw" style="background:linear-gradient(90deg,${BWCOL.N} 0 33%,${BWCOL.SE} 33% 66%,${BWCOL.E} 66%);height:7px;margin:5px 0"></div><div>Busways — Northern, South East, Eastern. Ringed markers are busway stations (split ring = interchange; dashed = on-road section)</div>`;
document.getElementById("feedDate").textContent=DATA.feed;
const info=document.getElementById("info");
document.getElementById("infoBtn").onclick=()=>info.style.display="flex";
document.getElementById("infoClose").onclick=()=>info.style.display="none";
info.onclick=e=>{if(e.target===info)info.style.display="none"};
try{if(!localStorage.getItem("seqmap_seen")){info.style.display="flex";localStorage.setItem("seqmap_seen","1")}}catch(e){info.style.display="flex"}
window.__ready=true;
})().catch(err=>{console.error(err);const l=document.getElementById("loading");if(l)l.textContent="The map could not load. Please refresh the page.";});
