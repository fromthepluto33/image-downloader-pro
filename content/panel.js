/**
 * Image Downloader Pro — Боковая панель (Content Script)
 * ПОЛНОСТЬЮ САМОДОСТАТОЧНЫЙ: утилиты, сборщик, выделение области — внутри.
 * Индикаторы прогресса для сбора размеров и создания архива.
 * Миниатюры 220px, ссылка сверху, метаданные в правом нижнем углу, кнопки снизу.
 * Клик по карточке переключает чекбокс.
 */
window.IDP = window.IDP || {};

(function(exports) {

  // ========== УТИЛИТЫ ==========
  function safeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function safeText(str) {
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
  }
  function sanitizeFilename(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return 'downloaded_images';
    return trimmed.replace(/[~@#$%^&*(){}[\]'`\/\\:?<>|"\s]/g, '_');
  }
  function formatSize(bytes) {
    if (!bytes) return '? KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function truncateUrl(url, maxLen) {
    maxLen = maxLen || 55;
    if (!url) return '';
    return url.length > maxLen ? url.substring(0, maxLen) + '…' : url;
  }
  function svgToBase64(svgText) {
    if (!svgText) return null;
    try {
      const bytes = new TextEncoder().encode(svgText);
      const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
      return 'data:image/svg+xml;base64,' + btoa(binary);
    } catch (e) { return null; }
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
          if (!defs.querySelector('#' + elem.id)) defs.appendChild(elem);
        } catch (e) {}
      });
    }
    return svgClone.outerHTML;
  }
  function querySelectorAllShadows(selector, el) {
    el = el || document.body;
    const childShadows = Array.from(el.querySelectorAll('*'))
      .map(el => el.shadowRoot)
      .filter(Boolean);
    const childResults = childShadows.map(child => querySelectorAllShadows(selector, child));
    const results = Array.from(el.querySelectorAll(selector));
    return results.concat(childResults).flat();
  }

  // ========== СБОР ИЗОБРАЖЕНИЙ ==========
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

  function collectAllImages(options = {}) {
    const images = [];
    const processed = new Set();
    const onProgress = options.onProgress || null;

    function addImage(url, width, height, el) {
      if (!url || processed.has(url)) return;
      processed.add(url);
      const entry = {
        url: url,
        width: width || 0,
        height: height || 0,
        ext: (url.split('.').pop() || 'jpg').toLowerCase().substring(0, 5),
        size: null,
        el: el || null
      };
      images.push(entry);
    }

    // 1..10 – сбор как обычно
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('src') || img.currentSrc;
      if (src && src.startsWith('http')) {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        addImage(src, w, h, img);
      }
      if (img.srcset) {
        img.srcset.split(',').forEach(part => {
          const url = part.trim().split(' ')[0];
          if (url && url.startsWith('http')) {
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            addImage(url, w, h, img);
          }
        });
      }
    });

    try {
      for (const img of document.images) {
        const src = img.src || img.currentSrc;
        if (src && src.startsWith('http')) {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          addImage(src, w, h, img);
        }
      }
    } catch (e) {}

    try {
      const shadowImgs = querySelectorAllShadows('img');
      shadowImgs.forEach(img => {
        const src = img.src || img.getAttribute('src') || img.currentSrc;
        if (src && src.startsWith('http')) {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          addImage(src, w, h, img);
        }
      });
    } catch (e) {}

    document.querySelectorAll('source').forEach(source => {
      if (source.srcset) {
        source.srcset.split(',').map(s => s.trim().split(' ')[0]).forEach(url => {
          if (url && url.startsWith('http')) addImage(url, 0, 0, source);
        });
      }
    });

    document.querySelectorAll('video').forEach(video => {
      if (video.poster && video.poster.startsWith('http')) {
        addImage(video.poster, video.videoWidth || video.width, video.videoHeight || video.height, video);
      }
    });

    document.querySelectorAll('input[type="image"]').forEach(input => {
      if (input.src && input.src.startsWith('http')) addImage(input.src, 0, 0, input);
    });

    document.querySelectorAll('svg').forEach(svg => {
      try {
        const svgString = getCompleteSVGString(svg);
        const dataUrl = svgToBase64(svgString);
        if (dataUrl) addImage(dataUrl, svg.width?.baseVal?.value || 0, svg.height?.baseVal?.value || 0, svg);
      } catch (e) {}
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
                  try { url = new URL(url, window.location.href).href; } catch (e) {}
                }
                if (url && url.startsWith('http')) {
                  addImage(url, el.clientWidth, el.clientHeight, el);
                }
              }
            });
          }
        }
      } catch (e) {}
    });

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (/\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)$/i.test(href)) {
        addImage(href, 0, 0, a);
      }
    });

    try {
      const bodyHTML = document.body.innerHTML;
      const urls = bodyHTML.match(/https?:\/\/[^"'\s]+\.(jpg|jpeg|png|gif|bmp|ico|webp|svg|tif|apng|jfif|pjpeg|pjp)/gi) || [];
      urls.forEach(url => {
        if (url && url.startsWith('http')) addImage(url, 0, 0, null);
      });
    } catch (e) {}

    // Асинхронное определение размеров с прогрессом
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
            if (onProgress) {
              try { onProgress(loaded, total); } catch (e) {}
            }
            resolve();
          };
          probe.onerror = () => {
            loaded++;
            if (onProgress) {
              try { onProgress(loaded, total); } catch (e) {}
            }
            resolve();
          };
          probe.src = entry.url;
        });
      });

      await Promise.all([...sizePromises, ...dimensionPromises]);

      if (exports.applyFilters) {
        exports.applyFilters();
      }
    })();

    return images;
  }

  // ========== ВЫДЕЛЕНИЕ ОБЛАСТИ ==========
  function startAreaSelection(fullImageList) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'z-index:2147483648;cursor:crosshair;background:rgba(0,0,0,0.15);';
      document.body.appendChild(overlay);

      let startX, startY, selectionDiv;
      let cleaned = false;

      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        overlay.removeEventListener('mousedown', onDown, true);
        overlay.removeEventListener('mousemove', onMove, true);
        overlay.removeEventListener('mouseup', finish, true);
        document.removeEventListener('keydown', onEscape, true);
        if (overlay.parentNode) overlay.remove();
        if (selectionDiv && selectionDiv.parentNode) selectionDiv.remove();
      }

      const onDown = e => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        selectionDiv = document.createElement('div');
        selectionDiv.style.cssText =
          'position:fixed;border:2px dashed red;background:rgba(255,0,0,0.1);' +
          'pointer-events:none;z-index:2147483649;';
        overlay.appendChild(selectionDiv);
      };

      const onMove = e => {
        if (!selectionDiv) return;
        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        selectionDiv.style.left = left + 'px';
        selectionDiv.style.top = top + 'px';
        selectionDiv.style.width = width + 'px';
        selectionDiv.style.height = height + 'px';
      };

      const finish = () => {
        const rect = selectionDiv ? selectionDiv.getBoundingClientRect() : null;
        cleanup();

        if (!rect || (rect.width === 0 && rect.height === 0)) {
          return resolve([]);
        }

        const intersecting = [];

        for (const img of fullImageList) {
          if (img.el && typeof img.el.getBoundingClientRect === 'function') {
            try {
              const er = img.el.getBoundingClientRect();
              if (er.width === 0 || er.height === 0) continue;
              if (
                er.right > rect.left &&
                er.left < rect.right &&
                er.bottom > rect.top &&
                er.top < rect.bottom
              ) {
                intersecting.push({
                  url: img.url,
                  width: img.width,
                  height: img.height,
                  ext: img.ext,
                  size: null,
                  el: img.el
                });
              }
            } catch (e) {}
          }
        }

        resolve(intersecting);
      };

      const onEscape = e => {
        if (e.key === 'Escape') {
          cleanup();
          resolve([]);
        }
      };

      overlay.addEventListener('mousedown', onDown, true);
      overlay.addEventListener('mousemove', onMove, true);
      overlay.addEventListener('mouseup', finish, true);
      overlay.addEventListener('dragstart', e => e.preventDefault());
      document.addEventListener('keydown', onEscape, true);
    });
  }

  // ========== СОСТОЯНИЕ ПАНЕЛИ ==========
  let allImages = [];
  let filteredImages = [];
  let selected = new Set();
  let sortMode = 'index';
  let panelRoot = null;
  let listContainer = null;
  let statusEl = null;
  let isVisible = false;
  const MIN_WIDTH = 450;
  const MAX_WIDTH = 1200;
  let currentPanelWidth = MIN_WIDTH;

  // ========== PROGRESS BAR ==========
  function showProgress(text) {
    const container = document.getElementById('__idp_progress_container');
    const textEl = document.getElementById('__idp_progress_text');
    const fillEl = document.getElementById('__idp_progress_fill');
    if (container) {
      container.style.display = 'block';
      fillEl.style.width = '0%';
    }
    if (textEl) textEl.textContent = text || 'Загрузка…';
  }

  function updateProgress(percent, text) {
    const fillEl = document.getElementById('__idp_progress_fill');
    const textEl = document.getElementById('__idp_progress_text');
    if (fillEl) fillEl.style.width = Math.min(100, Math.round(percent)) + '%';
    if (textEl && text) textEl.textContent = text;
  }

  function hideProgress() {
    const container = document.getElementById('__idp_progress_container');
    if (container) container.style.display = 'none';
  }

  // ========== HTML ПАНЕЛИ ==========
  function buildPanelHTML() {
    return `
    <div id="__idp_panel_root" class="idp-panel-hidden">
      <div class="idp-resize-handle" id="__idp_resize_handle"></div>
      <div class="idp-panel-inner">
        <div class="idp-header">
          <div style="display:flex; align-items:center; gap:4px;">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA5ElEQVR4AdyQMQrCQBBFJwFBT2CVVIKVhdgFBO2tBLuAkCKllTYB2xRGPICtF7C1FPEEVmKlASGFIBaCIsT5K4GQrEWClbBv98/Mzt9hVd3wTN2YnJgwI9zjmSpR6BKRxmRd3BO6bJCrOXpMg0EU5Dp/b1Crlmk8aEtBLTmmdIJ+t07A6jUIQINkM2IVW5zdPqBKayZ4PF8Eohi1+F3olAGSWfhXg6HdpON2RKViQQCNnOxvpH8wnW/IdpZ0ud4F0Mh9M/BlhdX6QB1rIYCW3eGczxMoDgSTWufgRiBV+CT4YcV5AwAA///7faflAAAABklEQVQDAMOhYLM9tZRAAAAAAElFTkSuQmCC" width="16" height="16" style="display:block;">
            <span class="idp-title" style="line-height:1;">Image Downloader</span>
          </div>
          <div class="idp-header-actions">
            <button class="idp-btn idp-btn-icon" id="__idp_btn_area" title="Выделить область">🖼️ Область</button>
            <button class="idp-btn idp-btn-icon" id="__idp_btn_refresh" title="Обновить">⟳</button>
            <button class="idp-btn idp-btn-icon" id="__idp_btn_settings" title="Настройки">⚙️</button>
            <button class="idp-btn idp-btn-icon" id="__idp_btn_close" title="Закрыть">✕</button>
          </div>
        </div>
        <div class="idp-filters">
          <select id="__idp_filter_type" class="idp-select">
            <option value="all">Форматы</option>
            <option value="jpg">JPG</option><option value="jpeg">JPEG</option>
            <option value="png">PNG</option><option value="webp">WebP</option>
            <option value="gif">GIF</option><option value="svg">SVG</option>
            <option value="bmp">BMP</option><option value="ico">ICO</option>
          </select>
          <select id="__idp_filter_size" class="idp-select">
            <option value="all">Размеры</option>
            <option value="small">Маленькие (&lt;200px)</option>
            <option value="medium">Средние</option>
            <option value="large">Большие (&gt;700px)</option>
          </select>
          <select id="__idp_filter_layout" class="idp-select">
            <option value="all">Макеты</option>
            <option value="square">Квадратные</option>
            <option value="wide">Горизонтальные</option>
            <option value="tall">Вертикальные</option>
          </select>
          <div style="position:relative; flex-shrink:0;">
            <button class="idp-btn idp-btn-sm" id="__idp_btn_url_filter">URL</button>
            <input type="text" id="__idp_filter_url" class="idp-input" placeholder="Введите часть URL" style="display:none; position:absolute; top:100%; right:0; width:220px; margin-top:2px; z-index:10; background:#202124; border:1px solid #5f6368; border-radius:4px; padding:5px 8px; font-size:11px; color:#e8eaed;">
          </div>
          <button class="idp-btn idp-btn-sm" id="__idp_btn_sort">⇅</button>
        </div>
        <div id="__idp_progress_container" style="display:none; padding:8px 12px; background:#292a2d; border-bottom:1px solid #3c4043;">
          <div class="idp-progress-bar">
            <div id="__idp_progress_fill" class="idp-progress-fill" style="width:0%;"></div>
          </div>
          <div id="__idp_progress_text" class="idp-progress-text" style="text-align:center; font-size:11px; color:#9aa0a6; margin-top:4px;"></div>
        </div>
        <div class="idp-toolbar">
          <button class="idp-btn idp-btn-primary" id="__idp_btn_select_all">☐ Все</button>
          <button class="idp-btn idp-btn-success" id="__idp_btn_download">⬇ Скачать (<span id="__idp_sel_count">0</span>)</button>
        </div>
        <div class="idp-list" id="__idp_list"></div>
        <div class="idp-status" id="__idp_status">Готов</div>
      </div>
      <div class="idp-settings-overlay" id="__idp_settings_overlay" style="display:none;">
        <div class="idp-settings-panel">
          <div class="idp-settings-header">
            <span>Настройки</span>
            <button class="idp-btn idp-btn-icon" id="__idp_btn_close_settings">✕</button>
          </div>
          <div class="idp-settings-body">
            <label class="idp-label">Папка для сохранения</label>
            <input type="text" id="__idp_setting_folder" class="idp-input" placeholder="downloaded_images">
            <label class="idp-label">Шаблон имени файла</label>
            <select id="__idp_setting_name_pattern" class="idp-select" style="width:100%;">
              <option value="custom">Переименовать</option>
              <option value="original">Оригинальное имя</option>
              <option value="numbered">image_N</option>
            </select>
            <label class="idp-label" id="__idp_label_custom_name" style="display:none;">Своё имя</label>
            <input type="text" id="__idp_setting_custom_name" class="idp-input" placeholder="image" style="display:none;">
            <label class="idp-label">Формат</label>
            <select id="__idp_setting_format" class="idp-select" style="width:100%;">
              <option value="original">Оригинальный</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
            <button class="idp-btn idp-btn-primary" id="__idp_btn_save_settings" style="margin-top:12px;width:100%;">Сохранить</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ========== ПОДЖАТИЕ СТРАНИЦЫ ==========
  function setPageMargin(width) {
    document.body.style.transition = 'margin-right 0.2s ease';
    document.body.style.marginRight = width > 0 ? width + 'px' : '';
  }

  // ========== РЕСАЙЗ ==========
  function applyPanelWidth(width) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    panelRoot.style.width = clamped + 'px';
    currentPanelWidth = clamped;
    setPageMargin(clamped);
  }

  function initResize() {
    const handle = document.getElementById('__idp_resize_handle');
    if (!handle) return;
    let startX, startWidth;
    const onMouseMove = (e) => applyPanelWidth(startWidth + (startX - e.clientX));
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panelRoot.getBoundingClientRect().width;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  // ========== РЕНДЕР СПИСКА ==========
  function renderList() {
    if (!listContainer) return;
    listContainer.innerHTML = '';
    if (!filteredImages.length) {
      listContainer.innerHTML = '<div class="idp-empty">Изображения не найдены</div>';
      return;
    }
    filteredImages.forEach(img => {
      const isSel = selected.has(img.url);
      const card = document.createElement('div');
      card.className = 'idp-card' + (isSel ? ' idp-card-selected' : '');
      card.innerHTML = `
        <div class="idp-card-check">
          <input type="checkbox" class="idp-checkbox" data-url="${safeAttr(img.url)}" ${isSel ? 'checked' : ''}>
        </div>
        <div class="idp-card-top">
          <a class="idp-card-url" href="${safeAttr(img.url)}" target="_blank" title="${safeAttr(img.url)}">${safeText(truncateUrl(img.url, 55))}</a>
        </div>
        <div class="idp-card-image-wrap">
          <img class="idp-card-img" src="${safeAttr(img.url)}" loading="lazy">
          <div class="idp-card-overlay-meta">
            <span class="idp-meta-badge">${img.width}×${img.height}</span>
            <span class="idp-meta-badge">${formatSize(img.size)}</span>
            <span class="idp-meta-badge">${img.ext.toUpperCase()}</span>
          </div>
        </div>
        <div class="idp-card-actions">
          <button class="idp-btn idp-btn-sm idp-action-open" data-url="${safeAttr(img.url)}">🔗</button>
          <button class="idp-btn idp-btn-sm idp-action-dl" data-url="${safeAttr(img.url)}">⬇</button>
          <button class="idp-btn idp-btn-sm idp-action-search" data-url="${safeAttr(img.url)}">🔍</button>
        </div>`;
      listContainer.appendChild(card);
    });
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const countEl = document.getElementById('__idp_sel_count');
    if (countEl) countEl.textContent = selected.size;
    const btn = document.getElementById('__idp_btn_select_all');
    if (btn) {
      const allSel = filteredImages.length > 0 && filteredImages.every(img => selected.has(img.url));
      btn.textContent = allSel ? '☐ Снять' : '☐ Все';
    }
  }

  // ========== ФИЛЬТРАЦИЯ ==========
  function applyFilters() {
    let filtered = [...allImages];
    const typeEl = document.getElementById('__idp_filter_type');
    const sizeEl = document.getElementById('__idp_filter_size');
    const layoutEl = document.getElementById('__idp_filter_layout');
    const urlEl = document.getElementById('__idp_filter_url');
    const typeVal = typeEl ? (typeEl.value || 'all') : 'all';
    const sizeVal = sizeEl ? (sizeEl.value || 'all') : 'all';
    const layoutVal = layoutEl ? (layoutEl.value || 'all') : 'all';
    const urlQuery = urlEl ? urlEl.value.trim().toLowerCase() : '';
    if (typeVal !== 'all') filtered = filtered.filter(img => (img.ext || '').toLowerCase() === typeVal);
    if (sizeVal === 'small') filtered = filtered.filter(img => Math.max(img.width, img.height) < 200);
    else if (sizeVal === 'medium') filtered = filtered.filter(img => { const max = Math.max(img.width, img.height); return max >= 200 && max <= 700; });
    else if (sizeVal === 'large') filtered = filtered.filter(img => Math.max(img.width, img.height) > 700);
    if (layoutVal === 'square') filtered = filtered.filter(img => { if (!img.width || !img.height) return false; const ratio = img.width / img.height; return ratio >= 0.8 && ratio <= 1.25; });
    else if (layoutVal === 'wide') filtered = filtered.filter(img => img.width / img.height > 1.25);
    else if (layoutVal === 'tall') filtered = filtered.filter(img => img.height / img.width > 1.25);
    if (urlQuery) filtered = filtered.filter(img => img.url.toLowerCase().includes(urlQuery));
    if (sortMode === 'pixels') filtered.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    filteredImages = filtered;
    renderList();
  }

  // ========== ЗАГРУЗКА С ПРОГРЕССОМ ==========
  async function collectAndShow() {
    if (statusEl) statusEl.textContent = 'Сбор изображений…';
    showProgress('Сбор изображений…');
    try {
      allImages = collectAllImages({
        onProgress: (loaded, total) => {
          const percent = total > 0 ? (loaded / total) * 100 : 100;
          updateProgress(percent, `Определение размеров: ${loaded}/${total}`);
        }
      });
      if (allImages._ready) await allImages._ready;
      hideProgress();
      if (statusEl) statusEl.textContent = `Найдено: ${allImages.length}`;
      applyFilters();
    } catch (e) {
      hideProgress();
      if (statusEl) statusEl.textContent = 'Ошибка сбора';
      console.error(e);
    }
  }

  // ========== ОБЛАСТЬ ==========
  async function startAreaMode() {
    if (statusEl) statusEl.textContent = 'Выделите область на странице…';
    panelRoot.classList.add('idp-panel-minimized');
    try {
      const areaImages = await startAreaSelection(allImages);
      panelRoot.classList.remove('idp-panel-minimized');
      if (areaImages.length > 0) {
        allImages = areaImages;
        selected.clear();
        applyFilters();
        if (statusEl) statusEl.textContent = `Выделено: ${areaImages.length}`;
      } else {
        if (statusEl) statusEl.textContent = 'Ничего не выделено';
      }
    } catch (e) {
      panelRoot.classList.remove('idp-panel-minimized');
      if (statusEl) statusEl.textContent = 'Ошибка выделения';
    }
  }

  // ========== СКАЧИВАНИЕ С ПРОГРЕССОМ ==========
  function downloadSelected() {
    const urls = [...selected];
    if (!urls.length) {
      if (statusEl) statusEl.textContent = 'Ничего не выбрано';
      return;
    }
    showProgress('Создание архива…');
    updateProgress(0, 'Загрузка файлов...');
    chrome.runtime.sendMessage({ action: 'downloadImages', urls: urls }, () => {
      hideProgress();
      if (statusEl) statusEl.textContent = 'Готово';
    });
  }

  // ========== НАСТРОЙКИ ==========
  async function loadSettings() {
    const defaults = {
      folderName: 'downloaded_images',
      fileNamePattern: 'custom',
      customFileName: 'image',
      convertTo: 'original'
    };
    try {
      const settings = await chrome.storage.sync.get(defaults);
      const folderEl = document.getElementById('__idp_setting_folder');
      if (folderEl) folderEl.value = settings.folderName || defaults.folderName;
      const patternEl = document.getElementById('__idp_setting_name_pattern');
      if (patternEl) patternEl.value = settings.fileNamePattern || defaults.fileNamePattern;
      const customEl = document.getElementById('__idp_setting_custom_name');
      if (customEl) customEl.value = settings.customFileName || defaults.customFileName;
      const formatEl = document.getElementById('__idp_setting_format');
      if (formatEl) formatEl.value = settings.convertTo || defaults.convertTo;
      toggleCustomNameInput();
    } catch (e) {}
  }

  function toggleCustomNameInput() {
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const customEl = document.getElementById('__idp_setting_custom_name');
    const labelEl = document.getElementById('__idp_label_custom_name');
    if (patternEl && customEl && labelEl) {
      const isCustom = patternEl.value === 'custom';
      customEl.style.display = isCustom ? 'block' : 'none';
      labelEl.style.display = isCustom ? 'block' : 'none';
    }
  }

  async function saveSettings() {
    const folderInput = document.getElementById('__idp_setting_folder');
    const customNameInput = document.getElementById('__idp_setting_custom_name');
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const formatEl = document.getElementById('__idp_setting_format');
    const settings = {
      folderName: (folderInput && folderInput.value.trim()) ? folderInput.value.trim() : 'downloaded_images',
      fileNamePattern: patternEl ? (patternEl.value || 'custom') : 'custom',
      customFileName: (customNameInput && customNameInput.value.trim()) ? customNameInput.value.trim() : 'image',
      convertTo: formatEl ? (formatEl.value || 'original') : 'original'
    };
    await chrome.storage.sync.set(settings);
    document.getElementById('__idp_settings_overlay').style.display = 'none';
  }

  // ========== ИНИЦИАЛИЗАЦИЯ ==========
  function bindEvents() {
    document.getElementById('__idp_btn_refresh')?.addEventListener('click', collectAndShow);
    document.getElementById('__idp_btn_area')?.addEventListener('click', startAreaMode);
    document.getElementById('__idp_btn_close')?.addEventListener('click', hidePanel);
    document.getElementById('__idp_btn_select_all')?.addEventListener('click', toggleSelectAll);
    document.getElementById('__idp_btn_download')?.addEventListener('click', downloadSelected);
    document.getElementById('__idp_btn_settings')?.addEventListener('click', () => {
      document.getElementById('__idp_settings_overlay').style.display = 'flex';
      loadSettings();
    });
    document.getElementById('__idp_btn_close_settings')?.addEventListener('click', () => {
      document.getElementById('__idp_settings_overlay').style.display = 'none';
    });
    document.getElementById('__idp_btn_save_settings')?.addEventListener('click', saveSettings);
    document.getElementById('__idp_btn_sort')?.addEventListener('click', () => {
      sortMode = sortMode === 'index' ? 'pixels' : 'index';
      applyFilters();
    });
    document.getElementById('__idp_setting_name_pattern')?.addEventListener('change', toggleCustomNameInput);
    ['__idp_filter_type', '__idp_filter_size', '__idp_filter_layout'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyFilters);
    });
    const urlFilterBtn = document.getElementById('__idp_btn_url_filter');
    const urlFilterInput = document.getElementById('__idp_filter_url');
    if (urlFilterBtn && urlFilterInput) {
      urlFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (urlFilterInput.style.display === 'none') {
          urlFilterInput.style.display = 'block';
          urlFilterInput.focus();
        } else {
          urlFilterInput.style.display = 'none';
          urlFilterInput.value = '';
          applyFilters();
        }
      });
      urlFilterInput.addEventListener('input', applyFilters);
    }

    // === ОБРАБОТЧИК КЛИКОВ В СПИСКЕ ===
    document.getElementById('__idp_list')?.addEventListener('click', e => {
      const actionBtn = e.target.closest('.idp-action-open, .idp-action-dl, .idp-action-search');
      if (actionBtn) {
        const url = actionBtn.dataset.url;
        if (!url) return;
        if (actionBtn.classList.contains('idp-action-open')) {
          window.open(url, '_blank');
        } else if (actionBtn.classList.contains('idp-action-dl')) {
          // одиночное скачивание с мини-прогрессом
          showProgress('Загрузка файла…');
          chrome.runtime.sendMessage({ action: 'downloadImages', urls: [url] }, () => {
            hideProgress();
          });
        } else if (actionBtn.classList.contains('idp-action-search')) {
          window.open('https://yandex.ru/images/search?rpt=imageview&url=' + encodeURIComponent(url), '_blank');
        }
        return;
      }

      if (e.target.matches('input[type="checkbox"]')) {
        const url = e.target.dataset.url;
        if (e.target.checked) selected.add(url);
        else selected.delete(url);
        e.target.closest('.idp-card')?.classList.toggle('idp-card-selected', e.target.checked);
        updateSelectionUI();
        if (statusEl) statusEl.textContent = `Выбрано: ${selected.size}`;
        return;
      }

      if (!e.target.closest('a') && !e.target.closest('button')) {
        const card = e.target.closest('.idp-card');
        if (card) {
          const checkbox = card.querySelector('.idp-checkbox');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            const url = checkbox.dataset.url;
            if (checkbox.checked) selected.add(url);
            else selected.delete(url);
            card.classList.toggle('idp-card-selected', checkbox.checked);
            updateSelectionUI();
            if (statusEl) statusEl.textContent = `Выбрано: ${selected.size}`;
          }
        }
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isVisible) hidePanel();
    });
  }

  function toggleSelectAll() {
    const allSel = filteredImages.length > 0 && filteredImages.every(img => selected.has(img.url));
    if (allSel) filteredImages.forEach(img => selected.delete(img.url));
    else filteredImages.forEach(img => selected.add(img.url));
    renderList();
  }

  function showPanel() {
    if (!panelRoot) {
      document.body.insertAdjacentHTML('beforeend', buildPanelHTML());
      panelRoot = document.getElementById('__idp_panel_root');
      listContainer = document.getElementById('__idp_list');
      statusEl = document.getElementById('__idp_status');
      initResize();
      bindEvents();
    }
    currentPanelWidth = MIN_WIDTH;
    applyPanelWidth(currentPanelWidth);
    panelRoot.classList.remove('idp-panel-hidden');
    panelRoot.classList.add('idp-panel-visible');
    isVisible = true;
    collectAndShow();
  }

  function hidePanel() {
    if (panelRoot) {
      panelRoot.classList.add('idp-panel-hidden');
      panelRoot.classList.remove('idp-panel-visible');
    }
    isVisible = false;
    setPageMargin(0);
  }

  function togglePanel() {
    if (isVisible) hidePanel();
    else showPanel();
  }

  // ========== СЛУШАТЕЛЬ СООБЩЕНИЙ (включая прогресс архива) ==========
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'togglePanel') {
      togglePanel();
      sendResponse({ visible: isVisible });
    } else if (message.action === 'getAllImages') {
      sendResponse({ images: allImages });
    } else if (message.action === 'showPanel') {
      showPanel();
      sendResponse({ success: true });
    } else if (message.action === 'downloadProgress') {
      const percent = message.total > 0 ? (message.current / message.total) * 100 : 100;
      updateProgress(percent, `Загружено ${message.current}/${message.total}`);
    }
  });

  exports.applyFilters = applyFilters;
  exports.showPanel = showPanel;
  exports.hidePanel = hidePanel;
  exports.togglePanel = togglePanel;
})(window.IDP);