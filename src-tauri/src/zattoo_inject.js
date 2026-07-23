/**
 * Zattoo Remote — Overlay injection script v2.
 *
 * Injected into Zattoo via Rust's webview.eval() after page load.
 * Exposes window.__zattooRemote.handleKeyEvent() which Rust calls
 * directly via eval() — no Tauri __TAURI__ required.
 *
 * Features:
 * - URL-based channel navigation using verified Zattoo deep-links
 * - Region prefix support (de/at/ch)
 * - White-label domain support
 * - DOM-based fallback for when URL nav is not possible
 * - SPA navigation resilience via MutationObserver + URL change detection
 * - OSD for channel numbers, volume, and favorites
 */
(function(){'use strict';if(window.__ZR)return;window.__ZR=true;

// ── Embedded config (mirrors src/key-config.json v1.1) ───────────
var BASE='https://zattoo.com',REG='de';
var CMap={"0":{name:"arte",search:"arte",slug:"arte"},
"1":{name:"Das Erste",search:"Das Erste",slug:"daserste"},
"2":{name:"ZDF",search:"ZDF",slug:"zdf"},
"3":{name:"RTL",search:"RTL",slug:"rtl_deutschland"},
"4":{name:"Sat.1",search:"Sat.1",slug:"sat1_deutschland"},
"5":{name:"ProSieben",search:"ProSieben",slug:"pro7_deutschland"},
"6":{name:"VOX",search:"VOX",slug:"vox_deutschland"},
"7":{name:"kabel eins",search:"kabel eins",slug:"kabel1_deutschland"},
"8":{name:"RTL Zwei",search:"RTL Zwei",slug:"rtl2_deutschland"},
"9":{name:"3sat",search:"3sat",slug:"3sat"},
"11":{name:"ZDFneo",search:"ZDFneo",slug:"zdfneo"},
"22":{name:"ZDFinfo",search:"ZDFinfo",slug:"zdfinfo"},
"33":{name:"sixx",search:"sixx",slug:"sixx_deutschland"},
"44":{name:"DMAX",search:"DMAX",slug:"dmax_deutschland"},
"55":{name:"Tele 5",search:"Tele 5",slug:"tele5_deutschland"},
"66":{name:"N24 Doku",search:"N24 Doku",slug:"welt_deutschland"},
"77":{name:"Comedy Central",search:"Comedy Central",slug:"comedycentral_deutschland"},
"88":{name:"Nitro",search:"Nitro",slug:"nitro_deutschland"},
"99":{name:"Super RTL",search:"Super RTL",slug:"superrtl_deutschland"}};
var Favs=[{name:"ZDF",channel:"ZDF",slug:"zdf",color:"red"},
{name:"Das Erste",channel:"Das Erste",slug:"daserste",color:"green"},
{name:"RTL",channel:"RTL",slug:"rtl_deutschland",color:"yellow"},
{name:"ProSieben",channel:"ProSieben",slug:"pro7_deutschland",color:"blue"}];
var Tmo=2000,VStep=5,chBuf="",chTim=null,vol=50,mouse=false,osdTim=null,lastUrl='';

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

// ── Build URL for channel slug ───────────────────────────────────
// Zattoo uses /channels?channel=<slug> format (not /<region>/live/<slug>)
function chUrl(slug){return BASE+'/channels?channel='+slug;}

// ── Zattoo DOM actions ───────────────────────────────────────────
function za(act,param){
switch(act){
case"send_key":if(!param)break;document.body.dispatchEvent(new KeyboardEvent("keydown",{key:param,bubbles:true}));document.body.dispatchEvent(new KeyboardEvent("keyup",{key:param,bubbles:true}));break;

case"change_channel":if(!param)break;
var m=CMap[param],slug=m?m.slug:null,st=m?m.search:param,cn=m?m.name:param;console.log("[ZR] Ch->",cn);
// Quick URL navigation is the most reliable method and works everywhere
// (even in Zattoo's fullscreen player mode). The 10s Rust watchdog
// automatically re-injects the overlay after page load.
if(slug){var url=chUrl(slug);if(window.location.href!==url){console.log("[ZR] Nav:",url);window.location.href=url;return;}}
// Only if no slug configured, try DOM search as fallback
var sb=document.querySelector('#search_input,[data-soul="SEARCH_CONTROL"]');
if(sb&&window.getComputedStyle(sb).display!=='none'&&sb.offsetParent!==null){console.log("[ZR] Opening search dialog...");sb.click();
setTimeout(function(){
var ii=document.querySelectorAll('input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i],input[type="text"]:not([readonly]):not([disabled])');
for(var i=0;i<ii.length;i++){var inp=ii[i],r=inp.getBoundingClientRect();if(r.width>50&&r.height>20){
inp.focus();inp.value=st;inp.dispatchEvent(new Event("input",{bubbles:true}));inp.dispatchEvent(new Event("change",{bubbles:true}));
(function(x){setTimeout(function(){x.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));x.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}))},300)})(inp);
break;}}},400);}else{console.log("[ZR] No slug configured for channel:",param);}
break;

