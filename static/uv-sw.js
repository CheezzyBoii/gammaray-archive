importScripts('/uv/bare.bundle.js');
importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.sw.js');

const sw = new UVServiceWorker();

const connection = new BareMux.BareMuxConnection("/uv/bare.worker.js");

self.addEventListener('fetch', (event) => {
    if (event.request.url.startsWith(location.origin + self.__uv$config.prefix)) {
        event.respondWith((async () => {
            try {
                if (!(await connection.getTransport())) {
                    const bareURL = new URL(self.__uv$config.bare, location.origin).href;
                    await connection.setTransport("/uv/bare.transport.mjs", [bareURL]);
                }
            } catch (err) {
                console.error("[UBX-SW] Transport setup failed:", err);
            }
            return sw.fetch(event);
        })());
    }
});