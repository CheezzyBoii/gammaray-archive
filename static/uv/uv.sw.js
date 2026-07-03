"use strict";

(() => {
  const Ultraviolet = self.Ultraviolet;

  const DANGEROUS_SINKS = [
    "location", "cookie", "localStorage", "sessionStorage", 
    "eval", "importScripts", "fetch", "XMLHttpRequest", 
    "WebSocket", "Worker", "serviceWorker", "postMessage"
  ];
  
  const SINK_REGEX = new RegExp(`\\b(${DANGEROUS_SINKS.join('|')})\\b`, 'i');

  const STRIP_HEADERS = [
    "cross-origin-embedder-policy", "cross-origin-opener-policy",
    "cross-origin-resource-policy", "content-security-policy",
    "content-security-policy-report-only", "expect-ct", "feature-policy",
    "origin-isolation", "strict-transport-security", "upgrade-insecure-requests",
    "x-content-type-options", "x-download-options", "x-frame-options",
    "x-permitted-cross-domain-policies", "x-powered-by", "x-xss-protection"
  ];

  class UVServiceWorker extends Ultraviolet.EventEmitter {
    constructor(config = self.__uv$config) {
      super();
      this.config = config || { prefix: "/service/" };
      this.bareClient = new Ultraviolet.BareClient();
    }

    needsRewriting(code) {
      return SINK_REGEX.test(code);
    }

    route({ request }) {
      return request.url.startsWith(location.origin + this.config.prefix);
    }

    async fetch({ request }) {
      let remoteUrl = "Unknown Origin"; 
      try {
        if (!this.route({ request })) return await fetch(request);

        const uv = new Ultraviolet(this.config);
        if (typeof this.config.construct === "function") this.config.construct(uv, "service");

        const cookieDb = await uv.cookie.db();
        uv.meta.origin = location.origin;
        uv.meta.base = uv.meta.url = new URL(uv.sourceUrl(request.url));
        remoteUrl = uv.meta.url.href; // Update for error tracing

        const reqObj = new UVRequest(request, uv, 
          ["GET", "HEAD"].includes(request.method.toUpperCase()) ? null : await request.blob()
        );

        if (uv.meta.url.protocol === "blob:") {
          reqObj.blob = true;
          reqObj.base = reqObj.url = new URL(reqObj.url.pathname);
        }

        if (request.referrer && request.referrer.startsWith(location.origin)) {
          const ref = new URL(uv.sourceUrl(request.referrer));
          if (reqObj.headers.origin || (uv.meta.url.origin !== ref.origin && request.mode === "cors")) {
            reqObj.headers.origin = ref.origin;
          }
          reqObj.headers.referer = ref.href;
        }

        const cookies = (await uv.cookie.getCookies(cookieDb)) || [];
        const serial = uv.cookie.serialize(cookies, uv.meta, false);
        reqObj.headers["user-agent"] = navigator.userAgent;
        if (serial) reqObj.headers.cookie = serial;

        const reqEv = new InterceptEvent(reqObj);
        this.emit("request", reqEv);
        if (reqEv.intercepted) return reqEv.returnValue;

        const bareRes = await this.bareClient.fetch(reqObj.blob ? `blob:${location.origin}${reqObj.url.pathname}` : reqObj.url, {
          headers: reqObj.headers, method: reqObj.method, body: reqObj.body,
          credentials: reqObj.credentials, mode: reqObj.mode, cache: reqObj.cache, redirect: reqObj.redirect
        });

        const resObj = new UVResponse(reqObj, bareRes);
        const resEv = new InterceptEvent(resObj);
        this.emit("beforemod", resEv);
        if (resEv.intercepted) return resEv.returnValue;

        for (const h of STRIP_HEADERS) delete resObj.headers[h];
        if (resObj.headers.location) resObj.headers.location = uv.rewriteUrl(resObj.headers.location);

        if (resObj.body) {
          const dest = request.destination;
          
          if (dest === "script" || dest === "worker") {
            const rawText = await bareRes.text();
            if (this.needsRewriting(rawText)) {
              resObj.body = uv.js.rewrite(rawText);
              if (dest === "worker") {
                const inject = uv.createJsInject(uv.cookie.serialize(cookies, uv.meta, true), request.referrer);
                const scripts = [uv.bundleScript, uv.clientScript, uv.configScript, uv.handlerScript].map(JSON.stringify).join(",");
                resObj.body = `if(!self.__uv){${inject}importScripts(${scripts});}\n${resObj.body}`;
              }
            } else {
              resObj.body = rawText;
            }
          } 
          else if (dest === "style") {
            resObj.body = uv.rewriteCSS(await bareRes.text());
          } 
          else if (["iframe", "document"].includes(dest) && resObj.getHeader("content-type")?.startsWith("text/html")) {
            let html = await bareRes.text();
            if (Array.isArray(this.config.inject)) {
              const host = new URL(remoteUrl).host;
              for (const item of this.config.inject) {
                if (new RegExp(item.host).test(host)) {
                  const pattern = item.injectTo === "head" ? /<head>/i : /<body>/i;
                  html = html.replace(pattern, (m) => m + item.html);
                }
              }
            }
            resObj.body = uv.rewriteHtml(html, {
              document: true,
              injectHead: uv.createHtmlInject(uv.handlerScript, uv.bundleScript, uv.clientScript, uv.configScript, uv.cookie.serialize(cookies, uv.meta, true), request.referrer)
            });
          }
        }

        if (reqObj.headers.accept === "text/event-stream") resObj.headers["content-type"] = "text/event-stream";
        if (self.crossOriginIsolated) resObj.headers["Cross-Origin-Embedder-Policy"] = "require-corp";

        this.emit("response", resEv);
        return resEv.intercepted ? resEv.returnValue : new Response(resObj.body, {
          headers: resObj.headers, status: resObj.status, statusText: resObj.statusText
        });

      } catch (err) {
        return ["document", "iframe"].includes(request.destination) ? 
          generateErrorPage(err, remoteUrl) : 
          new Response(null, { status: 500 });
      }
    }
  }

  class UVResponse {
    constructor(req, raw) {
      this.request = req; this.raw = raw; this.headers = {};
      const rawHeaders = raw.rawHeaders || {};
      for (const [k, v] of Object.entries(rawHeaders)) this.headers[k.toLowerCase()] = v;
      this.status = raw.status; this.statusText = raw.statusText; this.body = raw.body;
    }
    getHeader(n) { const v = this.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; }
  }

  class UVRequest {
    constructor(req, uv, body) {
      this.ultraviolet = uv; this.request = req; this.method = req.method; this.body = body;
      this.headers = Object.fromEntries(req.headers.entries());
      this.cache = req.cache; this.redirect = req.redirect; this.credentials = "omit";
      this.mode = req.mode === "cors" ? "cors" : "same-origin"; this.blob = false;
    }
    get url() { return this.ultraviolet.meta.url; }
    set url(v) { this.ultraviolet.meta.url = v; }
  }

  class InterceptEvent {
    #i = false; #r = null;
    constructor(d) { this.data = d; }
    get intercepted() { return this.#i; }
    get returnValue() { return this.#r; }
    respondWith(v) { this.#r = v; this.#i = true; }
  }

  function generateErrorPage(err, url) {
    const css = `
      :root { --bg: #0b0e14; --text: #e0e6ed; --accent: #3b82f6; --error: #ef4444; }
      body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: #161b22; padding: 2rem; border-radius: 12px; border: 1px solid #30363d; max-width: 600px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      h1 { color: var(--error); margin-top: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 10px; }
      p { color: #8b949e; font-size: 0.9rem; }
      code { background: #010409; padding: 0.2rem 0.4rem; border-radius: 4px; color: var(--accent); }
      textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #ff7b72; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.85rem; resize: none; margin-top: 1rem; box-sizing: border-box; }
      button { background: var(--accent); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 1.5rem; transition: opacity 0.2s; }
      button:hover { opacity: 0.9; }
      .brand { font-size: 0.7rem; letter-spacing: 2px; text-transform: uppercase; color: #484f58; margin-bottom: 0.5rem; }
    `;
    const html = `<!DOCTYPE html><html><head><title>Proxy Error</title><style>${css}</style></head>
      <body><div class="card">
        <div class="brand">LivePatch&trade;</div>
        <h1>Gammaray v2</h1>
        <p>An issue occurred while trying to nuke blocks on: <code>${url}</code></p>
        <textarea rows="8" readonly>${err.stack || err}</textarea>
        <button onclick="location.reload()">Retry Connection</button>
      </div></body></html>`;
    return new Response(html, { status: 500, headers: { "content-type": "text/html" } });
  }

  self.UVServiceWorker = UVServiceWorker;
})();