case"toggle_play_pause":var bs=document.querySelectorAll('[data-testid*="play" i],[data-testid*="pause" i],[aria-label*="play" i],[aria-label*="pause" i],button[title*="Play" i],button[title*="Pause" i],.vjs-play-control,.play-button');var c=false;
for(var i=0;i<bs.length;i++){if(bs[i].offsetParent!==null){bs[i].click();c=true;break;}}
if(!c){var v=document.querySelector("video");if(v){v.paused?v.play():v.pause();}}break;

case"seek":var s=parseInt(param||"0",10);var v=document.querySelector("video");if(v&&!isNaN(s)){v.currentTime=Math.max(0,Math.min(v.duration||Infinity,v.currentTime+s));}break;

case"open_epg":var sel=['[data-testid="epg-button"]','[data-testid="guide-button"]','a[href*="epg"]','a[href*="guide"]','[aria-label*="guide" i]','[aria-label*="EPG" i]'];var dn=false;
for(var i=0;i<sel.length;i++){var el=document.querySelector(sel[i]);if(el){el.click();dn=true;break;}}
if(!dn){var al=document.querySelectorAll("a,button,[role=button]");for(var i=0;i<al.length;i++){if(/guide|epg|programm/i.test(al[i].textContent||"")){al[i].click();break;}}}break;

case"focus_search":var inp=document.querySelector('input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i]');
if(inp)inp.focus();else document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"/",code:"Slash",bubbles:true}));break;

case"press_escape":document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));document.body.dispatchEvent(new KeyboardEvent("keyup",{key:"Escape",code:"Escape",bubbles:true}));break;

case"navigate":if(param){window.location.href=window.location.origin+param;}break;

case"navigate_guide":window.location.href=BASE+'/guide';break;

case"navigate_settings":
try{var st=document.querySelector('[data-testid*="setting" i],[aria-label*="setting" i],a[href*="setting" i],button[title*="Setting" i]');
if(st){st.click();}else{var al=document.querySelectorAll("a,button,[role=button]");for(var i=0;i<al.length;i++){if(/einstellungen|settings/i.test(al[i].textContent||"")){al[i].click();break;}}}
}catch(e){}break;

case"navigate_account":
try{var ac=document.querySelector('[data-testid*="account" i],[aria-label*="account" i],a[href*="account" i]');
if(ac){ac.click();}else{var al=document.querySelectorAll("a,button,[role=button]");for(var i=0;i<al.length;i++){if(/account|konto|profil/i.test(al[i].textContent||"")){al[i].click();break;}}}
}catch(e){}break;

case"navigate_recordings":window.location.href=BASE+'/recordings';break;
}}

// ── Key handler (called from Rust via eval) ──────────────────────
function hke(j){try{var e=JSON.parse(j);
console.log("[ZR] Key event:",e.action,e.is_press?"↓":"↑",e.label||"",e.scan_code||0);
if(!e.is_press)return;
var a=e.action,l=e.label||"";osd(l);
if(a.indexOf("digit_")===0){var d=a.charAt(a.length-1);chBuf+=d;showCh(chBuf);
if(chTim)clearTimeout(chTim);chTim=setTimeout(function(){if(chBuf){za("change_channel",chBuf);chBuf="";hideCh()}},Tmo);return;}
if(a.indexOf("color_")===0){var c=a.substring(6);for(var i=0;i<Favs.length;i++){if(Favs[i].color===c){osdF(Favs[i].name);za("change_channel",Favs[i].slug||Favs[i].channel);break;}}return;}
switch(a){
case"up":za("send_key","ArrowUp");break;case"down":za("send_key","ArrowDown");break;
case"left":za("send_key","ArrowLeft");break;case"right":za("send_key","ArrowRight");break;
case"ok":za("send_key","Enter");break;case"back":za("press_escape");break;
case"play_pause":za("toggle_play_pause");break;case"rewind":za("seek","-15");break;
case"fast_forward":za("seek","15");break;case"channel_up":za("send_key","PageUp");break;
case"channel_down":za("send_key","PageDown");break;case"home":za("navigate","/live");break;
case"menu":za("open_epg");break;case"search":za("focus_search");break;
case"guide":za("navigate_guide");break;
case"settings":za("navigate_settings");break;
case"account":za("navigate_account");break;
case"recordings":za("navigate_recordings");break;
case"stop":za("press_escape");break;case"record":osd("Record");break;
case"mouse_mode":mouse=!mouse;osd(mouse?"Mouse ON":"Mouse OFF");break;
}}catch(e){console.error("[ZR] err:",e);}}

