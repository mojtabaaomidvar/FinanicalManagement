(() => {
  if (location.hostname !== '127.0.0.1' || location.port !== '5701' || !location.pathname.startsWith('/preview')) return;
  const nativeFetch = window.fetch.bind(window);
  const session = String(window.__COPY_PREVIEW__?.session ?? window.__COPY_PREVIEW__?.sessionId ?? new URLSearchParams(location.search).get('session') ?? '');
  const send = data => { if (window.parent !== window) window.parent.postMessage({ ...data, session }, location.origin); };
  let config = window.__COPY_PREVIEW__ ?? null, pickMode = false, previewOnline = true, drafts = [], running = false, pendingFrame = 0;
  let visualDrafts = new Map(), visualTargets = new Map();
  const originalNodes = new WeakMap(), originalAttributes = new WeakMap();
  const originalVisuals = new WeakMap(), originalIcons = new WeakMap(), parsedVisuals = new Map();
  const parsedSources = new Map(), sourceMatchers = new WeakMap(), draftMatchers = new WeakMap();
  let unresolvedCopies = new Set(), lastUnresolved = '';
  const protectedValues = new Set();
  const allowedAttributes = ['placeholder', 'title', 'aria-label', 'alt', 'aria-description'];
  const userTextFields = '.hub-id h1,.set-profile-name,.settings-member h5,.shop-body > b,.document-copy > b,.document-file-name,.calendar-entry-title,.goals-details > b,.goals-note-preview,.goals-note,.equipment-details > b,.vehicles-details > b,.activities-details > b,.children-details > b,.children-related-list b,.pets-details > b,.pets-care-list b,.meal-dish-details b,[data-meal-content],.tx-title,.tx-desc,.shop-name,.inventory-title,.task-title,.hold-title,.account-title,[data-home-ref-id] b';
  const blockedText = 'script,style,textarea,pre,code,[contenteditable="true"]';
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();

  window.fetch = (input, init = {}) => {
    const address = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (address.origin !== location.origin && !['data:', 'blob:'].includes(address.protocol)) return Promise.reject(new TypeError('External requests are disabled in the copy preview'));
    if (!address.pathname.startsWith('/api/v1')) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers ?? {}).forEach((value, key) => headers.set(key, value)); headers.set('X-Copy-Preview-Session', session);
    return nativeFetch(input, { ...init, headers }).then(response => {
      if (response.headers.get('content-type')?.includes('application/json')) {
        void response.clone().json().then(collectUserValues).catch(() => {});
      }
      return response;
    });
  };
  try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => previewOnline }); } catch { /* The ordinary online state remains usable. */ }
  function collectUserValues(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(collectUserValues); return; }
    if (value.id || value.family_id) {
      for (const key of ['name', 'title', 'note', 'description', 'location', 'file_name', 'species', 'breed']) {
        if (typeof value[key] === 'string' && value[key].trim()) protectedValues.add(normalize(value[key]));
      }
    }
    Object.values(value).forEach(collectUserValues);
  }

  function resetFakeStorage() {
    return new Promise(resolve => {
      // This origin belongs exclusively to this local workbench; the real app uses port5700.
      const request = indexedDB.deleteDatabase('mali-man-secure');
      const timer = setTimeout(resolve, 3500);
      const done = () => { clearTimeout(timer); resolve(); };
      request.onsuccess = done; request.onerror = done;
    });
  }
  async function initialize() {
    if (!config) {
      const response = await nativeFetch('/__copy/preview/' + encodeURIComponent(session), { cache: 'no-store' });
      if (!response.ok) throw new Error('پیش‌نمایش معتبر نیست؛ حالت را دوباره شروع کن.'); config = await response.json();
    }
    const mode = config.scenario?.mode ?? config.mode ?? 'full';
    try {
      if (mode === 'intro') localStorage.removeItem('khaneyar.intro.seen'); else localStorage.setItem('khaneyar.intro.seen', '1');
      localStorage.removeItem('khaneyar.intro.draft');
      if (mode === 'install' || mode === 'a2hs') localStorage.removeItem('khaneyar.a2hs.installed'); else localStorage.setItem('khaneyar.a2hs.installed', '1');
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index); if (key?.startsWith('khaneyar:home:v1:')) localStorage.removeItem(key);
      }
    } catch { /* Sample data still works without persistence. */ }
    await resetFakeStorage();
    setTimeout(() => { void bootstrap().catch(error => send({ type: 'copy-preview-error', message: error.message })); }, 0);
    return config;
  }
  window.__COPY_PREVIEW_READY__ = initialize().catch(error => { send({ type: 'copy-preview-error', message: error.message }); return null; });

  async function poll(test, timeout = 22000) {
    const started = performance.now();
    while (performance.now() - started < timeout) {
      const result = test(); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('این حالت کامل آماده نشد؛ می‌توانی آن را دوباره شروع کنی.');
  }
  function navigate(detail) { window.dispatchEvent(new CustomEvent('copy-workbench:navigate', { detail })); }
  function setInput(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const pause = time => new Promise(resolve => setTimeout(resolve, time));
  async function bootstrap() {
    const mode = config?.scenario?.mode ?? config?.mode ?? 'full';
    await poll(() => document.querySelector('main,section.page,.auth-header,.onb-page,.onboarding,.onb-login,.install-prompt,.a2hs-page'));
    const routeId = typeof config.route === 'string' ? config.route : config.route?.id ?? 'hub';
    if (routeId === 'support') {
      await poll(() => document.querySelector('.support-shell'));
      installObservation(); send({ type: 'copy-preview-ready', mode, route: routeId }); return;
    }
    const guest = config.guest === true || ['auth', 'intro', 'invite', 'install', 'a2hs'].includes(mode)
      || config.scenario?.id?.startsWith('auth-') || ['auth', 'invite'].includes(routeId) || mode.startsWith('auth-') || mode.startsWith('invite-');
    if (guest) {
      let override = config?.scenario?.override ?? config?.override;
      if (!override) override = mode === 'intro' ? 'intro' : routeId === 'invite' || mode === 'invite' || mode.startsWith('invite-') ? 'invite' : mode === 'install' || mode === 'a2hs' ? 'a2hs' : config?.scenario?.id?.includes('register') || mode === 'pre-registered' ? 'auth-register' : 'auth-login';
      navigate({ override }); await pause(250); installObservation(); send({ type: 'copy-preview-ready', mode }); return;
    }
    send({ type: 'copy-preview-status', message: 'در حال بازکردن حساب نمونه…' });
    const phone = await poll(() => document.querySelector('.auth-track form:first-of-type input[type="tel"]') ?? document.querySelector('.hub-page'));
    if (phone instanceof HTMLInputElement) {
      const form = phone.closest('form'), password = form.querySelector('input[type="password"]');
      setInput(phone, config.credentials?.phone ?? '09000000001'); setInput(password, config.credentials?.password ?? 'Test12345!'); await pause(100); form.requestSubmit();
    }
    await poll(() => document.querySelector('.hub-page'));
    await pause(150);
    const routeInfo = config.routeInfo ?? config.routeMeta ?? {};
    const baseRoute = routeInfo.baseRoute ?? routeId.split('/')[0]; navigate({ route: baseRoute, override: null }); await pause(250);
    if (routeInfo.section || routeId.startsWith('settings/')) {
      const section = routeInfo.section ?? routeId.split('/')[1];
      window.dispatchEvent(new CustomEvent('copy-workbench:settings', { detail: { section } }));
      await pause(250);
    }
    if (mode === 'offline') {
      await pause(800); previewOnline = false; window.dispatchEvent(new Event('offline')); await pause(250);
    }
    installObservation(); send({ type: 'copy-preview-ready', mode, route: routeId });
  }

  function compileDraft(draft) {
    const tokens = (draft.tokens ?? []).map(value => typeof value === 'string' ? value : value.token).filter(Boolean);
    if (!tokens.length) return { ...draft, originalValue: normalize(draft.original), replace: value => normalize(value) === normalize(draft.original) ? draft.text : null };
    let template = normalize(draft.original);
    for (const token of tokens) template = template.replace(token, '\u0000');
    const parts = template.split('\u0000');
    if (parts.join('').length < 2) return null;
    const expression = new RegExp('^' + parts.map(escapeRegex).join('(.+?)') + '$', 'u');
    return { ...draft, replace: value => {
      const match = expression.exec(normalize(value)); if (!match) return null;
      let replacement = draft.text;
      tokens.forEach((token, index) => { replacement = replacement.replace(token, () => match[index + 1]); });
      return replacement;
    } };
  }
  function parseSources(value) {
    if (typeof value !== 'string' || !value) return [];
    if (!parsedSources.has(value)) {
      try { const entries = JSON.parse(value); parsedSources.set(value, Array.isArray(entries) ? entries.filter(entry => typeof entry?.id === 'string' && typeof entry?.text === 'string') : []); }
      catch { parsedSources.set(value, []); }
    }
    return parsedSources.get(value);
  }
  function parseVisuals(value) {
    if (typeof value !== 'string' || !value) return [];
    if (!parsedVisuals.has(value)) {
      try {
        const entries = JSON.parse(value);
        parsedVisuals.set(value, Array.isArray(entries) ? entries.filter(entry => typeof entry?.id === 'string'
          && ['icon', 'text-element'].includes(entry.kind) && typeof entry.visible === 'boolean') : []);
      } catch { parsedVisuals.set(value, []); }
    }
    return parsedVisuals.get(value);
  }
  function iconElement(element) { return element.matches('svg') ? element : element.querySelector('svg'); }
  function iconTarget(svg) {
    const parent = svg.parentElement;
    if (!parent?.matches('span,i') || parent.matches('[role],[tabindex],[onclick]')) return svg;
    const children = [...parent.childNodes].filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
    return children.length === 1 && children[0] === svg ? parent : svg;
  }
  function iconMatches(element, source) {
    const svg = iconElement(element); if (!svg) return false;
    const original = originalIcons.get(svg), href = original?.href ?? svg.querySelector('use')?.getAttribute('href');
    return source.nativeIcon && !source.icon || href === '#' + source.icon
      || svg.querySelector('use')?.getAttribute('href') === '#' + visualDrafts.get(source.id)?.icon;
  }
  function collectVisualTargets() {
    const targets = new Map();
    function add(element, records) {
      if (!records.length || element.closest(blockedText)) return;
      const current = targets.get(element) ?? [];
      for (const record of records) if (!current.some(value => value.id === record.id)) current.push(record);
      targets.set(element, current);
    }
    for (const element of document.querySelectorAll('[data-copy-visual]')) add(element, parseVisuals(element.getAttribute('data-copy-visual')));
    // Custom components keep the isolated source metadata on their React fiber.
    // Only the matching SVG receives an icon prop's identity; the whole row and
    // its navigation arrow must remain outside that icon's editing scope.
    for (const svg of document.querySelectorAll('svg')) {
      const key = Object.keys(svg).find(name => name.startsWith('__reactFiber$'));
      let fiber = key ? svg[key] : null, depth = 0;
      while (fiber && depth++ < 80) {
        const records = parseVisuals(fiber.memoizedProps?.['data-copy-visual']).filter(source => source.kind === 'icon' && iconMatches(svg, source));
        if (records.length) {
          const remaining = records.filter(source => ![...targets].some(([owner, values]) => owner.contains(svg) && values.some(value => value.id === source.id)));
          add(iconTarget(svg), remaining); break;
        }
        fiber = fiber.return;
      }
    }
    return targets;
  }
  function restoreIcon(svg, record) {
    if (svg.innerHTML !== record.markup) svg.innerHTML = record.markup;
    if (record.viewBox === null) { if (svg.hasAttribute('viewBox')) svg.removeAttribute('viewBox'); }
    else if (svg.getAttribute('viewBox') !== record.viewBox) svg.setAttribute('viewBox', record.viewBox);
  }
  function applyVisualDrafts() {
    visualTargets = collectVisualTargets();
    for (const [element, sources] of visualTargets) {
      let state = originalVisuals.get(element);
      const currentDisplay = element.style.getPropertyValue('display'), currentPriority = element.style.getPropertyPriority('display');
      if (!state || currentDisplay !== state.appliedDisplay || currentPriority !== state.appliedPriority) {
        state = { display: currentDisplay, priority: currentPriority, appliedDisplay: currentDisplay, appliedPriority: currentPriority };
      }
      const visible = sources.every(source => !visualDrafts.get(source.id)?.deleted && (visualDrafts.get(source.id)?.visible ?? source.visible));
      const display = visible ? state.display : 'none', priority = visible ? state.priority : 'important';
      if (currentDisplay !== display || currentPriority !== priority) {
        if (display) element.style.setProperty('display', display, priority); else element.style.removeProperty('display');
      }
      state.appliedDisplay = display; state.appliedPriority = priority; originalVisuals.set(element, state);
      const icons = sources.filter(source => source.kind === 'icon');
      const svg = icons.length === 1 ? iconElement(element) : null; if (!svg) continue;
      let original = originalIcons.get(svg);
      if (!original) {
        original = { markup: svg.innerHTML, viewBox: svg.getAttribute('viewBox'), href: svg.querySelector('use')?.getAttribute('href') };
        originalIcons.set(svg, original);
      }
      const source = icons[0], draft = visualDrafts.get(source.id);
      const desiredIcon = draft && Object.hasOwn(draft, 'icon') ? draft.icon : source.icon;
      if (!draft || desiredIcon === source.icon) { restoreIcon(svg, original); continue; }
      if (desiredIcon === null && source.nativeSvg) {
        const documentSvg = new DOMParser().parseFromString(source.nativeSvg, 'image/svg+xml').documentElement;
        if (documentSvg.localName === 'svg' && !documentSvg.querySelector('parsererror,script,foreignObject,image')) {
          const markup = [...documentSvg.childNodes].map(child => new XMLSerializer().serializeToString(child)).join('');
          restoreIcon(svg, { markup, viewBox: documentSvg.getAttribute('viewBox') });
        }
      } else if (typeof desiredIcon === 'string' && /^i-[A-Za-z0-9_-]+$/.test(desiredIcon) && document.getElementById(desiredIcon)?.localName === 'symbol') {
        const use = svg.querySelector('use');
        if (svg.childNodes.length !== 1 || use?.getAttribute('href') !== '#' + desiredIcon) {
          const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'use'); replacement.setAttribute('href', '#' + desiredIcon);
          svg.replaceChildren(replacement);
        }
        if (svg.getAttribute('viewBox') !== '0 0 24 24') svg.setAttribute('viewBox', '0 0 24 24');
      }
    }
  }
  function visualPick(element, entryIds = []) {
    for (let owner = element; owner; owner = owner.parentElement) {
      const records = visualTargets.get(owner) ?? [];
      const matched = records.filter(record => record.kind === 'icon' || !entryIds.length
        || record.textEntryIds?.some(id => entryIds.includes(id)));
      if (matched.length) return { visualEntryIds: [...new Set(matched.map(record => record.id))],
        source: { file: matched[0].file, line: matched[0].line, context: matched[0].context } };
    }
    return {};
  }
  function matchesSource(source, value) {
    if (!sourceMatchers.has(source)) sourceMatchers.set(source, compileDraft({ original: source.text, text: source.text, tokens: source.tokens }));
    const matcher = sourceMatchers.get(source);
    if (matcher && matcher.replace(value) !== null) return true;
    return drafts.some(draft => {
      if (draft.id !== source.id) return false;
      if (!draftMatchers.has(draft)) draftMatchers.set(draft, compileDraft({ original: draft.text, text: draft.text, tokens: draft.tokens }));
      const changed = draftMatchers.get(draft); return changed && changed.replace(value) !== null;
    });
  }
  function sourceRecords(element, value, attribute, directOnly = false) {
    if (!element) return [];
    const filter = (records, forwarded = false) => records.filter(source => source.active !== false &&
      (attribute ? source.attribute === attribute : forwarded || !source.attribute) && matchesSource(source, value));
    const direct = filter(parseSources(element.getAttribute('data-copy-sources')));
    if (direct.length) return direct;
    if (directOnly) return [];
    // React retains custom-component props on the fiber even when the component
    // forwards only the visible title to a nested h1/h3. The isolated build adds
    // source metadata to those props; ordinary builds contain none of this metadata.
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null, depth = 0;
    while (fiber && depth++ < 80) {
      const records = filter(parseSources(fiber.memoizedProps?.['data-copy-sources']), typeof fiber.type !== 'string');
      if (records.length) return records;
      fiber = fiber.return;
    }
    return [];
  }
  function sourcePick(element, value, attribute, directOnly = false) {
    const sources = sourceRecords(element, value, attribute, directOnly), first = sources[0];
    return sources.length ? { entryIds: [...new Set(sources.map(source => source.id))],
      source: { file: first.file, line: first.line, context: first.context } } : {};
  }
  function replace(value, sources = []) {
    if (new Set(sources.map(source => source.id)).size > 1) {
      for (const draft of drafts) if (sources.some(source => source.id === draft.id) && draft.replace(value) !== null) unresolvedCopies.add(draft.id);
      return value;
    }
    for (const draft of drafts) {
      const replacement = draft.replace(value);
      if (replacement === null) continue;
      if (sources.length ? !sources.some(source => source.id === draft.id)
        : !Array.isArray(draft.matchingIds) || draft.matchingIds.length !== 1 || draft.matchingIds[0] !== draft.id) {
        if (!sources.length) unresolvedCopies.add(draft.id);
        continue;
      }
      if (replacement !== null) {
        const leading = value.match(/^\s*/)?.[0] ?? '', trailing = value.match(/\s*$/)?.[0] ?? '';
        return leading + replacement + trailing;
      }
    }
    return value;
  }
  function applyDrafts() {
    if (running || !document.body) return;
    running = true;
    unresolvedCopies = new Set();
    try {
      applyVisualDrafts();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement || node.parentElement.closest(blockedText)) continue;
        let record = originalNodes.get(node);
        if (!record || node.data !== record.applied) record = { original: node.data, applied: node.data };
        const field = node.parentElement.closest(userTextFields);
        const sources = sourceRecords(node.parentElement, record.original, undefined, Boolean(field));
        if (field && !sources.length) continue;
        const authoredValue = !sources.length && protectedValues.has(normalize(record.original));
        const next = authoredValue ? record.original : replace(record.original, sources);
        if (node.data !== next) node.data = next;
        record.applied = next; originalNodes.set(node, record);
      }
      for (const element of document.querySelectorAll('[data-copy-sources]')) {
        if (element.childNodes.length || element.closest(blockedText)) continue;
        const empty = parseSources(element.getAttribute('data-copy-sources')).filter(source => source.active !== false && !source.attribute && source.text === '');
        if (empty.length !== 1) continue;
        const replacement = replace('', empty);
        if (replacement) {
          const restored = document.createTextNode(replacement); element.append(restored);
          originalNodes.set(restored, { original: '', applied: replacement });
        }
      }
      for (const element of document.querySelectorAll(allowedAttributes.map(name => '[' + name + ']').join(','))) {
        if (element.closest('script,style')) continue;
        let attributes = originalAttributes.get(element); if (!attributes) attributes = new Map();
        for (const name of allowedAttributes) {
          const value = element.getAttribute(name); if (value === null) continue;
          let record = attributes.get(name); if (!record || value !== record.applied) record = { original: value, applied: value };
          const sources = sourceRecords(element, record.original, name);
          const authoredValue = !sources.length && name !== 'placeholder' && protectedValues.has(normalize(record.original));
          const next = authoredValue ? record.original : replace(record.original, sources); if (next !== value) element.setAttribute(name, next); record.applied = next; attributes.set(name, record);
        }
        originalAttributes.set(element, attributes);
      }
    } finally {
      running = false;
      const entryIds = [...unresolvedCopies].sort(), signature = entryIds.join('\n');
      if (signature !== lastUnresolved) {
        lastUnresolved = signature;
        send({ type: 'copy-preview-draft-status', entryIds, message: entryIds.length
          ? 'محل نمایش برخی پیش‌نویس‌ها دقیقاً مشخص نیست؛ نتیجهٔ آن‌ها پس از اعمال در کد دیده می‌شود.' : '' });
      }
    }
  }
  function scheduleDrafts() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; applyDrafts(); });
  }
  function installObservation() {
    if (!document.body || window.__COPY_PREVIEW_OBSERVED__) return;
    window.__COPY_PREVIEW_OBSERVED__ = true;
    new MutationObserver(scheduleDrafts).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...allowedAttributes, 'data-copy-sources', 'data-copy-visual', 'href', 'xlink:href', 'style'] });
    applyDrafts();
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'copy-drafts') { drafts = (Array.isArray(event.data.drafts) ? event.data.drafts : []).filter(value => typeof value.original === 'string' && typeof value.text === 'string').map(compileDraft).filter(Boolean); scheduleDrafts(); }
    else if (event.data.type === 'copy-visual-drafts') {
      visualDrafts = new Map((Array.isArray(event.data.drafts) ? event.data.drafts : []).filter(value => typeof value?.id === 'string' && typeof value.visible === 'boolean' && (!Object.hasOwn(value, 'deleted') || typeof value.deleted === 'boolean')
        && (!Object.hasOwn(value, 'icon') || value.icon === null || typeof value.icon === 'string' && /^i-[A-Za-z0-9_-]+$/.test(value.icon))).map(value => [value.id, value]));
      scheduleDrafts();
    }
    else if (event.data.type === 'copy-pick-mode') { pickMode = Boolean(event.data.enabled); if (document.body) document.body.classList.toggle('copy-preview-pick-mode', pickMode); }
  });
  function pickedText(event) {
    const element = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!element || element.closest(blockedText)) return;
    const visual = visualPick(element);
    if (visual.visualEntryIds?.some(id => [...visualTargets.values()].some(records => records.some(record => record.id === id && record.kind === 'icon')))) return { text: '', ...visual };
    function choose(picked, owner = element) {
      if (!picked) return;
      const field = owner.closest(userTextFields);
      const identity = sourcePick(owner, picked.text, picked.attribute, Boolean(field));
      if (!identity.entryIds?.length && (field || protectedValues.has(normalize(picked.text)))) {
        send({ type: 'copy-preview-status', message: 'این نوشته از اطلاعات نمونهٔ کاربر است.' }); return;
      }
      return { ...picked, ...identity, ...visualPick(owner, identity.entryIds) };
    }
    if (element.matches('input')) {
      const picked = allowedAttributes.map(name => ({ text: element.getAttribute(name), attribute: name })).find(value => value.text);
      return choose(picked);
    }
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range?.startContainer.nodeType === Node.TEXT_NODE && normalize(range.startContainer.data)) return choose({ text: range.startContainer.data }, range.startContainer.parentElement);
    const direct = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.data).find(value => normalize(value));
    if (direct) return choose({ text: direct });
    const text = normalize(element.textContent); if (text && text.length < 700) return choose({ text });
    const picked = allowedAttributes.map(name => ({ text: element.getAttribute(name), attribute: name })).find(value => value.text);
    return choose(picked);
  }
  document.addEventListener('click', event => {
    if (!pickMode && !event.altKey) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const picked = pickedText(event); if (picked?.text || picked?.visualEntryIds?.length) send({ type: 'copy-pick', ...picked });
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = '.copy-preview-pick-mode :is(button,label,h1,h2,h3,p,span,b,input,option,svg,[data-copy-visual]):hover{outline:2px dashed #059669!important;outline-offset:2px;cursor:crosshair!important}'; document.head.append(style);
  });
})();
