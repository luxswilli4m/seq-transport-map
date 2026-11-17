// Minimal GTFS-Realtime (protobuf) decoder for the fields the map uses.
(function(){
"use strict";
function Reader(buf){this.b=buf;this.p=0;this.n=buf.length}
Reader.prototype.varint=function(){let lo=0,hi=0,s=0,b;do{b=this.b[this.p++];if(s<28)lo|=(b&0x7f)<<s;else if(s===28){lo|=(b&0x0f)<<28;hi|=(b&0x7f)>>4}else hi|=(b&0x7f)<<(s-32);s+=7}while(b&0x80);return [lo>>>0,hi>>>0]};
Reader.prototype.uint=function(){const [lo,hi]=this.varint();return hi*4294967296+lo};
Reader.prototype.int32=function(){return this.varint()[0]|0};
Reader.prototype.bytes=function(){const l=this.uint();const s=this.p;this.p+=l;return this.b.subarray(s,this.p)};
Reader.prototype.float=function(){const v=new DataView(this.b.buffer,this.b.byteOffset+this.p,4).getFloat32(0,true);this.p+=4;return v};
Reader.prototype.skip=function(wt){if(wt===0)this.varint();else if(wt===1)this.p+=8;else if(wt===2){const l=this.uint();this.p+=l}else if(wt===5)this.p+=4;else throw new Error("wire type "+wt)};
const td=new TextDecoder();
function msg(buf,h){const r=new Reader(buf),o={};while(r.p<r.n){const t=r.uint(),f=Math.floor(t/8),wt=t&7;const fn=h[f];if(fn)fn(r,o,wt);else r.skip(wt)}return o}
const str=r=>td.decode(r.bytes());
const TripDesc={1:(r,o)=>o.trip=str(r),5:(r,o)=>o.route=str(r),6:(r,o)=>o.dir=r.uint(),4:(r,o)=>o.sr=r.uint()};
const StopTimeEvent={1:(r,o)=>o.delay=r.int32(),2:(r,o)=>o.time=r.uint()};
const STU={1:(r,o)=>o.seq=r.uint(),4:(r,o)=>o.stop=str(r),2:(r,o)=>o.arr=msg(r.bytes(),StopTimeEvent),3:(r,o)=>o.dep=msg(r.bytes(),StopTimeEvent),5:(r,o)=>o.sr=r.uint()};
const TripUpdate={1:(r,o)=>o.trip=msg(r.bytes(),TripDesc),2:(r,o)=>(o.stu=o.stu||[]).push(msg(r.bytes(),STU)),5:(r,o)=>o.delay=r.int32()};
const Pos={1:(r,o)=>o.lat=r.float(),2:(r,o)=>o.lon=r.float(),3:(r,o)=>o.bearing=r.float()};
const VehDesc={1:(r,o)=>o.id=str(r),2:(r,o)=>o.label=str(r)};
const VehiclePosition={1:(r,o)=>o.trip=msg(r.bytes(),TripDesc),8:(r,o)=>o.veh=msg(r.bytes(),VehDesc),2:(r,o)=>o.pos=msg(r.bytes(),Pos),5:(r,o)=>o.ts=r.uint(),7:(r,o)=>o.stop=str(r)};
const Translation={1:(r,o)=>o.text=str(r),2:(r,o)=>o.lang=str(r)};
const TStr={1:(r,o)=>{const t=msg(r.bytes(),Translation);if(!o.text||t.lang==="en")o.text=t.text}};
const TimeRange={1:(r,o)=>o.start=r.uint(),2:(r,o)=>o.end=r.uint()};
const Sel={2:(r,o)=>o.route=str(r),5:(r,o)=>o.stop=str(r),4:(r,o)=>o.trip=msg(r.bytes(),TripDesc)};
const Alert={1:(r,o)=>(o.periods=o.periods||[]).push(msg(r.bytes(),TimeRange)),5:(r,o)=>(o.sel=o.sel||[]).push(msg(r.bytes(),Sel)),6:(r,o)=>o.cause=r.uint(),7:(r,o)=>o.effect=r.uint(),
  8:(r,o)=>o.url=msg(r.bytes(),TStr).text,10:(r,o)=>o.header=msg(r.bytes(),TStr).text,11:(r,o)=>o.desc=msg(r.bytes(),TStr).text};
const Entity={1:(r,o)=>o.id=str(r),2:(r,o)=>o.del=r.uint(),3:(r,o)=>o.tu=msg(r.bytes(),TripUpdate),4:(r,o)=>o.vp=msg(r.bytes(),VehiclePosition),5:(r,o)=>o.al=msg(r.bytes(),Alert)};
const Header={3:(r,o)=>o.ts=r.uint()};
const Feed={1:(r,o)=>o.header=msg(r.bytes(),Header),2:(r,o)=>o.entity.push(msg(r.bytes(),Entity))};
window.decodeGTFSRT=function(buf){const o={entity:[]};const r=new Reader(new Uint8Array(buf));while(r.p<r.n){const t=r.uint(),f=Math.floor(t/8),wt=t&7;if(Feed[f])Feed[f](r,o,wt);else r.skip(wt)}return o};
})();
