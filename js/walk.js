// Walking routes along the base map's streets and paths (the same OpenStreetMap data drawn on the map,
// read from tiles/seq.pmtiles at zoom 14), for Best connections. Runs in the browser; nothing is sent anywhere.
// walkRoute([lon,lat],[lon,lat],{noSteps}) -> {m, coords, segs:[{m,name,steps}], steps} or null
(function(){
const Z=14,N=1<<Z,EXT=4096,W=N*EXT;
let pm=null;const tileCache=new Map(),graphCache=new Map();
const WALK_KIND={minor_road:1,major_road:1,path:1,other:1};
const NO_DETAIL={busway:1,bus_stop:1,motorway:1,motorway_link:1,trunk_link:1,raceway:1};

// ---- a small Mapbox Vector Tile reader (only what's needed: the roads layer's lines and their tags)
function Pbf(buf){this.b=buf;this.p=0}
Pbf.prototype.varint=function(){let r=0,m=1,b;do{b=this.b[this.p++];r+=(b&127)*m;m*=128}while(b>=128);return r};
Pbf.prototype.skip=function(t){if(t===0)this.varint();else if(t===1)this.p+=8;else if(t===2){const l=this.varint();this.p+=l}else if(t===5)this.p+=4};
Pbf.prototype.sub=function(){const l=this.varint();const s=new Pbf(this.b.subarray(this.p,this.p+l));this.p+=l;return s};
Pbf.prototype.str=function(){const l=this.varint();const s=new TextDecoder().decode(this.b.subarray(this.p,this.p+l));this.p+=l;return s};
function readValue(p){let v=null;while(p.p<p.b.length){const k=p.varint(),f=k>>3,t=k&7;
  if(f===1)v=p.str();else if(f===2){v=new DataView(p.b.buffer,p.b.byteOffset+p.p,4).getFloat32(0,true);p.p+=4}
  else if(f===3){v=new DataView(p.b.buffer,p.b.byteOffset+p.p,8).getFloat64(0,true);p.p+=8}
  else if(f===4||f===5)v=p.varint();else if(f===6){const n=p.varint();v=(n>>>1)^-(n&1)}else if(f===7)v=!!p.varint();else p.skip(t)}return v}
function readRoads(buf,tx,ty){const p=new Pbf(new Uint8Array(buf));const out=[];
  while(p.p<p.b.length){const k=p.varint();if((k>>3)!==3||(k&7)!==2){p.skip(k&7);continue}
    const L=p.sub();let name="",ext=EXT;const feats=[],keys=[],vals=[];
    while(L.p<L.b.length){const k2=L.varint(),f=k2>>3;
      if(f===1)name=L.str();else if(f===2)feats.push(L.sub());else if(f===3)keys.push(L.str());else if(f===4)vals.push(readValue(L.sub()));else if(f===5)ext=L.varint();else L.skip(k2&7)}
    if(name!=="roads")continue;const sc=EXT/ext;
    for(const F of feats){let tags=null,type=0,geom=null;
      while(F.p<F.b.length){const k3=F.varint(),f=k3>>3;
        if(f===2||f===4){const s=F.sub();const a=[];while(s.p<s.b.length)a.push(s.varint());if(f===2)tags=a;else geom=a}
        else if(f===3)type=F.varint();else F.skip(k3&7)}
      if(type!==2||!tags||!geom)continue;const pr={};for(let i=0;i+1<tags.length;i+=2)pr[keys[tags[i]]]=vals[tags[i+1]];
      if(!WALK_KIND[pr.kind]||NO_DETAIL[pr.kind_detail]||(pr.is_tunnel&&pr.kind!=="path"))continue;
      let x=0,y=0,i=0,line=null;const lines=[];
      while(i<geom.length){const c=geom[i++],id=c&7,n=c>>3;
        if(id===1||id===2){for(let j=0;j<n;j++){const dx=geom[i++],dy=geom[i++];x+=(dx>>>1)^-(dx&1);y+=(dy>>>1)^-(dy&1);
          if(id===1){line=[];lines.push(line)}line.push(tx*EXT+Math.round(x*sc),ty*EXT+Math.round(y*sc))}}}
      for(const l of lines)if(l.length>=4)out.push({g:l,name:pr.name||"",steps:pr.kind_detail==="steps",kind:pr.kind,detail:pr.kind_detail||"",lift:!!(pr.is_bridge||pr.is_tunnel)})}}
  return out}
async function tile(tx,ty){const k=tx+"/"+ty;if(!tileCache.has(k))tileCache.set(k,(async()=>{
  if(!pm)pm=new pmtiles.PMTiles(new URL("tiles/seq.pmtiles",location.href).href);const r=await pm.getZxy(Z,tx,ty);return r&&r.data?readRoads(r.data,tx,ty):[]})().catch(()=>[]));return tileCache.get(k)}

// ---- geometry: global tile-pixel coordinates <-> lon/lat and metres
const gLon=gx=>gx/W*360-180,gLat=gy=>Math.atan(Math.sinh(Math.PI*(1-2*gy/W)))*180/Math.PI;
const toG=([lon,lat])=>[(lon+180)/360*W,(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*W];
function mPerG(lat){return 40075016.7*Math.cos(lat*Math.PI/180)/W}

// ---- graph from the tiles around a walk; junctions are shared vertices, and line ends that stop just short
// of another line (common at T-junctions in simplified tiles) are joined to it
async function graphFor(tiles){const key=tiles.map(t=>t.join("/")).sort().join(" ");if(graphCache.has(key))return graphCache.get(key);
  const feats=(await Promise.all(tiles.map(([x,y])=>tile(x,y)))).flat();
  const idx=new Map(),X=[],Y=[],adj=[],deg=[];const node=(x,y)=>{const k=x*67108864+y;let i=idx.get(k);if(i===undefined){i=X.length;idx.set(k,i);X.push(x);Y.push(y);adj.push([]);deg.push(0)}return i};
  const lat0=gLat(tiles[0][1]*EXT+EXT/2),mpg=mPerG(lat0);const info=[];
  const segs=[];   // [a,b,info] for snapping
  for(const f of feats){const inf=info.length;info.push(f);let prev=node(f.g[0],f.g[1]);
    for(let i=2;i<f.g.length;i+=2){const n=node(f.g[i],f.g[i+1]);if(n!==prev){const m=Math.hypot(X[n]-X[prev],Y[n]-Y[prev])*mpg;adj[prev].push([n,m,inf]);adj[n].push([prev,m,inf]);segs.push([prev,n,inf])}prev=n}
    deg[node(f.g[0],f.g[1])]++;deg[node(f.g[f.g.length-2],f.g[f.g.length-1])]++}
  const CELL=40/mpg,grid=new Map();const gk=(cx,cy)=>cx+","+cy;
  segs.forEach((s,si)=>{const x0=Math.floor(Math.min(X[s[0]],X[s[1]])/CELL),x1=Math.floor(Math.max(X[s[0]],X[s[1]])/CELL),y0=Math.floor(Math.min(Y[s[0]],Y[s[1]])/CELL),y1=Math.floor(Math.max(Y[s[0]],Y[s[1]])/CELL);
    for(let a=x0;a<=x1;a++)for(let b=y0;b<=y1;b++){const k=gk(a,b);let c=grid.get(k);if(!c)grid.set(k,c=[]);c.push(si)}});
  // nearest line pieces to a point: the closest one, or (k>1) the closest piece of each of the k nearest lines
  const nearK=(x,y,maxM,ok,k)=>{const by=new Map();const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL),r=Math.ceil(maxM/40);
    for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++)for(const si of grid.get(gk(cx+a,cy+b))||[]){const s=segs[si];if(ok&&!ok(s))continue;
      const ax=X[s[0]],ay=Y[s[0]],bx=X[s[1]],by_=Y[s[1]],dx=bx-ax,dy=by_-ay,L=dx*dx+dy*dy;let t=L?((x-ax)*dx+(y-ay)*dy)/L:0;t=Math.max(0,Math.min(1,t));
      const px=ax+t*dx,py=ay+t*dy,m=Math.hypot(px-x,py-y)*mpg;if(m<=maxM&&(!by.has(s[2])||m<by.get(s[2]).m))by.set(s[2],{s,px,py,m})}
    return [...by.values()].sort((p,q)=>p.m-q.m).slice(0,k)};
  const near=(x,y,maxM,ok)=>{let best=null;const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL),r=Math.ceil(maxM/40);
    for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++)for(const si of grid.get(gk(cx+a,cy+b))||[]){const s=segs[si];if(ok&&!ok(s))continue;
      const ax=X[s[0]],ay=Y[s[0]],bx=X[s[1]],by=Y[s[1]],dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy;let t=L?((x-ax)*dx+(y-ay)*dy)/L:0;t=Math.max(0,Math.min(1,t));
      const px=ax+t*dx,py=ay+t*dy,m=Math.hypot(px-x,py-y)*mpg;if(m<=maxM&&(!best||m<best.m))best={s,px,py,m}}return best};
  for(let n=0;n<X.length;n++){if(deg[n]!==1||adj[n].length!==1)continue;const own=adj[n][0][2];
    const h=near(X[n],Y[n],4,s=>s[2]!==own&&s[0]!==n&&s[1]!==n);if(!h)continue;
    for(const e of [h.s[0],h.s[1]]){const m=h.m+Math.hypot(X[e]-h.px,Y[e]-h.py)*mpg;const via=[h.px,h.py];adj[n].push([e,m,h.s[2],via]);adj[e].push([n,m,h.s[2],via])}}
  const G={X,Y,adj,info,mpg,near,nearK};graphCache.set(key,G);if(graphCache.size>12)graphCache.delete(graphCache.keys().next().value);return G}

