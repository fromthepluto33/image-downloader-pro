/**
 * Image Downloader Pro — Utility Functions
 * Provides sanitization, URL parsing, SVG handling, and Shadow DOM traversal.
 * All functions are attached to the global `IDP` namespace.
 */
window.IDP = window.IDP || {};

(function(exports) {

  function safeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function safeText(str) {
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
  }

  function sanitizeFilename(name) {
    return name.replace(/[~@#$%^\-_(){}\[\]'`\/\\:*?<>|]/g, '_');
  }

  function getNameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split('/').pop();
      return name || null;
    } catch (e) {
      return null;
    }
  }

  function getExtFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split('/').pop();
      if (!name) return null;
      const parts = name.split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '? KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function truncateUrl(url, maxLen = 50) {
    if (!url) return '';
    return url.length > maxLen ? url.substring(0, maxLen) + '…' : url;
  }

  function svgToBase64(svgText) {
    if (!svgText) return null;
    try {
      const bytes = new TextEncoder().encode(svgText);
      const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
      return 'data:image/svg+xml;base64,' + btoa(binary);
    } catch (e) {
      return null;
    }
  }

  function getCompleteSVGString(svg) {
    const svgClone = svg.cloneNode(true);
    const referencedIds = new Set();

    function extractIdFromUrl(url) {
      if (!url) return null;
      const m = url.match(/url\(['"]?#([^'")]+)['"]?\)/);
      return m ? m[1] : null;
    }

    function collectReferencedIds(element) {
      const href = element.getAttribute('href') || element.getAttribute('xlink:href');
      if (href && href.startsWith('#')) {
        element.removeAttribute('xlink:href');
        element.setAttribute('href', href);
        const id = href.substring(1);
        if (id) referencedIds.add(id);
      }
      const style = element.getAttribute('style') || '';
      const styleUrlId = extractIdFromUrl(style);
      if (styleUrlId) referencedIds.add(styleUrlId);
      try {
        const cs = window.getComputedStyle(element);
        [cs.clipPath, cs.mask, cs.filter].forEach(prop => {
          if (prop && prop !== 'none') {
            const id = extractIdFromUrl(prop);
            if (id) referencedIds.add(id);
          }
        });
      } catch (e) {}
      Array.from(element.children).forEach(child => collectReferencedIds(child));
    }

    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    collectReferencedIds(svgClone);

    const referencedElements = [];
    referencedIds.forEach(id => {
      const element = document.getElementById(id);
      if (element && element !== svg && !svg.contains(element)) {
        const clone = element.cloneNode(true);
        clone.setAttribute('id', id);
        referencedElements.push(clone);
      }
    });

    if (referencedElements.length > 0) {
      let defs = svgClone.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgClone.insertBefore(defs, svgClone.firstChild);
      }
      referencedElements.forEach(elem => {
        try {
          if (!defs.querySelector(`#${elem.id}`)) defs.appendChild(elem);
        } catch (e) {}
      });
    }
    return svgClone.outerHTML;
  }

  function querySelectorAllShadows(selector, el = document.body) {
    const childShadows = Array.from(el.querySelectorAll('*'))
      .map(el => el.shadowRoot)
      .filter(Boolean);
    const childResults = childShadows.map(child => querySelectorAllShadows(selector, child));
    const results = Array.from(el.querySelectorAll(selector));
    return results.concat(childResults).flat();
  }

  Object.assign(exports, {
    safeAttr, safeText, sanitizeFilename, getNameFromUrl, getExtFromUrl,
    formatSize, truncateUrl, svgToBase64, getCompleteSVGString, querySelectorAllShadows
  });

})(window.IDP);