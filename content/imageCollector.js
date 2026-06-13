/**
 * Image Downloader Pro — Image Collector
 */
window.IDP = window.IDP || {};

(function(exports) {
  function querySelectorAllShadows(selector, el) {
    el = el || document.body;
    const childShadows = Array.from(el.querySelectorAll('*'))
      .map(el => el.shadowRoot)
      .filter(Boolean);
    const childResults = childShadows.map(child => querySelectorAllShadows(selector, child));
    const results = Array.from(el.querySelectorAll(selector));
    return results.concat(childResults).flat();
  }

  async function fetchSize(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) {
        const len = resp.headers.get('content-length');
        if (len) return parseInt(len, 10);
      }
    } catch(e) {}
    return null;
  }

  function getFileExtension(url) {
    if (!url || url.startsWith('data:')) return 'jpg';
    try {
      let cleanUrl = url.split('?')[0].split('#')[0];
      let filename = cleanUrl.split('/').pop();
      if (filename && filename.includes('.')) {
        let ext = filename.split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp','bmp','ico','svg','tif','apng','jfif','pjpeg','pjp'].includes(ext)) {
          return ext;
        }
      }
    } catch(e) {}
    return 'jpg';
  }

  function collectAllImages(options) {
    options = options || {};
    const images = [];
    const processed = new Set();
    const onProgress = options.onProgress || null;

    function addImage(url, width, height, el) {
      if (!url || processed.has(url)) return;
      processed.add(url);
      let ext = getFileExtension(url);
      images.push({
        url: url,
        width: width || 0,
        height: height || 0,
        ext: ext,
        size: null,
        el: el || null
      });
    }

    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('src') || img.currentSrc;
      if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      if (img.srcset) {
        img.srcset.split(',').forEach(part => {
          const url = part.trim().split(' ')[0];
          if (url && url.startsWith('http')) addImage(url, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
        });
      }
    });

    try {
      for (const img of document.images) {
        const src = img.src || img.currentSrc;
        if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      }
    } catch(e) {}

    try {
      const shadowImgs = querySelectorAllShadows('img');
      shadowImgs.forEach(img => {
        const src = img.src || img.getAttribute('src') || img.currentSrc;
        if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      });
    } catch(e) {}

    document.querySelectorAll('source').forEach(source => {
      if (source.srcset) {
        source.srcset.split(',').map(s => s.trim().split(' ')[0]).forEach(url => {
          if (url && url.startsWith('http')) addImage(url, 0, 0, source);
        });
      }
    });

    document.querySelectorAll('video').forEach(video => {
      if (video.poster && video.poster.startsWith('http')) addImage(video.poster, video.videoWidth || video.width, video.videoHeight || video.height, video);
    });

    document.querySelectorAll('input[type="image"]').forEach(input => {
      if (input.src && input.src.startsWith('http')) addImage(input.src, 0, 0, input);
    });

    document.querySelectorAll('*').forEach(el => {
      try {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          const matches = bg.match(/url\(["']?(.*?)["']?\)/g);
          if (matches) {
            matches.forEach(m => {
              const urlMatch = m.match(/url\(["']?(.*?)["']?\)/);
              if (urlMatch) {
                let url = urlMatch[1];
                if (url && !url.startsWith('http')) {
                  try { url = new URL(url, window.location.href).href; } catch(e) {}
                }
                if (url && url.startsWith('http')) addImage(url, el.clientWidth, el.clientHeight, el);
              }
            });
          }
        }
      } catch(e) {}
    });

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (/\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)$/i.test(href)) {
        addImage(href, 0, 0, a);
      }
    });

    function extractImageUrlsFromText() {
      const urls = [];
      const regex = /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)/gi;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const matches = node.nodeValue.match(regex);
        if (matches) urls.push.apply(urls, matches);
      }
      return urls;
    }
    const textUrls = extractImageUrlsFromText();
    textUrls.forEach(url => {
      if (url && url.startsWith('http')) addImage(url, 0, 0, null);
    });

    images._ready = (async () => {
      const sizePromises = images.map(async img => {
        if (img.size === null) img.size = await fetchSize(img.url);
      });
      const nonDataUrls = images.filter(entry => !entry.url.startsWith('data:'));
      let loaded = 0;
      const total = nonDataUrls.length;
      const dimensionPromises = nonDataUrls.map(entry => {
        return new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () => {
            if (probe.naturalWidth > entry.width || probe.naturalHeight > entry.height) {
              entry.width = probe.naturalWidth;
              entry.height = probe.naturalHeight;
            }
            loaded++;
            if (onProgress) onProgress(loaded, total);
            resolve();
          };
          probe.onerror = () => {
            loaded++;
            if (onProgress) onProgress(loaded, total);
            resolve();
          };
          probe.src = entry.url;
        });
      });
      await Promise.all([...sizePromises, ...dimensionPromises]);
      if (window.IDP.applyFilters) window.IDP.applyFilters();
    })();

    return images;
  }

  exports.collectAllImages = collectAllImages;
})(window.IDP);