// ---- A* between two points, each joined to the nearest walkable line
function heapPush(h,v){h.push(v);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p][0]<=h[i][0])break;[h[p],h[i]]=[h[i],h[p]];i=p}}
function heapPop(h){const top=h[0],last=h.pop();if(h.length){h[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<h.length&&h[l][0]<h[m][0])m=l;if(r<h.length&&h[r][0]<h[m][0])m=r;if(m===i)break;[h[m],h[i]]=[h[i],h[m]];i=m}}return top}
async function walkRoute(a,b,opt={}){
  const ga=toG(a),gb=toG(b);const lat=(a[1]+b[1])/2,mpg=mPerG(lat);const straight=Math.hypot(ga[0]-gb[0],ga[1]-gb[1])*mpg;
  const pad=Math.max(350,straight*0.35)/mpg;const tx0=Math.floor((Math.min(ga[0],gb[0])-pad)/EXT),tx1=Math.floor((Math.max(ga[0],gb[0])+pad)/EXT),ty0=Math.floor((Math.min(ga[1],gb[1])-pad)/EXT),ty1=Math.floor((Math.max(ga[1],gb[1])+pad)/EXT);
  const tiles=[];for(let x=tx0;x<=tx1;x++)for(let y=ty0;y<=ty1;y++)tiles.push([x,y]);if(tiles.length>16)return null;
  const G=await graphFor(tiles);const {X,Y,adj,info}=G;
  const okSnap=s=>!(opt.noSteps&&info[s[2]].steps);
  // join each end to the nearest few lines (a ferry pontoon or platform may not connect to anything); the extra
  // distance to reach a farther line counts, so the nearest connected one wins
  const HS=G.nearK(ga[0],ga[1],250,okSnap,5),HE=G.nearK(gb[0],gb[1],250,okSnap,5);if(!HS.length||!HE.length)return null;
  // the start joins the two ends of its nearest line piece; the finish is reached from the two ends of its own
  const S=X.length,T=S+1;const fromS=[],intoT=new Map();const E=i=>i===S?fromS:i===T?[]:adj[i];
  const XX=i=>i===S?ga[0]:i===T?gb[0]:X[i],YY=i=>i===S?ga[1]:i===T?gb[1]:Y[i];
  for(const hs of HS)for(const e of [hs.s[0],hs.s[1]])fromS.push([e,hs.m+Math.hypot(X[e]-hs.px,Y[e]-hs.py)*mpg,hs.s[2],[hs.px,hs.py]]);
  for(const he of HE)for(const e of [he.s[0],he.s[1]]){const r=[T,he.m+Math.hypot(X[e]-he.px,Y[e]-he.py)*mpg,he.s[2],[he.px,he.py]];if(!intoT.has(e)||intoT.get(e)[1]>r[1])intoT.set(e,r)}
  const hs=HS[0],he=HE[0];if(hs.s===he.s||straight<25)fromS.push([T,hs.m+he.m+Math.hypot(hs.px-he.px,hs.py-he.py)*mpg,hs.s[2],[hs.px,hs.py,he.px,he.py]]);
  const run=noSteps=>{const dist=new Map([[S,0]]),prev=new Map(),h=[[0,S]];const hEst=i=>Math.hypot(XX(i)-gb[0],YY(i)-gb[1])*mpg;let it=0;
    while(h.length&&it++<400000){const [f,u]=heapPop(h);const du=dist.get(u);if(u===T)break;if(f>du+hEst(u)+1e-6)continue;
      const out=E(u).slice();const t=intoT.get(u);if(t)out.push(t);
      for(const e of out){const inf=info[e[2]];if(noSteps&&inf&&inf.steps)continue;const nd=du+e[1];if(nd<(dist.has(e[0])?dist.get(e[0]):Infinity)){dist.set(e[0],nd);prev.set(e[0],[u,e]);heapPush(h,[nd+hEst(e[0]),e[0]])}}}
    if(!dist.has(T))return null;const seq=[];let v=T;while(v!==S){const [u,e]=prev.get(v);seq.push([u,v,e]);v=u}seq.reverse();return seq};
  let seq=run(!!opt.noSteps),forced=false;if(!seq&&opt.noSteps){seq=run(false);forced=!!seq}if(!seq)return null;
  const coords=[[a[0],a[1]]],segs=[];let tot=0,steps=false;const push=(gx,gy)=>{const c=[gLon(gx),gLat(gy)];const l=coords[coords.length-1];if(Math.abs(l[0]-c[0])>1e-7||Math.abs(l[1]-c[1])>1e-7)coords.push(c)};
  for(const [u,v,e] of seq){const inf=info[e[2]]||{};if(e[3])for(let i=0;i<e[3].length;i+=2)push(e[3][i],e[3][i+1]);push(XX(v),YY(v));tot+=e[1];steps=steps||!!inf.steps;
    // unnamed footpaths and crossings take the name of the street they run beside
    let nm=inf.name;if(!nm&&!inf.steps){const h=G.near((XX(u)+XX(v))/2,(YY(u)+YY(v))/2,30,s=>info[s[2]].name&&info[s[2]].kind!=="path");if(h)nm=info[h.s[2]].name}
    if(!nm)nm=inf.kind==="path"?(inf.steps?"steps":inf.detail==="cycleway"?"bike path":"path"):"";const last=segs[segs.length-1];
    if(last&&last.name===nm&&last.steps===!!inf.steps&&last.lift===!!inf.lift){last.m+=e[1];last.to=coords.length-1}else segs.push({m:e[1],name:nm,steps:!!inf.steps,lift:!!inf.lift,from:Math.max(0,coords.length-2),to:coords.length-1})}
  if(tot>straight*4+300)return null;   // the street data doesn't join up here; better to fall back to a straight-line estimate
  return {m:tot,coords,segs,steps,forced}}
