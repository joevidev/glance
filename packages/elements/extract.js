// Glance element extractor. ONE file, used by BOTH:
//   - the benchmark crawl:   Playwright  page.evaluate(<this file's text>)
//   - the desktop demo:      Electron    webContents.executeJavaScript(<this file's text>)
// It is a single expression (an IIFE) that returns the elements, so the same
// text works in both. Output matches packages/contracts/schema/element.schema.json
// and is in viewport CSS pixels. Ids are 0..n-1 in reading order (top to bottom, left to right).
(() => {
  const MAX = 80;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 80);

  const SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]', '[role="option"]', '[role="combobox"]', '[role="searchbox"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') return ty;
      if (ty === 'submit' || ty === 'button' || ty === 'reset') return 'button';
      if (ty === 'search') return 'searchbox';
      return 'textbox';
    }
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'summary') return 'button';
    return t === 'button' ? 'button' : 'generic';
  };

  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return clean(label);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const txt = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (clean(txt)) return clean(txt);
    }
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    const inner = clean(el.innerText || el.textContent);
    if (inner) return inner;
    const img = el.querySelector('img[alt]');
    if (img && img.alt) return clean(img.alt);
    return clean(el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '');
  };

  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el, r) => {
    if (r.width < 8 || r.height < 8) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    if (el.disabled) return false;
    // the element must actually be the thing on top at (one of 5 points of) its box, not covered by an overlay
    const pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
    for (const [fx, fy] of pts) {
      const cx = Math.min(Math.max(r.left + r.width * fx, 0), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height * fy, 0), vh - 1);
      const top = document.elementFromPoint(cx, cy);
      if (top && (top === el || el.contains(top) || top.contains(el))) return true;
    }
    return false;
  };

  const seen = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const role = roleOf(el);
    // big generic containers (tabindex wrappers, page shells) are not click targets
    if (role === 'generic' && r.width * r.height > 0.15 * vw * vh) continue;
    const name = nameOf(el);
    if (!name) continue; // unnamed things cannot be referred to by a command
    // clip the box to the viewport
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(vw, r.right) - x, h = Math.min(vh, r.bottom) - y;
    seen.push({ el, role, name, box: { x, y, w, h } });
  }

  // drop an element if a smaller named element sits fully inside it with the same name (wrapper links)
  const out = seen.filter((a, i) =>
    !seen.some((b, j) => i !== j && a.name === b.name && a.el.contains(b.el) && a.el !== b.el)
  );

  out.sort((a, b) => (Math.abs(a.box.y - b.box.y) > 12 ? a.box.y - b.box.y : a.box.x - b.box.x));
  return out.slice(0, MAX).map((e, id) => ({
    id,
    role: e.role,
    name: e.name,
    box: { x: Math.round(e.box.x * 10) / 10, y: Math.round(e.box.y * 10) / 10, w: Math.round(e.box.w * 10) / 10, h: Math.round(e.box.h * 10) / 10 },
  }));
})()
