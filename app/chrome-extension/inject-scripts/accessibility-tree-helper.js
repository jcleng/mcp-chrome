/* eslint-disable */
// accessibility-tree-helper.js
// Injected script to generate an accessibility-like tree of the visible page
// Elements receive stable refs (ref_*) via WeakRef mapping for later reference.

(function () {
  if (window.__ACCESSIBILITY_TREE_HELPER_INITIALIZED__) return;
  window.__ACCESSIBILITY_TREE_HELPER_INITIALIZED__ = true;

  // Traversal and output limits to ensure stability on very large/complex pages
  const MAX_DEPTH = 30; // maximum DOM depth to traverse
  const MAX_NODES = 4000; // hard limit to avoid long blocking on huge DOMs
  const MAX_LINE_LABEL = 100; // max characters for a single label in output
  const MAX_TEXT_LINE = 400; // max characters for one merged `- text:` line
  const REF_MAP_LIMIT = 1000; // limit size of the ref map to keep payload small

  // Keep a weak map from ref id to elements
  if (!window.__claudeElementMap) window.__claudeElementMap = {};
  if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
  // Reverse index element -> ref, so looking up the ref of a node is O(1) instead of
  // scanning the whole ref map for every single node (very slow on big pages).
  if (!window.__claudeRefByEl) {
    try {
      window.__claudeRefByEl = new WeakMap();
    } catch (_) {
      window.__claudeRefByEl = null;
    }
  }

  /**
   * Ref of an element, creating one on first use. Refs stay stable for the same element
   * across snapshots, which is what lets the agent reuse a ref it already has.
   * @param {Element} el
   * @returns {string}
   */
  function ensureRef(el) {
    if (!window.__claudeElementMap) window.__claudeElementMap = {};
    const cache = window.__claudeRefByEl;
    if (cache) {
      const known = cache.get(el);
      if (known && window.__claudeElementMap[known]) return known;
    }
    let refId = null;
    // Fall back to a scan only when a ref existed before this helper version loaded.
    if (!cache) {
      for (const k in window.__claudeElementMap) {
        const w = window.__claudeElementMap[k];
        if (w && typeof w.deref === 'function' && w.deref() === el) {
          refId = k;
          break;
        }
      }
    }
    if (!refId) {
      refId = `ref_${++window.__claudeRefCounter}`;
      window.__claudeElementMap[refId] = new WeakRef(el);
    }
    if (cache) cache.set(el, refId);
    return refId;
  }

  /**
   * Infer ARIA-like role from element
   * @param {Element} el
   * @returns {string}
   */
  function inferRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const map = {
      a: 'link',
      button: 'button',
      input:
        type === 'submit' || type === 'button'
          ? 'button'
          : type === 'checkbox'
            ? 'checkbox'
            : type === 'radio'
              ? 'radio'
              : type === 'file'
                ? 'button'
                : 'textbox',
      select: 'combobox',
      textarea: 'textbox',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      img: 'image',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      section: 'region',
      article: 'article',
      aside: 'complementary',
      form: 'form',
      table: 'table',
      thead: 'rowgroup',
      tbody: 'rowgroup',
      tfoot: 'rowgroup',
      tr: 'row',
      th: 'columnheader',
      td: 'cell',
      caption: 'caption',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
      label: 'label',
    };
    return map[tag] || 'generic';
  }

  /**
   * Accessible name of an element, used by the compact output. Unlike inferLabel it never
   * falls back to a control's current value (a checkbox showing "on" is not its name) and
   * it keeps names short.
   * @param {Element} el
   * @param {string} role
   * @returns {string}
   */
  function compactName(el, role) {
    const tag = String(el.tagName || '').toLowerCase();
    const first = (v) => (v && String(v).trim() ? String(v).trim() : '');

    if (tag === 'select') {
      // The chosen option goes after the colon; the name is the field's label.
      const aria = first(el.getAttribute('aria-label')) || first(el.getAttribute('title'));
      if (aria) return squeeze(aria).slice(0, MAX_LINE_LABEL);
      const id = /** @type {HTMLElement} */ (el).id;
      if (id) {
        const lab = document.querySelector(`label[for="${id}"]`);
        if (lab && squeeze(lab.textContent)) return squeeze(lab.textContent).slice(0, MAX_LINE_LABEL);
      }
      const name = first(el.getAttribute('name'));
      return name ? squeeze(name).slice(0, MAX_LINE_LABEL) : '';
    }

    if (tag === 'input') {
      const type = String(el.getAttribute('type') || 'text').toLowerCase();
      if (['checkbox', 'radio'].includes(type)) {
        // Real name comes from a wrapping/for= label, aria-label or title.
        const aria = first(el.getAttribute('aria-label')) || first(el.getAttribute('title'));
        if (aria) return squeeze(aria).slice(0, MAX_LINE_LABEL);
        const labels = /** @type {any} */ (el).labels;
        if (labels && labels.length) return squeeze(labels[0].textContent || '').slice(0, MAX_LINE_LABEL);
        return '';
      }
      if (type === 'submit' || type === 'button' || type === 'reset') {
        return squeeze(first(el.getAttribute('value')) || first(el.getAttribute('aria-label'))).slice(
          0,
          MAX_LINE_LABEL,
        );
      }
    }

    // For roles whose name is their text, the whole subtree text is the name.
    if (
      ['link', 'button', 'heading', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'clickable'].includes(
        role,
      )
    ) {
      const own = squeeze(inferLabel(el) || el.textContent);
      return own.slice(0, MAX_LINE_LABEL);
    }

    return squeeze(inferLabel(el)).slice(0, MAX_LINE_LABEL);
  }

  /**
   * Derive readable label for element
   * @param {Element} el
   * @returns {string}
   */
  function inferLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      const opt = sel.querySelector('option[selected]') || sel.options[sel.selectedIndex];
      if (opt && opt.textContent) return opt.textContent.trim();
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    if (/** @type {HTMLElement} */ (el).id) {
      const lab = document.querySelector(`label[for="${/** @type {HTMLElement} */ (el).id}"]`);
      if (lab && lab.textContent && lab.textContent.trim()) return lab.textContent.trim();
    }
    if (tag === 'input') {
      const input = /** @type {HTMLInputElement} */ (el);
      const type = input.getAttribute('type') || '';
      const val = input.getAttribute('value');
      if (type === 'submit' && val && val.trim()) return val.trim();
      if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
    }
    if (['button', 'a', 'summary'].includes(tag)) {
      let text = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        const n = el.childNodes[i];
        if (n.nodeType === Node.TEXT_NODE) text += n.textContent || '';
      }
      if (text.trim()) return text.trim();
    }
    if (/^h[1-6]$/.test(tag)) {
      const t = el.textContent;
      if (t && t.trim()) return t.trim().substring(0, MAX_LINE_LABEL);
    }
    if (tag === 'img') {
      const src = el.getAttribute('src');
      if (src) {
        const file = src.split('/').pop()?.split('?')[0];
        return `Image: ${file}`;
      }
    }
    let agg = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE) agg += n.textContent || '';
    }
    if (agg && agg.trim() && agg.trim().length >= 3) {
      const v = agg.trim();
      return v.length > 50 ? v.substring(0, 50) + '...' : v;
    }
    return '';
  }

  /**
   * Check if element is visible in DOM
   * @param {Element} el
   */
  function isVisible(el) {
    const cs = window.getComputedStyle(/** @type {HTMLElement} */ (el));
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const he = /** @type {HTMLElement} */ (el);
    return he.offsetWidth > 0 && he.offsetHeight > 0;
  }

  /**
   * Whether the element is interactive
   * @param {Element} el
   */
  function isInteractive(el) {
    // Native interactive tags
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tag))
      return true;

    // Generic interactive hints
    if (el.getAttribute('onclick') != null) return true;
    if (
      el.getAttribute('tabindex') != null &&
      String(el.getAttribute('tabindex')).trim() !== '' &&
      !String(el.getAttribute('tabindex')).trim().startsWith('-')
    )
      return true;
    if (el.getAttribute('contenteditable') === 'true') return true;

    // ARIA roles commonly used by custom elements
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const interactiveRoles = new Set([
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'option',
      'menuitem',
      'textbox',
      'searchbox',
      'combobox',
      'spinbutton',
      'tab',
      'treeitem',
    ]);
    if (role && interactiveRoles.has(role.toLowerCase())) return true;

    // Shadow host case: treat host as interactive if its open shadow root contains
    // an interactive control (textarea/input/select/button/a or contenteditable).
    try {
      const anyEl = /** @type {any} */ (el);
      const sr = anyEl && anyEl.shadowRoot ? anyEl.shadowRoot : null;
      if (sr) {
        const inner = sr.querySelector(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="searchbox"], [role="menuitem"], [role="option"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="slider"]',
        );
        if (inner) return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  /**
   * Structural containers useful to include
   * @param {Element} el
   */
  function isStructural(el) {
    const tag = el.tagName.toLowerCase();
    if (
      [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'nav',
        'main',
        'header',
        'footer',
        'section',
        'article',
        'aside',
        'table',
        'tr',
        'thead',
        'tbody',
        'ul',
        'ol',
      ].includes(tag)
    )
      return true;
    return el.getAttribute('role') != null;
  }

  /**
   * Form-ish containers to keep
   * @param {Element} el
   */
  function isFormishContainer(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const id = /** @type {HTMLElement} */ (el).id || '';
    // Normalize className for HTML/SVG elements
    let cls = '';
    try {
      const attr = el.getAttribute && el.getAttribute('class');
      if (typeof attr === 'string') cls = attr;
      else {
        const cn = /** @type {any} */ (el).className;
        if (typeof cn === 'string') cls = cn;
        else if (cn && typeof cn.baseVal === 'string') cls = cn.baseVal;
      }
    } catch (e) {
      /* ignore */
    }
    return (
      role === 'search' ||
      role === 'form' ||
      role === 'group' ||
      role === 'toolbar' ||
      role === 'navigation' ||
      tag === 'form' ||
      tag === 'fieldset' ||
      tag === 'nav' ||
      tag === 'legend' ||
      id.includes('search') ||
      cls.includes('search') ||
      id.includes('form') ||
      cls.includes('form') ||
      id.includes('menu') ||
      cls.includes('menu') ||
      id.includes('nav') ||
      cls.includes('nav')
    );
  }

  // Utility: query CSS across open shadow roots (best-effort)
  function querySelectorDeepFirst(selector) {
    try {
      // Fast path
      const direct = document.querySelector(selector);
      if (direct) return direct;
    } catch (_) {}
    const visited = new Set();
    const stack = [document.documentElement];
    while (stack.length) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      try {
        const root = /** @type {any} */ (node).shadowRoot || (node.nodeType === 9 ? node : null);
        if (root) {
          try {
            const hit = root.querySelector(selector);
            if (hit) return hit;
          } catch (_) {}
        }
      } catch (_) {}
      // Traverse DOM and shadow roots
      try {
        const children = /** @type {Element} */ (node).children || [];
        for (let i = 0; i < children.length; i++) stack.push(children[i]);
        const sr = /** @type {any} */ (node).shadowRoot;
        if (sr && sr.children) {
          for (let i = 0; i < sr.children.length; i++) stack.push(sr.children[i]);
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Query CSS selector and return match info including uniqueness check.
   * @param {string} selector - CSS selector to query
   * @param {boolean} allowMultiple - If true, skip uniqueness check and return first match
   * @returns {{element: Element | null, matchCount: number, error?: string}}
   * Note: matchCount is capped at 2 (where 2 means "2 or more") for performance
   */
  function querySelectorWithUniquenessCheck(selector, allowMultiple = false) {
    const seen = new Set();
    let firstMatch = null;
    let matchCount = 0;

    const recordMatch = (el) => {
      if (!(el instanceof Element) || seen.has(el)) return false;
      seen.add(el);
      matchCount++;
      if (!firstMatch) firstMatch = el;
      // Short-circuit if:
      // - allowMultiple is true and we found first match (no need to continue)
      // - allowMultiple is false and we found multiple matches
      if (allowMultiple && firstMatch) return true;
      if (!allowMultiple && matchCount >= 2) return true;
      return false;
    };

    // Query in main document
    let selectorError = null;
    try {
      const directMatches = document.querySelectorAll(selector);
      for (let i = 0; i < directMatches.length; i++) {
        if (recordMatch(directMatches[i])) {
          // Early exit: either found first match (allowMultiple) or found multiple (not allowed)
          return { element: firstMatch, matchCount: allowMultiple ? 1 : 2 };
        }
      }
    } catch (e) {
      selectorError = e;
    }

    if (selectorError) {
      return {
        element: null,
        matchCount: 0,
        error: `Invalid CSS selector "${selector}": ${selectorError.message || selectorError}`,
      };
    }

    // If allowMultiple and we already have a match, return immediately
    if (allowMultiple && firstMatch) {
      return { element: firstMatch, matchCount: 1 };
    }

    // Query in shadow DOMs
    const visited = new Set();
    const stack = [document.documentElement];
    while (stack.length) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);

      try {
        const shadowRoot = /** @type {any} */ (node).shadowRoot;
        if (shadowRoot) {
          try {
            const shadowMatches = shadowRoot.querySelectorAll(selector);
            for (let i = 0; i < shadowMatches.length; i++) {
              if (recordMatch(shadowMatches[i])) {
                // Early exit: either found first match (allowMultiple) or found multiple (not allowed)
                return { element: firstMatch, matchCount: allowMultiple ? 1 : 2 };
              }
            }
          } catch (e) {
            return {
              element: null,
              matchCount: 0,
              error: `Invalid CSS selector "${selector}": ${e.message || e}`,
            };
          }

          // Add shadow root children to stack
          try {
            const shadowChildren = shadowRoot.children || [];
            for (let i = 0; i < shadowChildren.length; i++) {
              stack.push(shadowChildren[i]);
            }
          } catch (_) {}
        }
      } catch (_) {}

      // Add regular children to stack
      try {
        const children = /** @type {Element} */ (node).children || [];
        for (let i = 0; i < children.length; i++) {
          stack.push(children[i]);
        }
      } catch (_) {}
    }

    return { element: firstMatch, matchCount: Math.min(matchCount, 2) };
  }

  /**
   * Query XPath selector and return match info including uniqueness check.
   * @param {string} selector - XPath selector to query
   * @param {boolean} allowMultiple - If true, skip uniqueness check and return first match
   * @returns {{element: Element | null, matchCount: number, error?: string}}
   * Note: matchCount is capped at 2 (where 2 means "2 or more") for performance
   */
  function queryXPathWithUniquenessCheck(selector, allowMultiple = false) {
    if (!selector) {
      return { element: null, matchCount: 0 };
    }

    try {
      if (allowMultiple) {
        // When multiple matches are allowed, use ANY_UNORDERED_NODE_TYPE for performance
        // This returns just the first match without evaluating the entire result set
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.ANY_UNORDERED_NODE_TYPE,
          null,
        );
        const firstMatch =
          result.singleNodeValue instanceof Element
            ? /** @type {Element} */ (result.singleNodeValue)
            : null;
        return { element: firstMatch, matchCount: firstMatch ? 1 : 0 };
      } else {
        // When uniqueness is required, use ORDERED_NODE_SNAPSHOT_TYPE to count matches
        const snapshot = document.evaluate(
          selector,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        const totalMatches = snapshot.snapshotLength;
        // Cap at 2 for performance (2 means "2 or more")
        const matchCount = Math.min(totalMatches, 2);
        const firstMatch =
          totalMatches > 0 && snapshot.snapshotItem(0) instanceof Element
            ? /** @type {Element} */ (snapshot.snapshotItem(0))
            : null;
        return { element: firstMatch, matchCount };
      }
    } catch (e) {
      return {
        element: null,
        matchCount: 0,
        error: `Invalid XPath "${selector}": ${e.message || e}`,
      };
    }
  }

  /**
   * Whether to include element in tree under config
   * @param {Element} el
   * @param {{filter?: 'all'|'interactive'}} cfg
   */
  function shouldInclude(el, cfg) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'link', 'title', 'noscript'].includes(tag)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (!isVisible(el)) return false;
    if (cfg.filter !== 'all') {
      const r = /** @type {HTMLElement} */ (el).getBoundingClientRect();
      if (
        !(r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0)
      )
        return false;
    }
    if (cfg.filter === 'interactive') return isInteractive(el);
    if (isInteractive(el)) return true;
    if (isStructural(el)) return true;
    if (inferLabel(el).length > 0) return true;
    return isFormishContainer(el);
  }

  /**
   * Generate a fairly stable CSS selector
   * @param {Element} el
   * @returns {string}
   */
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';
    if (/** @type {HTMLElement} */ (el).id) {
      const idSel = `#${CSS.escape(/** @type {HTMLElement} */ (el).id)}`;
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }
    for (const attr of ['data-testid', 'data-cy', 'name']) {
      const attrValue = el.getAttribute(attr);
      if (attrValue) {
        const s = `[${attr}="${CSS.escape(attrValue)}"]`;
        if (document.querySelectorAll(s).length === 1) return s;
      }
    }
    let path = '';
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY') {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path = path ? `${selector} > ${path}` : selector;
      current = parent;
    }
    return path ? `body > ${path}` : 'body';
  }

  /**
   * Traverse DOM and build pageContent lines; collect ref map for interactive nodes.
   *
   * Two output shapes are supported:
   *  - compact (default): one short YAML-ish line per meaningful node, `[ref=ref_N]` only on
   *    things you can act on, no coordinates and no redundant attributes. Static text is
   *    merged into `- text:` lines and unnamed containers are flattened away. This is the
   *    format the agent reads, so it is what keeps the response small.
   *  - full: the previous verbose shape, kept for callers that need geometry/ids and for
   *    the older record-replay paths that parse it.
   *
   * @param {Element} el
   * @param {number} depth
   * @param {any} cfg
   * @param {any} out sink created by createLineSink / collectNode
   * @param {Array<{ref:string, selector:string, rect:{x:number,y:number,width:number,height:number}}>} refMap
   */
  function traverse(el, depth, cfg, out, refMap, state, indent) {
    // `indent` is the visual depth: flattened containers don't shift their children right,
    // so the tree stays readable instead of drifting into a staircase of spaces.
    if (typeof indent !== 'number') indent = depth;
    const maxDepth = cfg && typeof cfg.maxDepth === 'number' ? cfg.maxDepth : MAX_DEPTH;
    if (depth > maxDepth || !el || !el.tagName) return '';
    if (state.processed >= MAX_NODES) return '';
    if (state.visited.has(el)) return '';
    state.visited.add(el);
    const include = shouldInclude(el, cfg) || depth === 0;
    let role = '';
    let name = '';
    let printed = false;
    let textOnly = false;
    if (include) {
      const interactive = isInteractive(el);
      const node = cfg.compact
        ? compactNode(el, interactive)
        : verboseNode(el, indent, interactive);
      role = node.role || '';
      name = node.name || '';
      textOnly = !!node.textOnly;
      if (node && node.line) {
        out.push(node.line);
        state.included++;
        printed = true;
      }
      state.processed++;

      // Only collect ref mapping for interactive elements to limit cost
      if (interactive && node && node.ref && refMap.length < REF_MAP_LIMIT) {
        const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
        refMap.push({
          ref: node.ref,
          selector: generateSelector(el),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      }
    }
    if (state.processed >= MAX_NODES) return '';

    // Compact mode folds the node's own text plus the text of its inline children into a
    // single `- text:` line, so a paragraph of twenty spans costs one line, not twenty,
    // while real elements (links, buttons) still come out as their own lines.
    // Roles whose name already is their text need no such line: the name is in the line above.
    // A node that printed nothing (a flattened container) must not start its own text
    // buffer: its children belong to the nearest ancestor that actually printed a line,
    // so sibling words end up in one `- text:` instead of one line each.
    // A node that printed a line, or a generic container that made it into the tree, keeps
    // its own words in place: a paragraph's text must read before the links inside it.
    // Only wrappers with no line at all bubble their words up, which is what turns
    // <div class=meta><span>a</span><span>b</span></div> into a single line.
    // A field shows its value after the colon, so it must not also dump its content as text.
    const isField = /^(input|textarea|select)$/i.test(String(el.tagName || ''));
    const nameIsText = cfg.compact && (NAME_FROM_TEXT.has(String(role)) || isField) && (!!name || isField);
    const tagName = String(el.tagName || '').toLowerCase();
    // filter=interactive asks for controls only: no prose, just the things you can act on.
    const wantsText = cfg.filter !== 'interactive';
    const ownsText = printed || (include && role === 'generic' && tagName !== 'label' && wantsText);
    let textBuf = cfg.compact && ownsText && !nameIsText ? '' : null;
    const flushText = () => {
      if (textBuf === null) return;
      const t = squeeze(textBuf);
      textBuf = '';
      if (t) out.push(`${'  '.repeat(Math.max(indent, 0))}- text: ${t.slice(0, MAX_TEXT_LINE)}`);
    };

    // Words from children that printed nothing bubble up to the first ancestor with a line.
    let leftover = '';
    // Walk child *nodes* (not just elements) so bare text nodes are not dropped.
    const walkChildren = (nodes, childDepth) => {
      for (let i = 0; i < nodes.length; i++) {
        if (state.processed >= MAX_NODES) break;
        const child = nodes[i];
        const kind = textKind(child);
        // Words always go somewhere: to this node's text line, or up to the enclosing one.
        const sink = (txt) => {
          if (textBuf !== null) textBuf += ' ' + txt;
          else leftover += ' ' + txt;
        };
        if (kind === 'text') {
          sink(child.textContent || '');
          continue;
        }
        if (kind === 'inline') {
          sink(child.textContent || '');
          state.processed++;
          continue;
        }
        if (kind === 'break') continue;
        if (child.nodeType === 1 && isTextOnlyElement(child)) {
          const t = squeeze(foldedText(child));
          if (t) sink(t);
          state.processed++;
          continue;
        }
        if (textBuf !== null) {
          // A wrapper that printed no line and holds nothing actionable is just words:
          // fold its text into the current line instead of opening a line per wrapper.
          if (child.nodeType === 1 && isTextOnlyElement(child)) {
            textBuf += ' ' + foldedText(child);
            state.processed++;
            continue;
          }
          flushText();
        }
        const rest = traverse(child, childDepth, cfg, out, refMap, state, childIndent);
        if (rest) {
          if (textBuf !== null) textBuf += ' ' + rest;
          else leftover += ' ' + rest;
        }
      }
      flushText();
    };

    const childDepth = include ? depth + 1 : depth;
    // Only an element that printed a visible line pushes its children one level right.
    // Containers that merely hold text stay at their parent's level, so the outline does
    // not drift into a staircase of whitespace on deeply nested markup.
    const childIndent = printed ? indent + 1 : indent;

    // Traverse light DOM children
    if (/** @type {HTMLElement} */ (el).childNodes && depth < maxDepth) {
      walkChildren(/** @type {HTMLElement} */ (el).childNodes || [], childDepth);
    }
    // Traverse shadow DOM roots (limited by maxDepth and MAX_NODES)
    try {
      const anyEl = /** @type {any} */ (el);
      if (anyEl && anyEl.shadowRoot && depth < maxDepth) {
        walkChildren(anyEl.shadowRoot.childNodes || [], childDepth);
      }
    } catch (_) {
      /* ignore shadow errors */
    }

    // A node whose name already is its text has nothing left to give upward; a label's
    // words belong to its control, not to the page text.
    if (textBuf !== null || nameIsText || tagName === 'label') return '';
    return leftover;
  }

  // ---------------------------------------------------------------------------
  // Line builders
  // ---------------------------------------------------------------------------

  const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'noscript', 'template', 'head', 'base']);

  // Roles whose accessible name *is* the element's text, so the name in the line already
  // says everything: no `- text:` child line is needed (that would only repeat it).
  const NAME_FROM_TEXT = new Set([
    'link',
    'button',
    'heading',
    'tab',
    'menuitem',
    'option',
    'treeitem',
    'checkbox',
    'radio',
    'switch',
    'listitem',
    'cell',
    'columnheader',
    'rowheader',
    'row',
    'clickable',
    'label',
  ]);

  /**
   * A wrapper that prints no line of its own and contains nothing actionable: its text can
   * be folded into the surrounding `- text:` line (typical for <div class=meta><span>…</span>).
   * @param {Element} el
   */
  /**
   * Text of a subtree with the elements kept apart ("作者0 2026-01-01" instead of
   * "作者02026-01-01"), which is how the page reads on screen.
   * @param {Element} el
   */
  function foldedText(el) {
    let s = '';
    const nodes = el.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 3) {
        s += ' ' + (n.nodeValue || '');
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = String(n.tagName || '').toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      // A label's words already name its control; folding them here would repeat them.
      if (tag === 'label') continue;
      if (tag === 'br') {
        s += ' ';
        continue;
      }
      const inner = squeeze(foldedText(n));
      if (inner) s += ' ' + inner + ' ';
    }
    return s;
  }

  /**
   * An anonymous wrapper holding nothing but words. Its content can be folded into the
   * surrounding `- text:` line instead of getting a line of its own. Real landmarks
   * (nav/main/ul/form/table…) and anything interactive are excluded.
   * @param {Element} el
   */
  function isTextOnlyElement(el) {
    if (isInteractive(el) || isStructural(el)) return false;
    if (inferRole(el) !== 'generic') return false;
    if (!isVisible(el)) return true;
    return !el.querySelector(
      'a[href],button,input,select,textarea,details,summary,[role],[onclick],[tabindex],[contenteditable="true"],img,svg,iframe',
    );
  }

  /** Collapse whitespace; keep it short enough for one line. */
  function squeeze(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Escape a name/value for the quoted position in a line. */
  function q(s) {
    return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /**
   * How the compact walker should treat a child node while merging text.
   * @returns {'text'|'inline'|'break'|'node'}
   */
  function textKind(node) {
    if (!node) return 'break';
    if (node.nodeType === 3) return 'text';
    if (node.nodeType !== 1) return 'break';
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'br') return 'break';
    if (SKIP_TAGS.has(tag)) return 'break';
    // Plain inline formatting is folded into the surrounding text, unless it hides
    // something interactive (a span wrapping a link must stay a node of its own).
    if (
      /^(span|b|i|em|strong|small|mark|abbr|cite|q|s|u|sub|sup|time|font|bdi|bdo|dfn|kbd|samp|var|data|code|a11y-.*)$/.test(
        tag,
      ) &&
      !/** @type {any} */ (node).shadowRoot
    ) {
      if (tag === 'a' && node.getAttribute('href')) return 'node';
      if (
        node.querySelector &&
        node.querySelector(
          'a[href],button,input,select,textarea,[role],[onclick],[tabindex],img,iframe,svg',
        )
      )
        return 'node';
      return 'inline';
    }
    return 'node';
  }

  /** State flags worth one short bracket in compact output. */
  function stateFlags(el, role) {
    const f = [];
    try {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') f.push('disabled');
      const checkedRole =
        role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'option';
      if (checkedRole) {
        const on = el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true';
        if (on) f.push('checked');
      }
      const expanded = el.getAttribute('aria-expanded');
      if (expanded) f.push(expanded === 'true' ? 'expanded' : 'collapsed');
      if (el.getAttribute('aria-selected') === 'true') f.push('selected');
      if (el.getAttribute('aria-pressed') === 'true') f.push('pressed');
      if (el.required || el.getAttribute('aria-required') === 'true') f.push('required');
      if (el.readOnly) f.push('readonly');
      if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
        f.push('current');
      if (role === 'heading') {
        const lvl = el.getAttribute('aria-level') || String(el.tagName).slice(1);
        if (lvl) f.push(`level=${lvl}`);
      }
    } catch (_) {
      /* keep what we have */
    }
    return f;
  }

  /** Inputs whose current value is worth showing next to the control. */
  function controlValue(el, role) {
    try {
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'SELECT') {
        const sel = Array.from(el.selectedOptions || [])
          .map((o) => squeeze(o.label || o.textContent))
          .join(', ');
        return sel || '(none)';
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const type = String(el.getAttribute('type') || 'text').toLowerCase();
        if (['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(type))
          return '';
        if (type === 'password') return el.value ? '••••' : '';
        const v = squeeze(el.value);
        return v.length > MAX_TEXT_LINE ? v.slice(0, MAX_TEXT_LINE) + '…' : v;
      }
      if (role === 'textbox' && el.isContentEditable) {
        const v = squeeze(el.innerText);
        return v.length > MAX_TEXT_LINE ? v.slice(0, MAX_TEXT_LINE) + '…' : v;
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  /**
   * Compact line for one node: `- role "name" [ref=ref_N] [flags]` plus, for fields, `: value`.
   * Returns null when the node carries nothing useful, so the caller can flatten it.
   * @returns {{line: string|null, ref: string|null}}
   */
  function compactNode(el, interactive) {
    const tag = String(el.tagName || '').toLowerCase();
    if (SKIP_TAGS.has(tag)) return { line: null, ref: null, role: '', name: '' };
    const role = inferRole(el);
    const name = compactName(el, role);

    const ref = interactive ? ensureRef(el) : null;
    const flags = stateFlags(el, role);
    if (ref) flags.unshift(`ref=${ref}`);

    // Containers carry no role of their own: their words are collected by the text sink
    // below (direct text + inline formatting), and the children print themselves.
    if (role === 'generic') {
      if (interactive) {
        const head = `- clickable${name ? ' ' + q(name) : ''}${flags.map((f) => ` [${f}]`).join('')}`;
        return { line: head, ref, role: 'clickable', name };
      }
      // `textOnly` tells the parent this node is nothing but words, so it can append them to
      // the surrounding `- text:` line instead of giving every wrapper a line of its own.
      const textOnly = !el.querySelector(
        'a[href],button,input,select,textarea,details,summary,[role],[onclick],[tabindex],[contenteditable="true"],img,svg,iframe',
      );
      return { line: null, ref: null, role: 'generic', name: '', textOnly };
    }

    // <h3><a>Title</a></h3> and <li><a>Item</a></li>: the wrapper and the link say the same
    // thing. Keep only the one the agent can act on.
    if (!interactive && name && soleChildRepeatsName(el, name)) {
      return { line: null, ref: null, role: '', name: '' };
    }
    // A <label> only names a control; the control already carries those words. Printing the
    // label as well would say everything twice.
    if (tag === 'label') {
      return { line: null, ref: null, role: '', name: '' };
    }

    const value = interactive || tag === 'select' ? controlValue(el, role) : '';
    let line = `- ${role}${name ? ' ' + q(name) : ''}${flags.map((f) => ` [${f}]`).join('')}`;
    if (value && (tag === 'select' || value !== name)) line += `: ${value}`;
    return { line, ref, role, name };
  }

  /** Whether the element's only visible child is one interactive element with the same text. */
  function soleChildRepeatsName(el, name) {
    const nodes = el.children || [];
    if (nodes.length !== 1) return false;
    const child = nodes[0];
    if (!isInteractive(child)) return false;
    const childText = squeeze(child.textContent).slice(0, MAX_LINE_LABEL);
    return !!childText && childText === name;
  }

  /** The previous verbose line shape, kept for callers that ask for format=full. */
  function verboseNode(el, depth, interactive) {
    const role = inferRole(el);
    let label = inferLabel(el);
    const refId = ensureRef(el);
    const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    let line = `${'  '.repeat(depth)}- ${role}`;
    if (label) {
      label = label.replace(/\s+/g, ' ').substring(0, MAX_LINE_LABEL);
      line += ` "${label.replace(/"/g, '\\"')}"`;
    }
    line += ` [ref=${refId}] (x=${cx},y=${cy})`;
    if (/** @type {HTMLElement} */ (el).id) line += ` id="${/** @type {HTMLElement} */ (el).id}"`;
    const href = el.getAttribute('href');
    if (href) line += ` href="${href}"`;
    const type = el.getAttribute('type');
    if (type) line += ` type="${type}"`;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) line += ` placeholder="${placeholder}"`;
    // Surface disabled/pointer-events for better agent judgement
    try {
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      if (disabled) line += ` disabled`;
      const cs = window.getComputedStyle(/** @type {HTMLElement} */ (el));
      if (cs && cs.pointerEvents === 'none') line += ` pe=none`;
    } catch (_) {
      /* ignore style issues */
    }
    return { line, ref: interactive ? refId : null, role, name: label || '' };
  }

  /**
   * Generate tree and return
   * @param {'all'|'interactive'|null} filter
   * @param {{maxDepth?: number, refId?: string, compact?: boolean, includeRefMap?: boolean}|undefined} options
   */
  function __generateAccessibilityTree(filter, options) {
    try {
      const start = performance && performance.now ? performance.now() : Date.now();
      const out = [];
      const cfg = { filter: filter || undefined };
      // Compact output is the default: it is what the agent reads, and it is several times
      // smaller than the verbose dump while still carrying a ref for every actionable node.
      cfg.compact = !(options && options.compact === false);

      // Clamp maxDepth to MAX_DEPTH to keep costs bounded
      if (options && Number.isFinite(options.maxDepth)) {
        const d = Math.max(0, Math.floor(Number(options.maxDepth)));
        cfg.maxDepth = Math.min(d, MAX_DEPTH);
      }

      const refMap = [];
      const state = { processed: 0, included: 0, visited: new WeakSet() };

      // Determine root element (body or refId-specified element)
      let focus = null;
      let root = document.body;
      if (options && options.refId) {
        const refIdStr = String(options.refId || '').trim();
        if (refIdStr) {
          const el = resolveRef(refIdStr);
          if (!el || !(el instanceof Element)) {
            return { error: `ref "${refIdStr}" not found or expired` };
          }
          root = el;
          focus = { refId: refIdStr };
        }
      }

      if (root) traverse(root, 0, cfg, out, refMap, state);
      for (const k in window.__claudeElementMap) {
        if (!window.__claudeElementMap[k].deref || !window.__claudeElementMap[k].deref())
          delete window.__claudeElementMap[k];
      }
      const pageContent = cfg.compact
        ? out.join('\n')
        : out.filter((line) => !/^\s*- generic \[ref=ref_\d+\]$/.test(line)).join('\n');
      const end = performance && performance.now ? performance.now() : Date.now();
      const payload = {
        pageContent,
        format: cfg.compact ? 'compact' : 'full',
        focus,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        stats: {
          processed: state.processed,
          included: state.included,
          durationMs: Math.round(end - start),
        },
        refCount: refMap.length,
      };
      // The ref map (selector + rect per ref) roughly doubles the payload and callers
      // almost never use it: refs are resolved on demand by click/fill. Opt in to get it.
      if (options && options.includeRefMap === true) payload.refMap = refMap;
      return payload;
    } catch (err) {
      throw new Error(
        'Error generating accessibility tree: ' +
          (err && err.message ? err.message : 'Unknown error'),
      );
    }
  }

  // Expose API on window
  window.__generateAccessibilityTree = __generateAccessibilityTree;

  // ============================================================================
  // Find by text
  // ============================================================================

  /**
   * Text as compared, not as displayed: lowercased with every run of whitespace removed.
   * Pages write "我的订单" and "我的 订单" interchangeably, so spaces cannot take part in
   * the comparison.
   */
  function normalizeText(s) {
    return String(s || '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /** Dice coefficient over character bigrams: forgiving about paraphrase, cheap to compute. */
  function diceScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const bigrams = (s) => {
      const arr = [];
      for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
      return arr.length ? arr : [s];
    };
    const A = bigrams(a);
    const B = bigrams(b);
    let inter = 0;
    const counts = new Map();
    for (const t of A) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of B) {
      const c = counts.get(t) || 0;
      if (c > 0) {
        inter++;
        counts.set(t, c - 1);
      }
    }
    return (2 * inter) / (A.length + B.length);
  }

  /**
   * Text the element itself shows, without what its children show. This is what makes
   * "Submit" match the <button> and not the <div> that also wraps a hundred other words.
   */
  function ownText(el) {
    let s = '';
    const nodes = el.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 3) s += ' ' + (n.nodeValue || '');
    }
    return squeeze(s);
  }

  /** Nearest clickable element: the hit itself when it already is one. */
  function nearestInteractive(el) {
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && depth < 8; depth++) {
      if (isInteractive(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * The element to act on for a text hit. A <label> is not clickable itself but names the
   * field next to it, and a hit inside a button belongs to the button.
   */
  function actionTarget(el) {
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'label') {
      const control =
        /** @type {any} */ (el).control ||
        (el.getAttribute('for')
          ? document.getElementById(String(el.getAttribute('for')))
          : el.querySelector('input,select,textarea,button'));
      if (control && control.nodeType === 1) return control;
    }
    return nearestInteractive(el) || el;
  }

  /**
   * Visibility as the search needs it, resolved inside the element's own document so nodes
   * that live in a frame are measured by their own window rather than the top one.
   * @param {Element} el
   */
  function isSearchVisible(el) {
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const cs = win.getComputedStyle(/** @type {HTMLElement} */ (el));
      if (!cs) return true;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      // Layout that is simply not reported (a frame before its first paint, an inert
      // document) is not the same as a hidden element: only the style decides then.
      // Zero-size elements are caught by the display/visibility checks above.
      return true;
    } catch (_) {
      return true;
    }
  }

  /** Short human description of a hit, modelled on a compact tree line. */
  function describeHit(el) {
    const role = inferRole(el);
    const name = compactName(el, role);
    return { role, name };
  }

  /**
   * Every place worth searching: the page, its open shadow roots, and same-origin frames.
   *
   * Each entry is a { root, doc } pair. A TreeWalker started on a Document yields the
   * document node itself, so the walk has to start at an element (or a shadow root).
   */
  function collectSearchRoots() {
    const roots = [];
    const addDoc = (doc) => {
      if (!doc || !doc.documentElement) return;
      if (roots.some((r) => r.root === doc.documentElement)) return;
      roots.push({ root: doc.documentElement, doc });
    };
    addDoc(document);

    const stack = [document.documentElement];
    let visited = 0;
    while (stack.length && visited < 12000) {
      const node = /** @type {any} */ (stack.pop());
      if (!node || node.nodeType !== 1) continue;
      visited++;
      try {
        const sr = node.shadowRoot;
        // A shadow root walks fine as a root; keep its owner doc for style lookups.
        if (sr) roots.push({ root: sr, doc: node.ownerDocument || document });
      } catch (_) {
        /* closed shadow root */
      }
      try {
        if (String(node.tagName || '').toLowerCase() === 'iframe') {
          const doc = node.contentDocument;
          if (doc && doc.documentElement) addDoc(doc);
        }
      } catch (_) {
        /* cross-origin frame */
      }
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return roots;
  }

  /**
   * Find the elements that show a given text.
   *
   * Matching is on each element's own text first, then on its whole subtree, and the hit is
   * moved to the innermost element that still contains the same text, so the result is the
   * control or label the person actually means rather than the page wrapper around it.
   *
   * @param {any} options
   */
  function __findByText(options) {
    const opts = options || {};
    const query = normalizeText(opts.text);
    const limit = Math.max(1, Math.min(Number(opts.maxResults) || 5, 50));
    const exact = opts.exact === true;
    const limitTag = normalizeText(opts.tag).toUpperCase();
    const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.6;
    if (!query) return { error: 'text is required' };

    // One wrong character in a short label wipes out most bigrams, so the bar depends on
    // how much text there is to compare: "提交定单" should still find "提交订单".
    const fuzzyFloor = query.length <= 8 ? Math.min(minScore, 0.3) : minScore;

    const strong = [];
    const fuzzy = [];
    let scanned = 0;

    const consider = (el, own, full) => {
      if (limitTag && String(el.tagName || '').toUpperCase() !== limitTag) return;
      const ownN = normalizeText(own);
      const fullN = normalizeText(full);
      if (!fullN) return;

      let score = 0;
      let how = '';
      if (exact) {
        if (ownN === query) {
          score = 1;
          how = 'exact';
        } else if (fullN === query) {
          score = 0.98;
          how = 'exact-subtree';
        }
      } else {
        if (ownN === query) {
          score = 1;
          how = 'exact';
        } else if (ownN.includes(query) && ownN.length <= query.length * 3 + 20) {
          // Own text that contains the query and is not much longer: the real label.
          score = 0.9 + 0.1 * (query.length / Math.max(ownN.length, 1));
          how = 'contains';
        } else if (fullN === query) {
          score = 0.95;
          how = 'subtree';
        } else if (fullN.includes(query)) {
          score = 0.8 + 0.1 * (query.length / Math.max(fullN.length, 1));
          how = 'subtree-contains';
        } else {
          const dice = Math.max(diceScore(ownN, query), diceScore(fullN, query) * 0.9);
          if (dice >= fuzzyFloor) {
            score = dice;
            how = 'fuzzy';
          }
        }
      }
      if (score <= 0) return;
      const bucket = how === 'fuzzy' ? fuzzy : strong;
      bucket.push({ el, score, how, text: ownN || fullN });
    };

    const roots = collectSearchRoots();
    for (const entry of roots) {
      // Frames live in another realm, so their nodes fail `instanceof Element` here; walk
      // them through their own document to keep the check honest.
      const ownedDoc = entry.doc || document;
      const walker = ownedDoc.createTreeWalker(entry.root, 1 /* SHOW_ELEMENT */, null);
      let node = walker.currentNode;
      while (node && scanned < MAX_NODES * 2) {
        const el = /** @type {Element} */ (node);
        scanned++;
        const tag = String(el.tagName || '').toLowerCase();
        if (!SKIP_TAGS.has(tag)) {
          try {
            if (isSearchVisible(el)) {
              // Light DOM text only. A shadow host is scored by what it shows itself, not
              // by its shadow content, or every host would duplicate its own widget's hit.
              consider(el, ownText(el), el.textContent || '');
            }
          } catch (_) {
            /* skip nodes that throw on layout access */
          }
        }
        node = walker.nextNode();
      }
    }

    // Exact and partial hits are what the caller asked for; fuzzy ones are a last resort,
    // so they never compete with a real match for the result slots. When the caller narrowed
    // the search by tag, a loose guess of a different element is worse than no answer.
    const candidates = strong.length ? strong : limitTag ? [] : fuzzy;
    if (!candidates.length) {
      return { matches: [], count: 0, query: opts.text, scanned };
    }

    // Prefer the innermost and shortest match: the ancestor of a hit that says the same is
    // noise for the agent, which only needs the one element to act on.
    candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    const picked = [];
    const seenEls = new Set();
    for (const c of candidates) {
      if (picked.length >= limit) break;
      if (seenEls.has(c.el)) continue;
      // Drop a hit that merely wraps an already-picked one with the same words.
      let redundant = false;
      for (const p of picked) {
        if (c.el.contains(p.el) && c.score <= p.score) {
          redundant = true;
          break;
        }
      }
      if (redundant) continue;
      seenEls.add(c.el);
      picked.push(c);
    }

    const matches = picked.map((c) => {
      const target = actionTarget(c.el);
      const info = describeHit(target);
      const ref = ensureRef(target);
      let rect = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const r = /** @type {HTMLElement} */ (target).getBoundingClientRect();
        rect = {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      } catch (_) {
        /* detached or not rendered */
      }
      return {
        ref,
        role: info.role,
        name: info.name,
        tag: String(target.tagName || '').toLowerCase(),
        text: squeeze(c.text).slice(0, MAX_LINE_LABEL),
        matched: c.how,
        score: Math.round(c.score * 100) / 100,
        interactive: isInteractive(target),
        rect,
      };
    });

    return { matches, count: matches.length, query: opts.text, scanned };
  }

  // Expose API on window
  window.__findByText = __findByText;

  // ============================================================================
  // Hover for Ref (DOM Fallback Support)
  // ============================================================================

  async function handleHoverForRef(ref) {
    if (!ref) return { success: false, error: 'ref is required' };
    const el = resolveRef(ref);
    if (el) {
      dispatchHoverEvents(el);
      return { success: true, target: summarizeElement(el) };
    }
    return await forwardHoverRefToChildren(ref);
  }

  function resolveRef(ref) {
    const map = window.__claudeElementMap || {};
    const weak = map[ref];
    return weak && typeof weak.deref === 'function' ? weak.deref() : null;
  }

  function dispatchHoverEvents(el) {
    const rect = el.getBoundingClientRect();
    const center = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
    ['mousemove', 'mouseover', 'mouseenter'].forEach((type) => {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: center.x,
          clientY: center.y,
          view: window,
        }),
      );
    });
  }

  function summarizeElement(el) {
    return {
      tagName: el.tagName,
      id: el.id || '',
      className: el.className || '',
      text: (el.textContent || '').trim().slice(0, 100),
    };
  }

  function forwardHoverRefToChildren(ref) {
    return new Promise((resolve) => {
      const frames = Array.from(document.querySelectorAll('iframe, frame'));
      if (!frames.length) {
        resolve({ success: false, error: `ref "${ref}" not found` });
        return;
      }
      const reqId = `hover_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const listener = (ev) => {
        const data = ev?.data;
        if (!data || data.type !== 'rr-bridge-hover-ref-result' || data.reqId !== reqId) return;
        window.removeEventListener('message', listener, true);
        resolve(data.result);
      };
      window.addEventListener('message', listener, true);
      setTimeout(() => {
        window.removeEventListener('message', listener, true);
        resolve({ success: false, error: `ref "${ref}" not found in child frames` });
      }, 1500);
      for (const frame of frames) {
        try {
          frame.contentWindow?.postMessage({ type: 'rr-bridge-hover-ref', reqId, ref }, '*');
        } catch {}
      }
    });
  }

  // Chrome message bridge for ping and tree generation
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (
        request &&
        (request.action === 'chrome_read_page_ping' ||
          request.action === 'chrome_find_by_text_ping')
      ) {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'rr_overlay') {
        try {
          const cmd = request.cmd || 'init';
          let root = document.getElementById('__rr_overlay_root');
          if (!root) {
            root = document.createElement('div');
            root.id = '__rr_overlay_root';
            Object.assign(root.style, {
              position: 'fixed',
              right: '8px',
              bottom: '8px',
              zIndex: 2_147_483_647,
              maxWidth: '40vw',
              maxHeight: '40vh',
              overflow: 'auto',
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: '12px',
              padding: '8px',
              borderRadius: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            });
            const title = document.createElement('div');
            title.textContent = 'Record-Replay 运行日志';
            Object.assign(title.style, { fontWeight: 'bold', marginBottom: '6px' });
            const body = document.createElement('div');
            body.id = '__rr_overlay_body';
            root.appendChild(title);
            root.appendChild(body);
            document.documentElement.appendChild(root);
          }
          const body = document.getElementById('__rr_overlay_body');
          if (cmd === 'append' && body) {
            const line = document.createElement('div');
            line.textContent = String(request.text || '');
            body.appendChild(line);
            body.scrollTop = body.scrollHeight;
          }
          if (cmd === 'done' && root) {
            root.style.opacity = '0.5';
          }
          sendResponse({ success: true });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      // Element picker: start a temporary overlay to let user pick an element
      if (request && request.action === 'rr_picker_start') {
        try {
          // state
          const state = { active: true };
          const hostId = '__rr_picker_host__';
          let host = document.getElementById(hostId);
          if (host) host.remove();
          host = document.createElement('div');
          host.id = hostId;
          Object.assign(host.style, {
            position: 'fixed',
            inset: '0',
            zIndex: 2147483646,
            cursor: 'crosshair',
            background: 'rgba(0,0,0,0.0)',
          });
          const box = document.createElement('div');
          Object.assign(box.style, {
            position: 'fixed',
            border: '2px solid #3b82f6',
            background: 'rgba(59,130,246,0.15)',
            pointerEvents: 'none',
          });
          const tip = document.createElement('div');
          tip.textContent = '点击选取元素（Esc 取消）';
          Object.assign(tip.style, {
            position: 'fixed',
            top: '10px',
            left: '10px',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial',
          });
          host.appendChild(box);
          host.appendChild(tip);
          document.documentElement.appendChild(host);

          const cleanup = () => {
            try {
              host.remove();
            } catch {}
            try {
              document.removeEventListener('mousemove', onMove, true);
            } catch {}
            try {
              document.removeEventListener('click', onClick, true);
            } catch {}
            try {
              document.removeEventListener('keydown', onKey, true);
            } catch {}
            state.active = false;
          };

          const onMove = (e) => {
            if (!state.active) return;
            const el = e.target instanceof Element ? e.target : null;
            if (!el) return;
            try {
              const r = el.getBoundingClientRect();
              Object.assign(box.style, {
                left: `${Math.round(r.left)}px`,
                top: `${Math.round(r.top)}px`,
                width: `${Math.round(Math.max(0, r.width))}px`,
                height: `${Math.round(Math.max(0, r.height))}px`,
                display: r.width > 0 && r.height > 0 ? 'block' : 'none',
              });
            } catch {}
          };
          const uniqueClassSelector = (node) => {
            try {
              const classes = Array.from(node.classList || []).filter(
                (c) => c && /^[a-zA-Z0-9_-]+$/.test(c),
              );
              for (const cls of classes) {
                const sel = `.${CSS.escape(cls)}`;
                if (document.querySelectorAll(sel).length === 1) return sel;
              }
              const tag = node.tagName ? node.tagName.toLowerCase() : '';
              for (const cls of classes) {
                const sel = `${tag}.${CSS.escape(cls)}`;
                if (document.querySelectorAll(sel).length === 1) return sel;
              }
              for (let i = 0; i < Math.min(classes.length, 3); i++) {
                for (let j = i + 1; j < Math.min(classes.length, 3); j++) {
                  const sel = `.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
                  if (document.querySelectorAll(sel).length === 1) return sel;
                }
              }
            } catch {}
            return '';
          };
          const computeCandidates = (el) => {
            const cands = [];
            // css by id / class / short path
            if (el.id) {
              const idSel = `#${CSS.escape(el.id)}`;
              if (document.querySelectorAll(idSel).length === 1)
                cands.push({ type: 'css', value: idSel });
            }
            const classSel = uniqueClassSelector(el);
            if (classSel) cands.push({ type: 'css', value: classSel });
            // data-* and name
            for (const attr of ['data-testid', 'data-cy', 'name']) {
              const val = el.getAttribute(attr);
              if (val) {
                const s = `[${attr}="${CSS.escape(val)}"]`;
                if (document.querySelectorAll(s).length === 1)
                  cands.push({ type: 'attr', value: s });
              }
            }
            // aria
            const aria = el.getAttribute && el.getAttribute('aria-label');
            if (aria) cands.push({ type: 'aria', value: `textbox[name=${aria}]` });
            // text for clickable
            const tag = (el.tagName || '').toLowerCase();
            if (['button', 'a', 'summary'].includes(tag)) {
              const text = (el.textContent || '').trim();
              if (text) cands.push({ type: 'text', value: text.substring(0, 64) });
            }
            // fallback path selector
            const gen = (node) => {
              if (!(node instanceof Element)) return '';
              let path = '';
              let current = node;
              while (
                current &&
                current.nodeType === Node.ELEMENT_NODE &&
                current.tagName !== 'BODY'
              ) {
                let sel = current.tagName.toLowerCase();
                const parent = current.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children).filter(
                    (child) => child.tagName === current.tagName,
                  );
                  if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    sel += `:nth-of-type(${index})`;
                  }
                }
                path = path ? `${sel} > ${path}` : sel;
                current = parent;
              }
              return path ? `body > ${path}` : 'body';
            };
            const pathSel = gen(el);
            if (pathSel) cands.push({ type: 'css', value: pathSel });
            return cands;
          };
          const onClick = (e) => {
            if (!state.active) return;
            e.preventDefault();
            e.stopPropagation();
            const el = e.target instanceof Element ? e.target : null;
            if (!el) {
              cleanup();
              sendResponse({ success: false, error: 'no element' });
              return true;
            }
            // create ref
            try {
              if (!window.__claudeElementMap) window.__claudeElementMap = {};
              if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
            } catch {}
            let refId = null;
            try {
              refId = ensureRef(el);
            } catch {}
            const cands = computeCandidates(el);
            cleanup();
            sendResponse({ success: true, ref: refId, candidates: cands });
            return true;
          };
          const onKey = (e) => {
            if (e.key === 'Escape') {
              cleanup();
              sendResponse({ success: false, cancelled: true });
            }
          };
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('click', onClick, true);
          document.addEventListener('keydown', onKey, true);
          return true; // async
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'rr_picker_stop') {
        try {
          const host = document.getElementById('__rr_picker_host__');
          if (host) host.remove();
          sendResponse({ success: true });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'findByText') {
        try {
          const result = __findByText({
            text: request.text,
            exact: request.exact === true,
            tag: request.tag,
            maxResults: request.maxResults,
            minScore: request.minScore,
          });
          if (result && result.error) {
            sendResponse({ success: false, error: result.error });
            return true;
          }
          sendResponse({ success: true, ...result });
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
        }
        return true;
      }
      if (request && request.action === 'generateAccessibilityTree') {
        const result = __generateAccessibilityTree(request.filter || null, {
          maxDepth: request.depth,
          refId: request.refId,
          compact: request.compact !== false,
          includeRefMap: request.includeRefMap === true,
        });
        if (result && result.error) {
          sendResponse({ success: false, error: result.error });
          return true;
        }
        sendResponse({ success: true, ...result });
        return true;
      }
      if (request && request.action === 'ensureRefForSelector') {
        try {
          // Composite selector support: "frameSelector |> innerSelector"
          const maybeSel = String(request.selector || '').trim();
          const allowMultiple = !!request.allowMultiple;
          if (maybeSel.includes('|>')) {
            try {
              const parts = maybeSel
                .split('|>')
                .map((s) => s.trim())
                .filter(Boolean);
              if (parts.length >= 2) {
                const frameSel = parts[0];
                const innerSel = parts.slice(1).join(' |> ');
                // Find target frame element in current document
                let frameEl = null;
                try {
                  frameEl = querySelectorDeepFirst(frameSel) || document.querySelector(frameSel);
                } catch {}
                if (
                  !frameEl ||
                  !(frameEl instanceof HTMLIFrameElement || frameEl instanceof HTMLFrameElement)
                ) {
                  sendResponse({
                    success: false,
                    error: `Composite frame selector not found: ${frameSel}`,
                  });
                  return true;
                }
                const cw = frameEl.contentWindow;
                if (!cw) {
                  sendResponse({
                    success: false,
                    error: 'Unable to obtain contentWindow of target frame',
                  });
                  return true;
                }
                // Bridge to child frame via postMessage with timeout
                const reqId = `rrc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const BRIDGE_TIMEOUT_MS = 5000; // 5 second timeout for iframe bridge
                let responded = false;
                let timeoutHandle = null;

                const cleanup = () => {
                  window.removeEventListener('message', listener, true);
                  if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                  }
                };

                const listener = (ev) => {
                  try {
                    const data = ev && ev.data;
                    if (
                      !data ||
                      data.type !== 'rr-bridge-ensure-ref-result' ||
                      data.reqId !== reqId
                    )
                      return;
                    // Validate source is the expected frame (security check)
                    if (ev.source !== cw) return;

                    if (responded) return; // Already timed out
                    responded = true;
                    cleanup();

                    if (data.success) {
                      sendResponse({
                        success: true,
                        ref: data.ref,
                        center: data.center,
                        href: data.href,
                      });
                    } else {
                      sendResponse({ success: false, error: data.error || 'child failed' });
                    }
                  } catch (e) {
                    if (!responded) {
                      responded = true;
                      cleanup();
                      sendResponse({
                        success: false,
                        error: String(e && e.message ? e.message : e),
                      });
                    }
                  }
                };

                // Set up timeout to prevent infinite wait
                timeoutHandle = setTimeout(() => {
                  if (!responded) {
                    responded = true;
                    cleanup();
                    sendResponse({
                      success: false,
                      error: `iframe bridge timeout after ${BRIDGE_TIMEOUT_MS}ms`,
                    });
                  }
                }, BRIDGE_TIMEOUT_MS);

                window.addEventListener('message', listener, true);
                cw.postMessage(
                  {
                    type: 'rr-bridge-ensure-ref',
                    reqId,
                    selector: innerSel,
                    useText: !!request.useText,
                    isXPath: !!request.isXPath,
                    tagName: String(request.tagName || ''),
                    allowMultiple: !!request.allowMultiple,
                  },
                  '*',
                );
                return true; // async response via message bridge
              }
            } catch (e) {
              sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
              return true;
            }
          }
          // Support CSS selector, XPath, or visible text search
          const useText = !!request.useText;
          const textQuery = String(request.text || '').trim();
          const sel = String(request.selector || '').trim();
          const isXPath = !!request.isXPath;
          const limitTag = String(request.tagName || '')
            .trim()
            .toUpperCase();
          let el = null;
          if (useText && textQuery) {
            const normalize = (s) =>
              String(s || '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            const query = normalize(textQuery);
            const bigrams = (s) => {
              const arr = [];
              for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
              return arr;
            };
            const dice = (a, b) => {
              if (!a || !b) return 0;
              const A = bigrams(a);
              const B = bigrams(b);
              if (A.length === 0 || B.length === 0) return 0;
              let inter = 0;
              const map = new Map();
              for (const t of A) map.set(t, (map.get(t) || 0) + 1);
              for (const t of B) {
                const c = map.get(t) || 0;
                if (c > 0) {
                  inter++;
                  map.set(t, c - 1);
                }
              }
              return (2 * inter) / (A.length + B.length);
            };
            let best = { el: null, score: 0 };
            // Deep traversal including shadow roots
            const stack = [document.documentElement];
            let visited = 0;
            while (stack.length) {
              const node = /** @type {any} */ (stack.pop());
              if (!node || !(node instanceof Element)) continue;
              try {
                if (limitTag && String(node.tagName || '').toUpperCase() !== limitTag) {
                  // still traverse into children/shadow for performance? yes
                } else {
                  const cs = window.getComputedStyle(node);
                  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
                    /* skip hidden */
                  } else {
                    const rect = /** @type {HTMLElement} */ (node).getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      const txt = normalize(node.textContent || '');
                      if (txt) {
                        if (txt.includes(query)) {
                          el = /** @type {Element} */ (node);
                          break;
                        }
                        const sc = dice(txt, query);
                        if (sc > best.score)
                          best = { el: /** @type {Element} */ (node), score: sc };
                      }
                    }
                  }
                }
              } catch {}
              // push children and shadow children
              try {
                const children = node.children || [];
                for (let i = 0; i < children.length; i++) stack.push(children[i]);
              } catch {}
              try {
                const sr = node.shadowRoot;
                if (sr && sr.children) {
                  for (let i = 0; i < sr.children.length; i++) stack.push(sr.children[i]);
                }
              } catch {}
              if (++visited > 8000) break;
            }
            if (!el && best.el && best.score >= 0.6) el = best.el;
          } else if (isXPath) {
            if (!sel) {
              sendResponse({ success: false, error: 'selector is required' });
              return true;
            }
            const result = queryXPathWithUniquenessCheck(sel, allowMultiple);
            if (result.error) {
              sendResponse({ success: false, error: result.error });
              return true;
            }
            if (result.matchCount === 0) {
              sendResponse({ success: false, error: `selector not found: ${sel}` });
              return true;
            }
            if (!allowMultiple && result.matchCount > 1) {
              sendResponse({
                success: false,
                error: `Selector "${sel}" matched multiple elements. Please refine the selector to match only one element.`,
              });
              return true;
            }
            el = result.element;
          } else {
            if (!sel) {
              sendResponse({ success: false, error: 'selector is required' });
              return true;
            }
            const result = querySelectorWithUniquenessCheck(sel, allowMultiple);
            if (result.error) {
              sendResponse({ success: false, error: result.error });
              return true;
            }
            if (result.matchCount === 0) {
              sendResponse({ success: false, error: `selector not found: ${sel}` });
              return true;
            }
            if (!allowMultiple && result.matchCount > 1) {
              sendResponse({
                success: false,
                error: `Selector "${sel}" matched multiple elements. Please refine the selector to match only one element.`,
              });
              return true;
            }
            el = result.element;
          }
          if (!el) {
            sendResponse({ success: false, error: `selector not found: ${sel}` });
            return true;
          }
          const refId = ensureRef(el);
          const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
          sendResponse({
            success: true,
            ref: refId,
            center: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            },
          });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'dispatchHoverForRef') {
        handleHoverForRef(String(request.ref || '').trim())
          .then((result) => sendResponse(result))
          .catch((error) =>
            sendResponse({ success: false, error: error?.message || String(error) }),
          );
        return true;
      }
      if (request && request.action === 'getAttributeForSelector') {
        try {
          const sel = String(request.selector || '').trim();
          const name = String(request.name || '').trim();
          if (!sel || !name) {
            sendResponse({ success: false, error: 'selector and name are required' });
            return true;
          }
          const el = document.querySelector(sel) || querySelectorDeepFirst(sel);
          if (!el) {
            sendResponse({ success: false, error: `selector not found: ${sel}` });
            return true;
          }
          let value = null;
          if (name === 'text' || name === 'textContent') {
            value = (el.textContent || '').trim();
          } else if (name === 'value') {
            try {
              value = /** @type {HTMLInputElement} */ (el).value ?? null;
            } catch (_) {
              value = el.getAttribute('value');
            }
          } else {
            value = el.getAttribute(name);
          }
          sendResponse({ success: true, value });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'collectVariables') {
        try {
          let vars = Array.isArray(request.variables) ? request.variables : [];
          if ((!vars || vars.length === 0) && request.payload) {
            try {
              const p = JSON.parse(String(request.payload || '{}'));
              if (Array.isArray(p.variables)) vars = p.variables;
            } catch {}
          }
          const useOverlay = request.useOverlay !== false; // default true
          const values = {};
          if (!useOverlay) {
            for (const v of vars) {
              const key = String(v && v.key ? v.key : '');
              if (!key) continue;
              const label = v.label || key;
              const def = v.default || '';
              const promptText = `请输入参数 ${label} (${key})`;
              let val = window.prompt(promptText, def);
              if (typeof val !== 'string') val = def;
              values[key] = val;
            }
            sendResponse({ success: true, values });
            return true;
          }
          // Build overlay form
          const hostId = '__rr_var_overlay__';
          let host = document.getElementById(hostId);
          if (host) host.remove();
          host = document.createElement('div');
          host.id = hostId;
          Object.assign(host.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.35)',
            zIndex: 2147483646,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          });
          const panel = document.createElement('div');
          Object.assign(panel.style, {
            background: '#fff',
            borderRadius: '8px',
            width: 'min(520px, 96vw)',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            padding: '16px',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
          });
          const title = document.createElement('div');
          title.textContent = '请输入回放参数';
          Object.assign(title.style, { fontSize: '16px', fontWeight: '600', marginBottom: '12px' });
          const form = document.createElement('form');
          for (const v of vars) {
            const row = document.createElement('div');
            Object.assign(row.style, { marginBottom: '10px' });
            const label = document.createElement('label');
            label.textContent = `${v.label || v.key}${v.sensitive ? ' (敏感)' : ''}`;
            Object.assign(label.style, {
              display: 'block',
              marginBottom: '6px',
              fontWeight: '500',
            });
            const input = document.createElement('input');
            input.type = v.sensitive ? 'password' : 'text';
            input.name = String(v.key);
            input.value = String(v.default || '');
            Object.assign(input.style, {
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              outline: 'none',
            });
            row.appendChild(label);
            row.appendChild(input);
            form.appendChild(row);
          }
          const actions = document.createElement('div');
          Object.assign(actions.style, { display: 'flex', gap: '8px', marginTop: '12px' });
          const ok = document.createElement('button');
          ok.type = 'submit';
          ok.textContent = '确定';
          Object.assign(ok.style, {
            background: '#0969da',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
          });
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = '取消';
          Object.assign(cancel.style, {
            background: '#f3f4f6',
            color: '#111',
            border: '1px solid #d0d7de',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
          });
          actions.appendChild(ok);
          actions.appendChild(cancel);
          panel.appendChild(title);
          panel.appendChild(form);
          panel.appendChild(actions);
          host.appendChild(panel);
          document.documentElement.appendChild(host);

          const cleanup = () => {
            try {
              host.remove();
            } catch {}
          };
          cancel.onclick = () => {
            cleanup();
            sendResponse({ success: false, cancelled: true });
          };
          form.onsubmit = (e) => {
            e.preventDefault();
            for (const v of vars) {
              const el = form.querySelector(`input[name="${CSS.escape(String(v.key))}"]`);
              if (el) values[v.key] = /** @type {HTMLInputElement} */ (el).value;
            }
            cleanup();
            sendResponse({ success: true, values });
          };
          return true; // async
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'resolveRef') {
        const ref = request.ref;
        try {
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          const el = weak && typeof weak.deref === 'function' ? weak.deref() : null;
          if (!el || !(el instanceof Element)) {
            sendResponse({ success: false, error: `ref "${ref}" not found or expired` });
            return true;
          }
          const rect = /** @type {HTMLElement} */ (el).getBoundingClientRect();
          sendResponse({
            success: true,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            center: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            },
            selector: (function () {
              // Simple selector generation inline to avoid duplication
              const generateSelector = function (node) {
                if (!(node instanceof Element)) return '';
                if (node.id) {
                  const idSel = `#${CSS.escape(node.id)}`;
                  if (document.querySelectorAll(idSel).length === 1) return idSel;
                }
                // prefer unique class selectors if available
                try {
                  const classes = Array.from(node.classList || []).filter(
                    (c) => c && /^[a-zA-Z0-9_-]+$/.test(c),
                  );
                  for (const cls of classes) {
                    const sel = `.${CSS.escape(cls)}`;
                    if (document.querySelectorAll(sel).length === 1) return sel;
                  }
                  const tag = node.tagName ? node.tagName.toLowerCase() : '';
                  for (const cls of classes) {
                    const sel = `${tag}.${CSS.escape(cls)}`;
                    if (document.querySelectorAll(sel).length === 1) return sel;
                  }
                  for (let i = 0; i < Math.min(classes.length, 3); i++) {
                    for (let j = i + 1; j < Math.min(classes.length, 3); j++) {
                      const sel = `.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
                      if (document.querySelectorAll(sel).length === 1) return sel;
                    }
                  }
                } catch {}
                for (const attr of ['data-testid', 'data-cy', 'name']) {
                  const val = node.getAttribute(attr);
                  if (val) {
                    const s = `[${attr}="${CSS.escape(val)}"]`;
                    if (document.querySelectorAll(s).length === 1) return s;
                  }
                }
                let path = '';
                let current = node;
                while (
                  current &&
                  current.nodeType === Node.ELEMENT_NODE &&
                  current.tagName !== 'BODY'
                ) {
                  let sel = current.tagName.toLowerCase();
                  const parent = current.parentElement;
                  if (parent) {
                    const siblings = Array.from(parent.children).filter(
                      (c) => c.tagName === current.tagName,
                    );
                    if (siblings.length > 1) {
                      const idx = siblings.indexOf(current) + 1;
                      sel += `:nth-of-type(${idx})`;
                    }
                  }
                  path = path ? `${sel} > ${path}` : sel;
                  current = parent;
                }
                return path ? `body > ${path}` : 'body';
              };
              return generateSelector(el);
            })(),
          });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'verifyFingerprint') {
        try {
          const ref = String(request.ref || '').trim();
          const fingerprint = String(request.fingerprint || '').trim();
          if (!ref || !fingerprint) {
            sendResponse({ success: false, error: 'ref and fingerprint are required' });
            return true;
          }
          const map = window.__claudeElementMap;
          const weak = map && map[ref];
          const el = weak && typeof weak.deref === 'function' ? weak.deref() : null;
          if (!el || !(el instanceof Element)) {
            sendResponse({ success: false, error: `ref "${ref}" not found or expired` });
            return true;
          }
          // 验证指纹：解析存储的指纹并与当前元素对比
          const parts = fingerprint.split('|');
          const storedTag = parts[0] || 'unknown';
          const currentTag = el.tagName ? String(el.tagName).toLowerCase() : 'unknown';
          // Tag 必须匹配
          if (storedTag !== currentTag) {
            sendResponse({ success: true, match: false });
            return true;
          }
          // 如果存储的指纹有 id，当前元素必须有相同的 id
          const storedIdPart = parts.find((p) => p.startsWith('id='));
          if (storedIdPart) {
            const storedId = storedIdPart.slice(3);
            const currentId = el.id ? String(el.id).trim() : '';
            if (storedId !== currentId) {
              sendResponse({ success: true, match: false });
              return true;
            }
          }
          sendResponse({ success: true, match: true });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
      if (request && request.action === 'focusByRef') {
        try {
          const ref = String(request.ref || '');
          const map = window.__claudeElementMap || {};
          const weak = map[ref];
          const el = weak && typeof weak.deref === 'function' ? weak.deref() : null;
          if (!el || !(el instanceof Element)) {
            sendResponse({ success: false, error: `ref "${ref}" not found or expired` });
            return true;
          }
          try {
            /** @type {HTMLElement} */ (el).scrollIntoView({
              behavior: 'instant',
              block: 'center',
              inline: 'nearest',
            });
          } catch {}
          try {
            /** @type {HTMLElement} */ (el).focus && /** @type {HTMLElement} */ (el).focus();
          } catch {}
          sendResponse({ success: true });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
          return true;
        }
      }
    } catch (e) {
      sendResponse({ success: false, error: e && e.message ? e.message : String(e) });
      return true;
    }
    return false;
  });

  console.log('Accessibility tree helper script loaded');
  // Cross-frame bridge: child listens for ensure-ref requests from parent (composite selector)
  try {
    window.addEventListener(
      'message',
      (ev) => {
        try {
          const data = ev && ev.data;
          // Handle hover-ref bridge requests from parent frame
          if (data && data.type === 'rr-bridge-hover-ref') {
            handleHoverForRef(data.ref)
              .then((result) => {
                ev.source?.postMessage(
                  { type: 'rr-bridge-hover-ref-result', reqId: data.reqId, result },
                  '*',
                );
              })
              .catch((error) => {
                ev.source?.postMessage(
                  {
                    type: 'rr-bridge-hover-ref-result',
                    reqId: data.reqId,
                    result: { success: false, error: error?.message || String(error) },
                  },
                  '*',
                );
              });
            return;
          }
          if (!data || data.type !== 'rr-bridge-ensure-ref') return;
          const { reqId, selector, useText, isXPath, tagName } = data || {};
          const respond = (payload) => {
            try {
              ev.source &&
                ev.source.postMessage(
                  { type: 'rr-bridge-ensure-ref-result', reqId, ...payload },
                  '*',
                );
            } catch {}
          };
          try {
            const sel = String(selector || '').trim();
            const limitTag = String(tagName || '')
              .trim()
              .toUpperCase();
            let el = null;
            if (useText && sel) {
              const normalize = (s) =>
                String(s || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .toLowerCase();
              const query = normalize(sel);
              const bigrams = (s) => {
                const arr = [];
                for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
                return arr;
              };
              const dice = (a, b) => {
                if (!a || !b) return 0;
                const A = bigrams(a),
                  B = bigrams(b);
                if (!A.length || !B.length) return 0;
                let inter = 0;
                const m = new Map();
                for (const t of A) m.set(t, (m.get(t) || 0) + 1);
                for (const t of B) {
                  const c = m.get(t) || 0;
                  if (c > 0) {
                    inter++;
                    m.set(t, c - 1);
                  }
                }
                return (2 * inter) / (A.length + B.length);
              };
              let best = { el: null, score: 0 };
              const stack = [document.documentElement];
              while (stack.length) {
                const node = stack.pop();
                if (!node || !(node instanceof Element)) continue;
                try {
                  if (limitTag && String(node.tagName || '').toUpperCase() !== limitTag) {
                  } else {
                    const cs = window.getComputedStyle(node);
                    if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') {
                      const rect = node.getBoundingClientRect();
                      if (rect.width > 0 && rect.height > 0) {
                        const txt = normalize(node.textContent || '');
                        if (txt) {
                          if (txt.includes(query)) {
                            el = node;
                            break;
                          }
                          const sc = dice(txt, query);
                          if (sc > best.score) best = { el: node, score: sc };
                        }
                      }
                    }
                  }
                } catch {}
                try {
                  const children = node.children || [];
                  for (let i = 0; i < children.length; i++) stack.push(children[i]);
                  const sr = node.shadowRoot;
                  if (sr && sr.children)
                    for (let i = 0; i < sr.children.length; i++) stack.push(sr.children[i]);
                } catch {}
              }
              if (!el && best.el) el = best.el;
            } else if (isXPath) {
              if (!sel) {
                respond({ success: false, error: 'selector is required' });
                return;
              }
              const allowMultiple = !!data.allowMultiple;
              const result = queryXPathWithUniquenessCheck(sel, allowMultiple);
              if (result.error) {
                respond({ success: false, error: result.error });
                return;
              }
              if (result.matchCount === 0) {
                respond({ success: false, error: `Selector "${sel}" not found in child frame` });
                return;
              }
              if (!allowMultiple && result.matchCount > 1) {
                respond({
                  success: false,
                  error: `Selector "${sel}" matched multiple elements inside frame. Please refine the selector to match only one element.`,
                });
                return;
              }
              el = result.element;
            } else {
              if (!sel) {
                respond({ success: false, error: 'selector is required' });
                return;
              }
              const allowMultiple = !!data.allowMultiple;
              const result = querySelectorWithUniquenessCheck(sel, allowMultiple);
              if (result.error) {
                respond({ success: false, error: result.error });
                return;
              }
              if (result.matchCount === 0) {
                respond({ success: false, error: `Selector "${sel}" not found in child frame` });
                return;
              }
              if (!allowMultiple && result.matchCount > 1) {
                respond({
                  success: false,
                  error: `Selector "${sel}" matched multiple elements inside frame. Please refine the selector to match only one element.`,
                });
                return;
              }
              el = result.element;
            }
            if (!el || !(el instanceof Element)) {
              respond({ success: false, error: 'Element not found in child frame' });
              return;
            }
            if (!window.__claudeElementMap) window.__claudeElementMap = {};
            if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
            const refId = ensureRef(el);
            const rect = el.getBoundingClientRect();
            respond({
              success: true,
              ref: refId,
              center: {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
              },
              href: String(location && location.href ? location.href : ''),
            });
          } catch (e) {
            respond({ success: false, error: String(e && e.message ? e.message : e) });
          }
        } catch {}
      },
      true,
    );
  } catch {}
})();
