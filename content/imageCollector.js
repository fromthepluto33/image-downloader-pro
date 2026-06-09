/**
 * Image Downloader Pro — Image Collector
 */
window.IDP = window.IDP || {};

(function(exports) {
  const U = window.IDP;

  /**
   * Запрашивает размер файла через HEAD-запрос (без загрузки тела).
   */
  async function fetchSize(url) {
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) {
        const len = resp.headers.get('content-length');
        if (len) return parseInt(len, 10);
      }
    } catch (e) {}
    return null;
  }

  function collectAllImages() {
    const images = [];
    const processed = new Set();

    function addImage(url, width, height, el) {
      if (!url || processed.has(url)) return;
      processed.add(url);
      images.push({
        url,
        width: width || 0,
        height: height || 0,
        ext: (url.split('.').pop() || 'jpg').toLowerCase().substring(0, 5),
        size: null,
        el: el || null
      });
    }

    // 1. Plain <img> elements + srcset
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('src') || img.currentSrc;
      if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      if (img.srcset) {
        img.srcset.split(',').forEach(srcsetPart => {
          const url = srcsetPart.trim().split(' ')[0];
          if (url && url.startsWith('http')) addImage(url, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
        });
      }
    });

    // 2. document.images
    try {
      for (const img of document.images) {
        const src = img.src || img.currentSrc;
        if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      }
    } catch (e) {}

    // 3. Shadow DOM images
    try {
      const shadowImgs = U.querySelectorAllShadows('img');
      shadowImgs.forEach(img => {
        const src = img.src || img.getAttribute('src') || img.currentSrc;
        if (src && src.startsWith('http')) addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img);
      });
    } catch (e) {}

    // 4. <source> elements
    document.querySelectorAll('source').forEach(source => {
      if (source.srcset) {
        source.srcset.split(',').map(s => s.trim().split(' ')[0]).forEach(url => {
          if (url && url.startsWith('http')) addImage(url, 0, 0, source);
        });
      }
    });

    // 5. <video poster>
    document.querySelectorAll('video').forEach(video => {
      if (video.poster && video.poster.startsWith('http')) addImage(video.poster, video.videoWidth || video.width, video.videoHeight || video.height, video);
    });

    // 6. <input type="image">
    document.querySelectorAll('input[type="image"]').forEach(input => {
      if (input.src && input.src.startsWith('http')) addImage(input.src, 0, 0, input);
    });

    // 7. Inline SVG
    document.querySelectorAll('svg').forEach(svg => {
      try {
        const svgString = U.getCompleteSVGString(svg);
        const dataUrl = U.svgToBase64(svgString);
        if (dataUrl) addImage(dataUrl, svg.width?.baseVal?.value || 0, svg.height?.baseVal?.value || 0, svg);
      } catch (e) {}
    });

    // 8. CSS background images
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
                  try { url = new URL(url, window.location.href).href; } catch (e) {}
                }
                if (url && url.startsWith('http')) addImage(url, el.clientWidth, el.clientHeight, el);
              }
            });
          }
        }
      } catch (e) {}
    });

    // 9. Direct links to image files
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (/\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)$/i.test(href)) {
        addImage(href, 0, 0, a);
      }
    });

    // 10. Image URLs embedded in page HTML
    try {
      const bodyHTML = document.body.innerHTML;
      const urls = bodyHTML.match(/https?:\/\/[^"'\s]+\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)/gi) || [];
      urls.forEach(url => {
        if (url && url.startsWith('http')) addImage(url, 0, 0, null);
      });
    } catch (e) {}

    // Запускаем фоновое получение размеров
    (async () => {
      for (const img of images) {
        if (img.size === null) {
          img.size = await fetchSize(img.url);
        }
      }
      // Обновляем список, если панель открыта
      if (window.IDP.applyFilters) {
        window.IDP.applyFilters();
      }
    })();

    return images;
  }

  exports.collectAllImages = collectAllImages;

})(window.IDP);