window.walkRoute=walkRoute;

// ---- elevation along a walk. First choice: the Queensland Government's elevation service (QldDem: bare-earth
// LiDAR, 1 m across urban SEQ, with buildings and trees removed). If that can't be reached: Amazon's open terrain
// tiles (registry.opendata.aws/terrain-tiles), which in Australia are 30 m SRTM satellite heights that include
// buildings and trees. Those are fine for a rough climb, not for flagging steep stretches, so flags are left out then.
// QldDem is read as its cached elevation tiles (zoom 15, about 4 m a pixel here, in the same grid as the map), which
// come back in about a second; asking for points one by one takes 15 seconds or more. The tiles are LERC-compressed,
// decoded with Esri's open-source decoder (lib/lerc, Apache 2.0), loaded only when a walk's heights are needed.
const QLD="https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer/tile/15/",QZ=15,qCache=new Map();let lercP=null;
const libURL=f=>new URL("lib/lerc/"+f,location.href).href;
function lerc(){return lercP||(lercP=new Promise((res,rej)=>{const sc=document.createElement("script");sc.src=libURL("LercDecode.js");
  sc.onload=()=>window.Lerc.load({locateFile:()=>libURL("lerc-wasm.wasm")}).then(()=>res(window.Lerc),rej);sc.onerror=rej;document.head.appendChild(sc)}).catch(e=>{lercP=null;throw e}))}
