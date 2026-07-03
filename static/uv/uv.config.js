/* Fixed uv.config.js */
const defaultBare = '/edu/';
let effectiveBare = defaultBare;

// Only access localStorage if it exists (Window environment)
if (typeof localStorage !== 'undefined') {
  effectiveBare = localStorage.getItem('bare') || defaultBare;
  if (!localStorage.getItem('bare')) {
    localStorage.setItem('bare', defaultBare);
  }
}

self.__uv$config = {
  prefix: '/service/',
  bare: (typeof location !== 'undefined' && effectiveBare.startsWith('/')) ? new URL(effectiveBare, location.origin).href : effectiveBare,
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: '/uv/uv.handler.js',
  client: '/uv/uv.client.js',
  bundle: '/uv/uv.bundle.js',
  config: '/uv/uv.config.js',
  sw: '/uv/uv.sw.js',
};