// ── Navigation detection ─────────────────────────────────────────
// Detect SPA URL changes and re-establish overlay if needed
function watchNav(){lastUrl=window.location.href;
setInterval(function(){if(window.location.href!==lastUrl){lastUrl=window.location.href;
console.log("[ZR] URL changed to:",lastUrl);
// Re-inject overlay HTML/CSS (the handler survives SPA nav)
if(!document.getElementById("zrR")){injHTML();injCSS();}
// Ensure handler is still exposed
if(!window.__zattooRemote||!window.__zattooRemote.handleKeyEvent){
window.__zattooRemote={handleKeyEvent:hke,version:"1.0"};}}},1000);}

// ── Toast / popup auto-dismisser ──────────────────────────────────
// Zattoo shows toasts ("Verringerte Videoqualität", etc.) that block key input.
// Finds them by text content and dismisses them.
function dismissToasts(){
if(window._zrToastTimer)return;window._zrToastTimer=1; // prevent duplicate timers on SPA nav
var kw='verringerte,videoqualität,kopierschutz,copy protection,reduced quality,sd qualit';
function tryClose(el){
if(!el||el._zrDismissed||el.nodeType!==1)return;el._zrDismissed=true;
console.log("[ZR] Auto-dismiss:",(el.textContent||'').slice(0,80).trim());
// Click any close button inside or the element itself
var btns=el.querySelectorAll('button, [role="button"], svg, a');
for(var i=0;i<btns.length;i++){btns[i].click();return;}
try{var p=el.parentNode;if(p)p.removeChild(el);}catch(e){}
}
function scan(){
var kws=kw.split(',');
// Only scan fixed/sticky positioned containers and recent additions (not whole DOM)
document.querySelectorAll('[role="alert"],[role="dialog"],[class*="banner" i],[class*="snackbar" i],[class*="toast" i],[class*="notification" i],[class*="overlay" i],[class*="popup" i],[style*="fixed"],[style*="sticky"]').forEach(function(el){
if(el._zrDismissed)return;
var t=(el.textContent||'').toLowerCase();if(t.length<10||t.length>400)return;
for(var i=0;i<kws.length;i++){if(t.indexOf(kws[i])>=0){tryClose(el);return;}}
});
// Also check any element whose parent was just added (catch React-rendered toasts)
var all=document.querySelectorAll('[class*="message" i],[data-soul*="MESSAGE" i],[data-soul*="NOTIFICATION" i],[data-soul*="TOAST" i]');
for(var i=0;i<all.length;i++){var t=(all[i].textContent||'').toLowerCase();if(t.length<10||t.length>400)continue;
for(var j=0;j<kws.length;j++){if(t.indexOf(kws[j])>=0){tryClose(all[i]);break;}}}
}
scan();setInterval(scan,1500); // check every 1.5s
}

// ── SPA navigation observer ──────────────────────────────────────
function obs(){try{if(!document||!document.body)return;
var o=new MutationObserver(function(){try{if(document&&!document.getElementById("zrR")){injHTML();injCSS()}}catch(e){}});
o.observe(document.body,{childList:true,subtree:true});}catch(e){}
if(!document.body)document.addEventListener("DOMContentLoaded",function(){try{obs();}catch(e){}});}

// ── Init ─────────────────────────────────────────────────────────
function init(){try{console.log("[ZR] Init...");
if(document&&document.body&&document.head){injCSS();injHTML();obs();watchNav();dismissToasts();
window.__zattooRemote={handleKeyEvent:hke,version:"2.0"};
console.log("[ZR] Ready");}else{setTimeout(init,500);}}catch(e){console.error("[ZR] Init error:",e);setTimeout(init,500);}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
