(() => {
  const settings = window.__COPY_PREVIEW__;
  const fixtures = window.__COPY_FIXTURES__;
  const preview = fixtures.createPreviewSession(settings.scenario.id, settings.route);
  settings.credentials = preview.credentials;
  const nativeFetch = window.fetch.bind(window);
  const values = new Map();
  const storage = {
    get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); },
  };
  // Each iframe owns disposable sample storage; parent editor drafts remain independent.
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage });
  const database = window.indexedDB;
  if (database) Object.defineProperty(window, 'indexedDB', { configurable: true, value: new Proxy(database, {
    get(target, property) {
      if (property === 'open' || property === 'deleteDatabase') return (name, ...args) => target[property]('copy-portable:' + settings.packageId + ':' + String(name), ...args);
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    },
  }) });
  // Disable browser background jobs in the standalone, disposable preview.
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    controller: null, ready: new Promise(() => {}), getRegistration: async () => undefined, getRegistrations: async () => [],
    addEventListener() {}, removeEventListener() {}, register: async () => { throw new Error('سرویس‌ورکر در پیش‌نمایش آفلاین اجرا نمی‌شود.'); },
  } }); } catch { /* Some browsers expose a fixed descriptor. */ }
  try { Object.defineProperty(window, 'caches', { configurable: true, value: { keys: async () => [], delete: async () => true,
    open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => true, keys: async () => [] }) } }); } catch { /* Storage is optional in the sample. */ }
  window.fetch = async (input, init = {}) => {
    const address = new URL(input instanceof Request ? input.url : String(input), 'https://portable.invalid');
    if (['data:', 'blob:'].includes(address.protocol)) return nativeFetch(input, init);
    if (address.origin !== 'https://portable.invalid' || !address.pathname.startsWith('/api/v1/')) throw new TypeError('درخواست بیرونی در پیش‌نمایش آفلاین در دسترس نیست.');
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    let body = init.body;
    if (body === undefined && input instanceof Request && !['GET', 'HEAD'].includes(method)) body = await input.clone().text();
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = undefined; } }
    const result = fixtures.handlePreviewRequest(preview, { method, path: address.pathname, query: address.searchParams, body });
    if (result.delayMs) await new Promise(resolve => setTimeout(resolve, Math.min(result.delayMs, 30000)));
    return new Response(result.raw ? result.body : result.status === 204 ? null : JSON.stringify(result.body), {
      status: result.status, headers: { ...result.headers, ...(result.raw ? {} : { 'Content-Type': 'application/json' }) },
    });
  };
})();
