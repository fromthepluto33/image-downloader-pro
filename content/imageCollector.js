/**
 * Image Downloader Pro — сбор изображений со страницы.
 */
window.IDP = window.IDP || {};

(function (exports) {
  const { querySelectorAllShadows, getExtFromUrl } = window.IDP;
  const { normalizeFormat } = window.IDPCommon;

  async function fetchSize(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) {
        const len = resp.headers.get('content-length');
        if (len) return parseInt(len, 10);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function collectAllImages() {
    const images = [];
    const processed = new Set();

    function addImage(url, width, height, el) {
      if (!url || !url.startsWith('http') || processed.has(url)) return;
      processed.add(url);
      const ext = normalizeFormat(getExtFromUrl(url) || 'jpg');
      images.push({
        url,
        width: width || 0,
        height: height || 0,
        ext,
        size: null,
        el: el || null
      });
    }

    function scanImg(img) {
      const src = img.src || img.getAttribute('src') || img.currentSrc;
      if (src) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      if (img.srcset) {
        img.srcset.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          if (url) addImage(url, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
        });
      }
    }

    document.querySelectorAll('img').forEach(scanImg);

    try {
      for (const img of document.images) scanImg(img);
    } catch {
      /* ignore */
    }

    try {
      querySelectorAllShadows('img').forEach(scanImg);
    } catch {
      /* ignore */
    }

    document.querySelectorAll('source[srcset]').forEach((source) => {
      source.srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        if (url) addImage(url, 0, 0, source);
      });
    });

    document.querySelectorAll('video[poster]').forEach((video) => {
      if (video.poster) {
        addImage(video.poster, video.videoWidth || video.width, video.videoHeight || video.height, video);
      }
    });

    document.querySelectorAll('input[type="image"]').forEach((input) => {
      if (input.src) addImage(input.src, 0, 0, input);
    });

    document.querySelectorAll('*').forEach((el) => {
      try {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') return;
        const matches = bg.match(/url\(["']?(.*?)["']?\)/g);
        if (!matches) return;
        matches.forEach((m) => {
          const urlMatch = m.match(/url\(["']?(.*?)["']?\)/);
          if (!urlMatch) return;
          let url = urlMatch[1];
          if (url && !url.startsWith('http')) {
            try { url = new URL(url, window.location.href).href; } catch { /* ignore */ }
          }
          if (url) addImage(url, el.clientWidth, el.clientHeight, el);
        });
      } catch {
        /* ignore */
      }
    });

    document.querySelectorAll('a[href]').forEach((a) => {
      if (/\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)(\?|$)/i.test(a.href)) {
        addImage(a.href, 0, 0, a);
      }
    });

    const regex = /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const matches = walker.currentNode.nodeValue?.match(regex);
      if (matches) matches.forEach((url) => addImage(url, 0, 0, null));
    }

    images._ready = (async () => {
      for (const img of images) {
        if (img.size === null) img.size = await fetchSize(img.url);
      }
      if (exports.applyFilters) exports.applyFilters();
    })();

    return images;
  }

  exports.collectAllImages = collectAllImages;
})(window.IDP);
