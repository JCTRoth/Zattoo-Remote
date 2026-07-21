/**
 * Zattoo Remote — Overlay injection script.
 *
 * Injected into Zattoo via Rust's webview.eval() after page load.
 * Exposes window.__zattooRemote.handleKeyEvent() which Rust calls
 * directly via eval() — no Tauri __TAURI__ required.
 * This makes it work reliably on remote URLs (zattoo.com).
 */
(function(){'use strict';if(window.__ZR)return;window.__ZR=true;

// ── Embedded config (mirrors src/key-config.json) ─────────────────
var CMap={"0":{name:"arte",search:"arte"},"1":{name:"Das Erste",search:"Das Erste"},
"2":{name:"ZDF",search:"ZDF"},"3":{name:"RTL",search:"RTL"},"4":{name:"Sat.1",search:"Sat.1"},
"5":{name:"ProSieben",search:"ProSieben"},"6":{name:"VOX",search:"VOX"},
"7":{name:"kabel eins",search:"kabel eins"},"8":{name:"RTL Zwei",search:"RTL Zwei"},
"9":{name:"3sat",search:"3sat"},"11":{name:"ZDFneo",search:"ZDFneo"},
"22":{name:"ZDFinfo",search:"ZDFinfo"},"33":{name:"sixx",search:"sixx"},
"44":{name:"DMAX",search:"DMAX"},"55":{name:"Tele 5",search:"Tele 5"},
"66":{name:"N24 Doku",search:"N24 Doku"},"77":{name:"Comedy Central",search:"Comedy Central"},
"88":{name:"Nitro",search:"Nitro"},"99":{name:"Super RTL",search:"Super RTL"}};
var Favs=[{name:"ZDF",channel:"ZDF",color:"red"},{name:"Das Erste",channel:"Das Erste",color:"green"},
{name:"RTL",channel:"RTL",color:"yellow"},{name:"ProSieben",channel:"ProSieben",color:"blue"}];
var Tmo=2000,VStep=5,chBuf="",chTim=null,vol=50,mouse=false,osdTim=null;

// ── OSD injection ────────────────────────────────────────────────
function injCSS(){if(document.getElementById("zrC"))return;
var s=document.createElement("style");s.id="zrC";
s.textContent=
"#zrO{position:fixed;top:32px;right:32px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}"+
"#zrL{padding:12px 24px;background:rgba(0,0,0,.75);color:#fff;border-radius:12px;font-size:20px;font-weight:600;backdrop-filter:blur(12px);opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}"+
"#zrL.s{opacity:1;transform:translateY(0)}"+
"#zrV{width:200px;height:8px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}"+
"#zrV.s{opacity:1;transform:translateY(0)}"+
"#zrVb{height:100%;background:#00a8e8;border-radius:4px}"+
"#zrF{padding:8px 20px;background:rgba(0,168,232,.3);color:#fff;border:1px solid rgba(0,168,232,.5);border-radius:12px;font-size:16px;font-weight:500;backdrop-filter:blur(12px);opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}"+
"#zrF.s{opacity:1;transform:translateY(0)}"+
"#zrCh{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:16px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:1;transition:opacity .3s}"+
"#zrCh.h{opacity:0}"+
"#zrD{padding:24px 48px;background:rgba(0,0,0,.85);color:#fff;border-radius:20px;font-size:96px;font-weight:700;letter-spacing:8px;backdrop-filter:blur(16px);min-width:160px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.5)}"+
"#zrP{width:200px;height:4px;background:#00a8e8;border-radius:2px;transition:width 2s linear}";
document.head.appendChild(s);}

function injHTML(){if(document.getElementById("zrR"))return;
var d=document.createElement("div");d.id="zrR";
d.innerHTML='<div id="zrO"><div id="zrL"></div><div id="zrV"><div id="zrVb" style="width:50%"></div></div><div id="zrF"></div></div><div id="zrCh" class="h"><div id="zrD"></div><div id="zrP"></div></div>';
document.body.appendChild(d);}

function osd(t){var e=document.getElementById("zrL");if(!e)return;
e.textContent=t;e.classList.add("s");if(osdTim)clearTimeout(osdTim);osdTim=setTimeout(function(){e.classList.remove("s")},1500);}

function osdV(l){var b=document.getElementById("zrVb"),v=document.getElementById("zrV"),lbl=document.getElementById("zrL");
if(!b||!v)return;b.style.width=l+"%";v.classList.add("s");if(lbl){lbl.textContent="\uD83D\uDD0A "+l+"%";lbl.classList.add("s");}
if(osdTim)clearTimeout(osdTim);osdTim=setTimeout(function(){v.classList.remove("s");if(lbl)lbl.classList.remove("s")},1500);}

function osdF(n){var e=document.getElementById("zrF");if(!e)return;
e.textContent="\u2B50 "+n;e.classList.add("s");if(osdTim)clearTimeout(osdTim);osdTim=setTimeout(function(){e.classList.remove("s")},1500);}

function showCh(d){var o=document.getElementById("zrCh"),dig=document.getElementById("zrD"),p=document.getElementById("zrP");
if(!o||!dig||!p)return;o.classList.remove("h");dig.textContent=d;
p.style.transition="none";p.style.width="100%";void p.offsetWidth;p.style.transition="width "+Tmo+"ms linear";p.style.width="0%";}

function hideCh(){var e=document.getElementById("zrCh");if(e)e.classList.add("h");}

// ── Zattoo DOM actions ───────────────────────────────────────────
function za(act,param){
switch(act){
case"send_key":if(!param)break;document.body.dispatchEvent(new KeyboardEvent("keydown",{key:param,bubbles:true}));document.body.dispatchEvent(new KeyboardEvent("keyup",{key:param,bubbles:true}));break;
case"change_channel":if(!param)break;
var m=CMap[param],st=m?m.search:param,cn=m?m.name:param;console.log("[ZR] Ch->",cn);
var ii=document.querySelectorAll('input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i],input[type="text"]');
var d=false;
for(var i=0;i<ii.length;i++){var inp=ii[i],r=inp.getBoundingClientRect();if(r.width>50&&r.height>20){
inp.focus();inp.value=st;inp.dispatchEvent(new Event("input",{bubbles:true}));inp.dispatchEvent(new Event("change",{bubbles:true}));
(function(x){setTimeout(function(){x.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));x.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}))},500)})(inp);
d=true;break;}}
if(!d){var ce=document.querySelectorAll('[data-testid*="channel" i],[class*="channel" i],[class*="sender" i]');
for(var j=0;j<ce.length;j++){if((ce[j].textContent||"").toLowerCase().indexOf(cn.toLowerCase())>=0){ce[j].click();d=true;break;}}}
if(!d){var al=document.querySelectorAll("a,button,[role=button]");for(var k=0;k<al.length;k++){var t=(al[k].textContent||"").trim();if(t&&t.toLowerCase()===cn.toLowerCase()){al[k].click();break;}}}
break;
case"toggle_play_pause":var bs=document.querySelectorAll('[data-testid*="play" i],[data-testid*="pause" i],[aria-label*="play" i],[aria-label*="pause" i],button[title*="Play" i],button[title*="Pause" i],.vjs-play-control,.play-button');var c=false;
for(var i=0;i<bs.length;i++){if(bs[i].offsetParent!==null){bs[i].click();c=true;break;}}
if(!c){var v=document.querySelector("video");if(v){v.paused?v.play():v.pause();}}break;
case"seek":var s=parseInt(param||"0",10);var v=document.querySelector("video");if(v&&!isNaN(s)){v.currentTime=Math.max(0,Math.min(v.duration||Infinity,v.currentTime+s));}break;
case"open_epg":var sl=[['data-testid="epg-button"]','[data-testid="guide-button"]','a[href*="epg"]','a[href*="guide"]','[aria-label*="guide" i]','[aria-label*="EPG" i]'];var d=false;
for(var i=0;i<sl.length;i++){var el=document.querySelector(sl[i]);if(el){el.click();d=true;break;}}
if(!d){var al=document.querySelectorAll("a,button,[role=button]");for(var i=0;i<al.length;i++){if(/guide|epg|programm/i.test(al[i].textContent||"")){al[i].click();break;}}}break;
case"focus_search":var inp=document.querySelector('input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i]');
if(inp)inp.focus();else document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"/",code:"Slash",bubbles:true}));break;
case"press_escape":document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));document.body.dispatchEvent(new KeyboardEvent("keyup",{key:"Escape",code:"Escape",bubbles:true}));break;
case"navigate":if(param)window.location.href=window.location.origin+param;break;
}}

