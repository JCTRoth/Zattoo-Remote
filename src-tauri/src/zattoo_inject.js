/**
 * Zattoo Remote — Overlay injection script v3.
 *
 * Injected into Zattoo via Rust's webview.eval() after page load.
 * Exposes window.__zattooRemote.handleKeyEvent() which Rust calls
 * directly via eval() — no Tauri __TAURI__ required (though __TAURI__
 * is available since withGlobalTauri: true is set).
 *
 * Features:
 * - URL-based channel navigation using verified Zattoo deep-links
 * - Region prefix support (de/at/ch)
 * - White-label domain support
 * - DOM-based fallback for when URL nav is not possible
 * - SPA navigation resilience via MutationObserver + URL change detection
 * - OSD for channel numbers, volume, and favorites
 * - DRM (EME) capability probing
 * - Toast/popup auto-dismissal
 */
(function () {
  "use strict";
  if (window.__ZR) return;
  window.__ZR = true;

  // ── Suppress noise from Zattoo's own scripts ──────────────────
  // Zattoo's Bitmovin player adapter throws unhandled promise rejections
  // (e.g. "TypeError: undefined is not an object (evaluating 'i.parse')").
  // These are Zattoo bugs we can't fix, but we can prevent them from
  // flooding the console and interfering with our error monitoring.
  window.addEventListener("unhandledrejection", function (e) {
    var msg =
      (e && e.reason && e.reason.message) ||
      (e && e.reason && String(e.reason)) ||
      "";
    if (
      msg.indexOf("i.parse") >= 0 ||
      msg.indexOf("bitmovin") >= 0 ||
      msg.indexOf("player") >= 0
    ) {
      e.preventDefault();
    }
  });

  // ── Embedded config (mirrors src/key-config.json v1.1) ─────────
  var BASE_URL = "https://zattoo.com";
  var REGION = "de";

  var channelMap = {
    "0": { name: "arte", search: "arte", slug: "arte" },
    "1": { name: "Das Erste", search: "Das Erste", slug: "daserste" },
    "2": { name: "ZDF", search: "ZDF", slug: "zdf" },
    "3": { name: "RTL", search: "RTL", slug: "rtl_deutschland" },
    "4": { name: "Sat.1", search: "Sat.1", slug: "sat1_deutschland" },
    "5": { name: "ProSieben", search: "ProSieben", slug: "pro7_deutschland" },
    "6": { name: "VOX", search: "VOX", slug: "vox_deutschland" },
    "7": { name: "kabel eins", search: "kabel eins", slug: "kabel1_deutschland" },
    "8": { name: "RTL Zwei", search: "RTL Zwei", slug: "rtl2_deutschland" },
    "9": { name: "3sat", search: "3sat", slug: "3sat" },
    "11": { name: "ZDFneo", search: "ZDFneo", slug: "zdfneo" },
    "22": { name: "ZDFinfo", search: "ZDFinfo", slug: "zdfinfo" },
    "33": { name: "sixx", search: "sixx", slug: "sixx_deutschland" },
    "44": { name: "DMAX", search: "DMAX", slug: "dmax_deutschland" },
    "55": { name: "Tele 5", search: "Tele 5", slug: "tele5_deutschland" },
    "66": { name: "N24 Doku", search: "N24 Doku", slug: "welt_deutschland" },
    "77": { name: "Comedy Central", search: "Comedy Central", slug: "comedycentral_deutschland" },
    "88": { name: "Nitro", search: "Nitro", slug: "nitro_deutschland" },
    "99": { name: "Super RTL", search: "Super RTL", slug: "superrtl_deutschland" },
  };

  var favorites = [
    { name: "ZDF", channel: "ZDF", slug: "zdf", color: "red" },
    { name: "Das Erste", channel: "Das Erste", slug: "daserste", color: "green" },
    { name: "RTL", channel: "RTL", slug: "rtl_deutschland", color: "yellow" },
    { name: "ProSieben", channel: "ProSieben", slug: "pro7_deutschland", color: "blue" },
  ];

  var CHANNEL_TIMEOUT = 2000;
  var VOLUME_STEP = 5;
  var channelBuffer = "";
  var channelTimer = null;
  var osdTimer = null;
  var lastUrl = "";

  // ── OSD injection ──────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("zrC")) return;
    var s = document.createElement("style");
    s.id = "zrC";
    s.textContent =
      "#zrO{position:fixed;top:32px;right:32px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
      "#zrL{padding:12px 24px;background:rgba(0,0,0,.75);color:#fff;border-radius:12px;font-size:20px;font-weight:600;backdrop-filter:blur(12px);opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}" +
      "#zrL.s{opacity:1;transform:translateY(0)}" +
      "#zrV{width:200px;height:8px;background:rgba(255,255,255,.2);border-radius:4px;overflow:hidden;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}" +
      "#zrV.s{opacity:1;transform:translateY(0)}" +
      "#zrVb{height:100%;background:#00a8e8;border-radius:4px}" +
      "#zrF{padding:8px 20px;background:rgba(0,168,232,.3);color:#fff;border:1px solid rgba(0,168,232,.5);border-radius:12px;font-size:16px;font-weight:500;backdrop-filter:blur(12px);opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s}" +
      "#zrF.s{opacity:1;transform:translateY(0)}" +
      "#zrCh{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:16px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:1;transition:opacity .3s}" +
      "#zrCh.h{opacity:0}" +
      "#zrD{padding:24px 48px;background:rgba(0,0,0,.85);color:#fff;border-radius:20px;font-size:96px;font-weight:700;letter-spacing:8px;backdrop-filter:blur(16px);min-width:160px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.5)}" +
      "#zrP{width:200px;height:4px;background:#00a8e8;border-radius:2px;transition:width 2s linear}";
    document.head.appendChild(s);
  }

  function injectHtml() {
    if (document.getElementById("zrR")) return;
    var d = document.createElement("div");
    d.id = "zrR";
    d.innerHTML =
      '<div id="zrO"><div id="zrL"></div><div id="zrV"><div id="zrVb" style="width:50%"></div></div><div id="zrF"></div></div><div id="zrCh" class="h"><div id="zrD"></div><div id="zrP"></div></div>';
    document.body.appendChild(d);
  }

  // ── OSD display helpers ────────────────────────────────────────
  function showOsd(text) {
    var el = document.getElementById("zrL");
    if (!el) return;
    el.textContent = text;
    el.classList.add("s");
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      el.classList.remove("s");
    }, 1500);
  }

  function showOsdVolume(level) {
    var bar = document.getElementById("zrVb");
    var volEl = document.getElementById("zrV");
    var label = document.getElementById("zrL");
    if (!bar || !volEl) return;
    bar.style.width = level + "%";
    volEl.classList.add("s");
    if (label) {
      label.textContent = "\uD83D\uDD0A " + level + "%";
      label.classList.add("s");
    }
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      volEl.classList.remove("s");
      if (label) label.classList.remove("s");
    }, 1500);
  }

  function showOsdFavorite(name) {
    var el = document.getElementById("zrF");
    if (!el) return;
    el.textContent = "\u2B50 " + name;
    el.classList.add("s");
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      el.classList.remove("s");
    }, 1500);
  }

  function showChannelInput(digits) {
    var overlay = document.getElementById("zrCh");
    var digitsEl = document.getElementById("zrD");
    var progress = document.getElementById("zrP");
    if (!overlay || !digitsEl || !progress) return;
    overlay.classList.remove("h");
    digitsEl.textContent = digits;
    progress.style.transition = "none";
    progress.style.width = "100%";
    void progress.offsetWidth;
    progress.style.transition = "width " + CHANNEL_TIMEOUT + "ms linear";
    progress.style.width = "0%";
  }

  function hideChannelInput() {
    var el = document.getElementById("zrCh");
    if (el) el.classList.add("h");
  }

  // ── Build URL for channel slug ─────────────────────────────────
  function channelUrl(slug) {
    return BASE_URL + "/channels?channel=" + slug;
  }

  // ── Zattoo DOM actions ─────────────────────────────────────────
  function zattooAction(action, param) {
    switch (action) {
      case "send_key":
        if (!param) break;
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: param, bubbles: true })
        );
        document.body.dispatchEvent(
          new KeyboardEvent("keyup", { key: param, bubbles: true })
        );
        break;

      case "change_channel":
        if (!param) break;
        var entry = channelMap[param];
        var slug = entry ? entry.slug : null;
        var searchTerm = entry ? entry.search : param;
        var channelName = entry ? entry.name : param;
        console.log("[ZR] Ch->", channelName);

        // URL navigation is the most reliable method
        if (slug) {
          var url = channelUrl(slug);
          if (window.location.href !== url) {
            console.log("[ZR] Nav:", url);
            window.location.href = url;
            return;
          }
        }

        // Fallback: DOM search dialog
        var searchBtn = document.querySelector(
          '#search_input,[data-soul="SEARCH_CONTROL"]'
        );
        if (
          searchBtn &&
          window.getComputedStyle(searchBtn).display !== "none" &&
          searchBtn.offsetParent !== null
        ) {
          console.log("[ZR] Opening search dialog...");
          searchBtn.click();
          setTimeout(function () {
            var inputs = document.querySelectorAll(
              'input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i],input[type="text"]:not([readonly]):not([disabled])'
            );
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              var rect = inp.getBoundingClientRect();
              if (rect.width > 50 && rect.height > 20) {
                inp.focus();
                inp.value = searchTerm;
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
                (function (el) {
                  setTimeout(function () {
                    el.dispatchEvent(
                      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
                    );
                    el.dispatchEvent(
                      new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true })
                    );
                  }, 300);
                })(inp);
                break;
              }
            }
          }, 400);
        } else {
          console.log("[ZR] No slug configured for channel:", param);
        }
        break;

      case "toggle_play_pause":
        var buttons = document.querySelectorAll(
          '[data-testid*="play" i],[data-testid*="pause" i],[aria-label*="play" i],[aria-label*="pause" i],button[title*="Play" i],button[title*="Pause" i],.vjs-play-control,.play-button'
        );
        var clicked = false;
        for (var i = 0; i < buttons.length; i++) {
          if (buttons[i].offsetParent !== null) {
            buttons[i].click();
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          var video = document.querySelector("video");
          if (video) {
            video.paused ? video.play() : video.pause();
          }
        }
        break;

      case "seek":
        var seconds = parseInt(param || "0", 10);
        var video = document.querySelector("video");
        if (video && !isNaN(seconds)) {
          video.currentTime = Math.max(
            0,
            Math.min(video.duration || Infinity, video.currentTime + seconds)
          );
        }
        break;

      case "open_epg":
        var selectors = [
          '[data-testid="epg-button"]',
          '[data-testid="guide-button"]',
          'a[href*="epg"]',
          'a[href*="guide"]',
          '[aria-label*="guide" i]',
          '[aria-label*="EPG" i]',
        ];
        var done = false;
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            el.click();
            done = true;
            break;
          }
        }
        if (!done) {
          var all = document.querySelectorAll("a,button,[role=button]");
          for (var i = 0; i < all.length; i++) {
            if (/guide|epg|programm/i.test(all[i].textContent || "")) {
              all[i].click();
              break;
            }
          }
        }
        break;

      case "focus_search":
        var searchInput = document.querySelector(
          'input[type="search"],input[placeholder*="search" i],input[aria-label*="search" i]'
        );
        if (searchInput) {
          searchInput.focus();
        } else {
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "/", code: "Slash", bubbles: true })
          );
        }
        break;

      case "press_escape":
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })
        );
        document.body.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true })
        );
        break;

      case "navigate":
        if (param) {
          window.location.href = window.location.origin + param;
        }
        break;

      case "navigate_guide":
        window.location.href = BASE_URL + "/guide";
        break;

      case "navigate_settings":
        try {
          var settingsBtn = document.querySelector(
            '[data-testid*="setting" i],[aria-label*="setting" i],a[href*="setting" i],button[title*="Setting" i]'
          );
          if (settingsBtn) {
            settingsBtn.click();
          } else {
            var all = document.querySelectorAll("a,button,[role=button]");
            for (var i = 0; i < all.length; i++) {
              if (/einstellungen|settings/i.test(all[i].textContent || "")) {
                all[i].click();
                break;
              }
            }
          }
        } catch (e) {}
        break;

      case "navigate_account":
        try {
          var accountBtn = document.querySelector(
            '[data-testid*="account" i],[aria-label*="account" i],a[href*="account" i]'
          );
          if (accountBtn) {
            accountBtn.click();
          } else {
            var all = document.querySelectorAll("a,button,[role=button]");
            for (var i = 0; i < all.length; i++) {
              if (/account|konto|profil/i.test(all[i].textContent || "")) {
                all[i].click();
                break;
              }
            }
          }
        } catch (e) {}
        break;

      case "navigate_recordings":
        window.location.href = BASE_URL + "/recordings";
        break;
    }
  }

  // ── Key handler (called from Rust via eval) ────────────────────
  function handleKeyEvent(jsonStr) {
    try {
      var event = JSON.parse(jsonStr);
      console.log(
        "[ZR] Key event:",
        event.action,
        event.is_press ? "\u2193" : "\u2191",
        event.label || "",
        event.scan_code || 0
      );
      if (!event.is_press) return;

      var action = event.action;
      var label = event.label || "";
      showOsd(label);

      // Digit key → channel number input
      if (action.indexOf("digit_") === 0) {
        var digit = action.charAt(action.length - 1);
        channelBuffer += digit;
        showChannelInput(channelBuffer);
        if (channelTimer) clearTimeout(channelTimer);
        channelTimer = setTimeout(function () {
          if (channelBuffer) {
            zattooAction("change_channel", channelBuffer);
            channelBuffer = "";
            hideChannelInput();
          }
        }, CHANNEL_TIMEOUT);
        return;
      }

      // Color key → favorite channel
      if (action.indexOf("color_") === 0) {
        var color = action.substring(6);
        for (var i = 0; i < favorites.length; i++) {
          if (favorites[i].color === color) {
            showOsdFavorite(favorites[i].name);
            zattooAction("change_channel", favorites[i].slug || favorites[i].channel);
            break;
          }
        }
        return;
      }

      // Standard actions
      switch (action) {
        case "up":
          zattooAction("send_key", "ArrowUp");
          break;
        case "down":
          zattooAction("send_key", "ArrowDown");
          break;
        case "left":
          zattooAction("send_key", "ArrowLeft");
          break;
        case "right":
          zattooAction("send_key", "ArrowRight");
          break;
        case "ok":
          zattooAction("send_key", "Enter");
          break;
        case "back":
          zattooAction("press_escape");
          break;
        case "play_pause":
          zattooAction("toggle_play_pause");
          break;
        case "rewind":
          zattooAction("seek", "-15");
          break;
        case "fast_forward":
          zattooAction("seek", "15");
          break;
        case "channel_up":
          zattooAction("send_key", "PageUp");
          break;
        case "channel_down":
          zattooAction("send_key", "PageDown");
          break;
        case "home":
          zattooAction("navigate", "/live");
          break;
        case "menu":
          zattooAction("open_epg");
          break;
        case "search":
          zattooAction("focus_search");
          break;
        case "guide":
          zattooAction("navigate_guide");
          break;
        case "settings":
          zattooAction("navigate_settings");
          break;
        case "account":
          zattooAction("navigate_account");
          break;
        case "recordings":
          zattooAction("navigate_recordings");
          break;
        case "stop":
          zattooAction("press_escape");
          break;
        case "record":
          showOsd("Record");
          break;
        case "mouse_mode":
          showOsd("Mouse Mode");
          break;
      }
    } catch (e) {
      console.error("[ZR] err:", e);
    }
  }

  // ── Navigation detection ───────────────────────────────────────
  function watchNav() {
    lastUrl = window.location.href;
    setInterval(function () {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[ZR] URL changed to:", lastUrl);
        if (!document.getElementById("zrR")) {
          injectHtml();
          injectStyles();
        }
        if (
          !window.__zattooRemote ||
          !window.__zattooRemote.handleKeyEvent
        ) {
          window.__zattooRemote = {
            handleKeyEvent: handleKeyEvent,
            version: "2.0",
          };
        }
      }
    }, 1000);
  }

  // ── Toast / popup auto-dismisser ────────────────────────────────
  // Zattoo shows toasts ("Verringerte Videoqualität", etc.) that
  // block key input. Finds them by text content and dismisses them.
  function dismissToasts() {
    if (window._zrToastTimer) return;
    window._zrToastTimer = 1;

    var keywords =
      "verringerte,videoqualität,kopierschutz,copy protection,reduced quality,sd qualit";

    function tryDismissToast(el) {
      if (!el || el._zrDismissed || el.nodeType !== 1) return;
      el._zrDismissed = true;
      console.log(
        "[ZR] Auto-dismiss:",
        (el.textContent || "").slice(0, 80).trim()
      );
      var buttons = el.querySelectorAll('button, [role="button"], svg, a');
      for (var i = 0; i < buttons.length; i++) {
        if (typeof buttons[i].click === "function") {
          buttons[i].click();
          return;
        }
      }
      try {
        var evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        el.dispatchEvent(evt);
      } catch (e) {}
      try {
        var parent = el.parentNode;
        if (parent) parent.removeChild(el);
      } catch (e) {}
    }

    function scanToasts() {
      var kws = keywords.split(",");
      document
        .querySelectorAll(
          '[role="alert"],[role="dialog"],[class*="banner" i],[class*="snackbar" i],[class*="toast" i],[class*="notification" i],[class*="overlay" i],[class*="popup" i],[style*="fixed"],[style*="sticky"]'
        )
        .forEach(function (el) {
          if (el._zrDismissed) return;
          var text = (el.textContent || "").toLowerCase();
          if (text.length < 10 || text.length > 400) return;
          for (var i = 0; i < kws.length; i++) {
            if (text.indexOf(kws[i]) >= 0) {
              tryDismissToast(el);
              return;
            }
          }
        });
      var extra = document.querySelectorAll(
        '[class*="message" i],[data-soul*="MESSAGE" i],[data-soul*="NOTIFICATION" i],[data-soul*="TOAST" i]'
      );
      for (var i = 0; i < extra.length; i++) {
        var text = (extra[i].textContent || "").toLowerCase();
        if (text.length < 10 || text.length > 400) continue;
        for (var j = 0; j < kws.length; j++) {
          if (text.indexOf(kws[j]) >= 0) {
            tryDismissToast(extra[i]);
            break;
          }
        }
      }
    }

    scanToasts();
    setInterval(scanToasts, 1500);
  }

  // ── SPA navigation observer ────────────────────────────────────
  function startMutationObserver() {
    try {
      if (!document || !document.body) return;
      var observer = new MutationObserver(function () {
        try {
          if (document && !document.getElementById("zrR")) {
            injectHtml();
            injectStyles();
          }
        } catch (e) {}
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", function () {
        try {
          startMutationObserver();
        } catch (e) {}
      });
    }
  }

  // ── DRM detection ────────────────────────────────────────────────
  // Detects available DRM key systems in the browser/webview.
  // Results are stored on window.__zattooRemote.drm and reported
  // back to Rust via Tauri event for terminal visibility.
  function detectDRM() {
    function storeResult(found, total) {
      var drmInfo = {
        available: found > 0,
        found: found,
        total: total,
        timestamp: Date.now(),
      };
      try {
        if (window.__zattooRemote) window.__zattooRemote.drm = drmInfo;
      } catch (e) {}
      // Report to Rust terminal via Tauri event
      try {
        if (
          window.__TAURI__ &&
          window.__TAURI__.event &&
          window.__TAURI__.event.emit
        ) {
          window.__TAURI__.event.emit("drm-status", drmInfo);
        }
      } catch (e) {
        console.warn("[ZR] DRM: Could not report to Rust:", e);
      }
    }

    function showDrmWarning(found) {
      if (found === 0) {
        var el = document.getElementById("zrL");
        if (el) {
          el.textContent =
            "\u26A0 No DRM \u2014 playback may be limited";
          el.classList.add("s");
          setTimeout(function () {
            el.classList.remove("s");
          }, 4000);
        }
      }
    }

    if (
      typeof navigator.requestMediaKeySystemAccess !== "function"
    ) {
      console.log(
        "[ZR] DRM: Not available \u2014 navigator.requestMediaKeySystemAccess not found"
      );
      storeResult(0, 8);
      showDrmWarning(0);
      return false;
    }

    console.log("[ZR] DRM: EME API available, probing key systems...");
    var systems = [
      "com.widevine.alpha",
      "com.microsoft.playready",
      "com.microsoft.playready.recommendation",
      "com.apple.fps",
      "com.apple.fps.1_0",
      "org.w3.clearkey",
      "com.adobe.primetime",
      "com.youtube.playready",
    ];
    var checked = 0;
    var found = 0;

    systems.forEach(function (ks) {
      navigator
        .requestMediaKeySystemAccess(ks, [
          {
            initDataTypes: ["cenc"],
            videoCapabilities: [
              { contentType: 'video/mp4;codecs="avc1.42E01E"' },
            ],
          },
        ])
        .then(function () {
          console.log("[ZR] DRM: \u2713 " + ks + " is available");
          found++;
        })
        .catch(function () {
          /* key system not supported, that's normal */
        })
        .finally(function () {
          checked++;
          if (checked === systems.length) {
            console.log(
              "[ZR] DRM: Found " +
                found +
                "/" +
                systems.length +
                " key system(s) available"
            );
            storeResult(found, systems.length);
            showDrmWarning(found);
          }
        });
    });

    return true;
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    try {
      console.log("[ZR] Init...");
      if (document && document.body && document.head) {
        injectStyles();
        injectHtml();
        startMutationObserver();
        watchNav();
        dismissToasts();
        window.__zattooRemote = {
          handleKeyEvent: handleKeyEvent,
          version: "3.0",
          drm: null,
        };
        detectDRM();
        console.log("[ZR] Ready");
      } else {
        setTimeout(init, 500);
      }
    } catch (e) {
      console.error("[ZR] Init error:", e);
      setTimeout(init, 500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
