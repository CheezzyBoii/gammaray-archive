"use strict";

/**
 * Ultraviolet v3 Initialization Script
 * Centralizes transport setup and common utilities.
 */

async function initUV() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const connection = new BareMux.BareMuxConnection("/uv/bare.worker.js");
        
        const defaultBare = '/edu/';
        let effectiveBare = defaultBare;
        
        if (typeof localStorage !== 'undefined') {
            effectiveBare = localStorage.getItem('bare') || defaultBare;
        }

        const bareURL = new URL(effectiveBare, window.location.origin).href;

        try {
            if (!(await connection.getTransport())) {
                await connection.setTransport("/uv/bare.transport.mjs", [bareURL]);
                console.log("[Gammaray] Bare-Mux Transport set to:", bareURL);
            }
        } catch (e) {
            console.error("[Gammaray] Failed to set preferred transport, trying fallback:", e);
            await connection.setTransport("/uv/bare.transport.mjs", [bareURL]);
        }
        
    } catch (err) {
        console.error("[Gammaray] UV Initialization failed:", err);
    }
}

function uvEncode(url) {
    if (!url) return url;
    return encodeURIComponent(url.toString().split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join(''));
}

// Export to window
window.uvEncode = uvEncode;

// Auto-init if BareMux is present
if (typeof BareMux !== 'undefined') {
    initUV();
}