// ── Key handler (called from Rust via eval) ──────────────────────
function hke(j){try{var e=JSON.parse(j);if(!e.is_press)return;
var a=e.action,l=e.label||"";osd(l);
if(a.indexOf("digit_")===0){var d=a.charAt(a.length-1);chBuf+=d;showCh(chBuf);
if(chTim)clearTimeout(chTim);chTim=setTimeout(function(){if(chBuf){za("change_channel",chBuf);chBuf="";hideCh()}},Tmo);return;}
if(a.indexOf("color_")===0){var c=a.substring(6);for(var i=0;i<Favs.length;i++){if(Favs[i].color===c){osdF(Favs[i].name);za("change_channel",Favs[i].channel);break;}}return;}
switch(a){
case"up":za("send_key","ArrowUp");break;case"down":za("send_key","ArrowDown");break;
case"left":za("send_key","ArrowLeft");break;case"right":za("send_key","ArrowRight");break;
case"ok":za("send_key","Enter");break;case"back":za("press_escape");break;
case"play_pause":za("toggle_play_pause");break;case"rewind":za("seek","-15");break;
case"fast_forward":za("seek","15");break;case"channel_up":za("send_key","PageUp");break;
case"channel_down":za("send_key","PageDown");break;case"home":za("navigate","/live");break;
case"menu":za("open_epg");break;case"search":za("focus_search");break;
case"stop":za("press_escape");break;case"record":osd("Record");break;
case"mouse_mode":mouse=!mouse;osd(mouse?"Mouse ON":"Mouse OFF");break;
}}catch(e){console.error("[ZR] err:",e);}}

// ── SPA navigation observer ──────────────────────────────────────
function obs(){var o=new MutationObserver(function(){if(!document.getElementById("zrR")){injHTML();injCSS()}});
if(document.body)o.observe(document.body,{childList:true,subtree:true});
else document.addEventListener("DOMContentLoaded",function(){o.observe(document.body,{childList:true,subtree:true})});}

// ── Init ─────────────────────────────────────────────────────────
function init(){console.log("[ZR] Init...");
if(document.body&&document.head){injCSS();injHTML();obs();
window.__zattooRemote={handleKeyEvent:hke,version:"1.0"};
console.log("[ZR] Ready");}else{setTimeout(init,500);}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