function qldTile(x,y){const k=x+"/"+y;if(!qCache.has(k))qCache.set(k,(async()=>{const L=await lerc();const r=await fetch(QLD+y+"/"+x);if(!r.ok)throw new Error("QldDem "+r.status);
  const d=L.decode(await r.arrayBuffer());return {w:d.width,px:d.pixels[0],mask:d.mask||null}})().catch(err=>{qCache.delete(k);throw err}));return qCache.get(k)}
async function qldHeights(lls){const Pq=(1<<QZ)*256;
  const xy=lls.map(([lon,lat])=>[(lon+180)/360*Pq,(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Pq]);
  const need=new Set(xy.map(([x,y])=>Math.floor(x/256)+"/"+Math.floor(y/256)));const tiles=new Map();
  await Promise.all([...need].map(async k=>{const [x,y]=k.split("/").map(Number);tiles.set(k,await qldTile(x,y))}));
  // each tile is 257 x 257 heights on its corners and edges, so a point always has its four neighbours in one tile
  const v=xy.map(([x,y])=>{const tx=Math.floor(x/256),ty=Math.floor(y/256),T=tiles.get(tx+"/"+ty);const fx=x-tx*256,fy=y-ty*256,i=Math.floor(fx),j=Math.floor(fy),u=fx-i,w=fy-j;
    const at=(a,b)=>{const o=b*T.w+a;return T.mask&&!T.mask[o]?NaN:T.px[o]};const z=at(i,j)*(1-u)*(1-w)+at(i+1,j)*u*(1-w)+at(i,j+1)*(1-u)*w+at(i+1,j+1)*u*w;return z>-100&&z<2000?z:NaN});
  for(let k=0;k<v.length;k++)if(!isFinite(v[k])){let a=k-1,b=k+1;while(a>=0&&!isFinite(v[a]))a--;while(b<v.length&&!isFinite(v[b]))b++;v[k]=a>=0&&b<v.length?(v[a]+v[b])/2:a>=0?v[a]:b<v.length?v[b]:NaN}
  if(v.some(x=>!isFinite(x)))throw new Error("QldDem: no data here");return v}
// Amazon terrain tiles ("terrarium" PNGs) at zoom 14, about 8.6 m a pixel here
const ET="https://elevation-tiles-prod.s3.amazonaws.com/terrarium/14/",eCache=new Map();
function elevTile(x,y){const k=x+"/"+y;if(!eCache.has(k))eCache.set(k,(async()=>{const r=await fetch(ET+x+"/"+y+".png");if(!r.ok)throw new Error("terrain "+r.status);
  const bm=await createImageBitmap(await r.blob());const c=typeof OffscreenCanvas!=="undefined"?new OffscreenCanvas(256,256):Object.assign(document.createElement("canvas"),{width:256,height:256});
  const g=c.getContext("2d",{willReadFrequently:true});g.drawImage(bm,0,0);const d=g.getImageData(0,0,256,256).data;const e=new Float32Array(65536);
  for(let i=0;i<65536;i++)e[i]=d[i*4]*256+d[i*4+1]+d[i*4+2]/256-32768;return e})().catch(err=>{eCache.delete(k);throw err}));return eCache.get(k)}
const P=N*256;const pxOf=([lon,lat])=>[(lon+180)/360*P,(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*P];
const dM=(a,b)=>{const k=Math.cos((a[1]+b[1])/2*Math.PI/180);return Math.hypot((a[0]-b[0])*111320*k,(a[1]-b[1])*110574)};
// gradient bands (AS 1428.1 and the Disability Standards for Accessible Public Transport): walkway up to 1 in 20,
// ramp to 1 in 14, kerb ramp to 1 in 8, assisted access to 1 in 4
async function srtmHeights(lls){const px=lls.map(pxOf);const need=new Set();px.forEach(([x,y])=>{for(const dx of [0,1])for(const dy of [0,1])need.add(Math.floor((x-.5+dx)/256)+"/"+Math.floor((y-.5+dy)/256))});
  const tiles=new Map();await Promise.all([...need].map(async k=>{const [x,y]=k.split("/").map(Number);tiles.set(k,await elevTile(x,y))}));
  const pix=(gx,gy)=>tiles.get(Math.floor(gx/256)+"/"+Math.floor(gy/256))[(gy&255)*256+(gx&255)];
  return px.map(([x,y])=>{x-=.5;y-=.5;const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    return pix(x0,y0)*(1-fx)*(1-fy)+pix(x0+1,y0)*fx*(1-fy)+pix(x0,y0+1)*(1-fx)*fy+pix(x0+1,y0+1)*fx*fy})}
const RAMP=100/14,KERB=12.5,ASSIST=25;
async function walkProfile(route){if(!route||!route.coords||route.coords.length<2)return null;const C=route.coords;
  const cum=[0];for(let i=1;i<C.length;i++)cum.push(cum[i-1]+dM(C[i-1],C[i]));const L=cum[cum.length-1];if(L<1)return null;
  const STEP=5,n=Math.max(2,Math.round(L/STEP)+1),pts=[];let j=0;
  for(let i=0;i<n;i++){const s=L*i/(n-1);while(j<C.length-2&&cum[j+1]<s)j++;const t=cum[j+1]>cum[j]?(s-cum[j])/(cum[j+1]-cum[j]):0;pts.push({s,ll:[C[j][0]+(C[j+1][0]-C[j][0])*t,C[j][1]+(C[j+1][1]-C[j][1])*t]})}
  let e=null,rough=false;try{e=await qldHeights(pts.map(p=>p.ll))}catch(err){e=null}
  if(!e){rough=true;e=await srtmHeights(pts.map(p=>p.ll))}
  // bridges, tunnels and underpasses: the terrain shows the ground or water beneath, so join their two ends in a straight line
  for(const g of route.segs||[]){if(!g.lift)continue;const a=cum[g.from],b=cum[g.to];const ia=Math.max(0,Math.floor(a/L*(n-1))),ib=Math.min(n-1,Math.ceil(b/L*(n-1)));
    for(let i=ia+1;i<ib;i++)e[i]=e[ia]+(e[ib]-e[ia])*(i-ia)/(ib-ia)}
  // smooth over about 15 m either side, so kerbs, gutters and driveways don't read as slopes
  const W=3;e=e.map((_,i)=>{let s=0,c=0;for(let k=Math.max(0,i-W);k<=Math.min(n-1,i+W);k++){s+=e[k];c++}return s/c});
  let up=0,down=0;for(let i=1;i<n;i++){const d=e[i]-e[i-1];if(d>0)up+=d;else down-=d}
  const stepOf=s=>{for(const g of route.segs||[])if(g.steps&&s>=cum[g.from]-1&&s<=cum[g.to]+1)return g;return null};
  const nameAt=(a,b)=>{const w=new Map();for(const g of route.segs||[]){if(g.steps||!g.name||g.name==="path"||g.name==="bike path")continue;const o=Math.min(b,cum[g.to])-Math.max(a,cum[g.from]);if(o>0)w.set(g.name,(w.get(g.name)||0)+o)}
    let best="",bm=0;for(const [k,v] of w)if(v>bm){bm=v;best=k}return best};
  // gradient over a 30 m window at each point; flagged stretches are 30 m or longer, steps excluded
  const H=3;const gr=e.map((_,i)=>{const a=Math.max(0,i-H),b=Math.min(n-1,i+H);const run=pts[b].s-pts[a].s;return run>0?(e[b]-e[a])/run*100:0});
  const okWin=L>=30&&!rough;let maxG=0;if(okWin)for(let i=0;i<n;i++)if(!stepOf(pts[i].s))maxG=Math.max(maxG,Math.abs(gr[i]));
  // steep stretches: runs of points in the same band (over 1 in 14, or over 1 in 8) and the same direction. Each point's
  // gradient is already measured over 30 m. A piece shorter than 30 m joins the neighbouring piece it sits beside.
  const flags=[];
  if(!rough){const band=i=>stepOf(pts[i].s)?0:Math.abs(gr[i])>KERB?2:Math.abs(gr[i])>RAMP?1:0;const pcs=[];
    for(let i=0;i<n;){const b=band(i),sg=Math.sign(gr[i]);let k=i;while(k<n&&band(k)===b&&(b===0||Math.sign(gr[k])===sg))k++;pcs.push({b,sg,i,k});i=k}
    const ext=q=>{const a=q.i>0&&pcs.find(x=>x.k===q.i)&&pcs.find(x=>x.k===q.i).b?pts[q.i].s-STEP/2:pts[Math.max(0,q.i-H)].s;
      const nx=pcs.find(x=>x.i===q.k);const e=q.k<n&&nx&&nx.b?pts[q.k-1].s+STEP/2:pts[Math.min(n-1,q.k-1+H)].s;return [a,e]};
    // fold short steep pieces into a longer steep neighbour going the same way
    for(let changed=true;changed;){changed=false;for(let j=0;j<pcs.length;j++){const q=pcs[j];if(!q.b)continue;const [a,e]=ext(q);if(e-a>=30)continue;
      const L_=pcs[j-1],R_=pcs[j+1];const cand=[L_,R_].filter(x=>x&&x.b&&x.sg===q.sg);if(!cand.length)continue;
      const t=cand.sort((x,y)=>(ext(y)[1]-ext(y)[0])-(ext(x)[1]-ext(x)[0]))[0];t.i=Math.min(t.i,q.i);t.k=Math.max(t.k,q.k);pcs.splice(j,1);changed=true;break}}
    for(const q of pcs){if(!q.b)continue;const [a,e]=ext(q);if(e-a<30)continue;let peak=0;for(let i=q.i;i<q.k;i++)if(band(i)===q.b||q.b===2)peak=Math.max(peak,Math.abs(gr[i]));
      if(q.b===1)peak=Math.min(peak,KERB);flags.push({kind:q.b===2?"kerb":"ramp",pct:peak,len:e-a,at:a,end:e,dir:q.sg>0?"uphill":"downhill",street:nameAt(a,e)})}}
  for(const g of route.segs||[])if(g.steps)flags.push({kind:"steps",len:g.m,at:cum[g.from],end:cum[g.to],street:nameAt(cum[g.from]-40,cum[g.to]+40)});
  flags.sort((x,y)=>x.at-y.at);
  const label=rough?"":maxG<2?"Flat":maxG<=5?"Gentle":maxG<=RAMP?"Moderate":maxG<=KERB?"Steep":"Very steep";
  return {L,up,down,maxG,label,rough,flags,concern:flags.length>0,prof:pts.map((p,i)=>[p.s,e[i]]),forced:!!route.forced}}
window.walkProfile=walkProfile;
window.WALK_BANDS={RAMP,KERB,ASSIST};
window.walkTilesWarm=(a)=>{const g=toG(a);return tile(Math.floor(g[0]/EXT),Math.floor(g[1]/EXT))};
})();
