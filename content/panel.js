/**
 * Image Downloader Pro — боковая панель (Chrome + Firefox).
 */
window.IDP = window.IDP || {};

(function (exports) {
  const { api, DEFAULT_SETTINGS, getRuntimeURL, downloadBlobInPage, guessExt, buildFileName } = window.IDPCommon;
  const { truncateUrl, formatSize } = window.IDP;

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
  let currentSettings = { ...DEFAULT_SETTINGS };

  async function loadSettings() {
    const saved = await api.storage.sync.get(DEFAULT_SETTINGS);
    currentSettings = {
      fileNamePattern: saved.fileNamePattern ?? DEFAULT_SETTINGS.fileNamePattern,
      customFileName: saved.customFileName ?? DEFAULT_SETTINGS.customFileName,
      convertTo: saved.convertTo ?? DEFAULT_SETTINGS.convertTo,
      zipFileName: saved.zipFileName ?? DEFAULT_SETTINGS.zipFileName
    };
    applySettingsToForm();
  }

  function applySettingsToForm() {
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const customEl = document.getElementById('__idp_setting_custom_name');
    const formatEl = document.getElementById('__idp_setting_format');
    const zipNameEl = document.getElementById('__idp_setting_zip_name');

    if (patternEl) patternEl.value = currentSettings.fileNamePattern;
    if (customEl) customEl.value = currentSettings.customFileName;
    if (formatEl) formatEl.value = currentSettings.convertTo;
    if (zipNameEl) zipNameEl.value = currentSettings.zipFileName;
    toggleCustomNameInput();
  }

  function readSettingsFromUI() {
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const customEl = document.getElementById('__idp_setting_custom_name');
    const formatEl = document.getElementById('__idp_setting_format');
    const zipNameEl = document.getElementById('__idp_setting_zip_name');

    if (!patternEl && !formatEl && !zipNameEl) return { ...currentSettings };

    const settings = {
      fileNamePattern: patternEl?.value || currentSettings.fileNamePattern,
      customFileName: (customEl?.value.trim() || currentSettings.customFileName || 'image'),
      convertTo: formatEl?.value || currentSettings.convertTo,
      zipFileName: (zipNameEl?.value.trim() || currentSettings.zipFileName || 'images.zip')
    };

    settings.zipFileName = settings.zipFileName.endsWith('.zip')
      ? settings.zipFileName
      : `${settings.zipFileName}.zip`;

    return settings;
  }

  function getDownloadSettings() {
    currentSettings = readSettingsFromUI();
    return currentSettings;
  }

  async function saveSettings() {
    currentSettings = readSettingsFromUI();
    await api.storage.sync.set(currentSettings);
    document.getElementById('__idp_settings_overlay').style.display = 'none';
    if (statusEl) statusEl.textContent = 'Настройки сохранены';
    setTimeout(() => {
      if (statusEl?.textContent === 'Настройки сохранены') {
        statusEl.textContent = `Найдено: ${allImages.length}`;
      }
    }, 1500);
  }

  function toggleCustomNameInput() {
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const customEl = document.getElementById('__idp_setting_custom_name');
    const labelEl = document.getElementById('__idp_label_custom_name');
    if (!patternEl || !customEl || !labelEl) return;

    const isCustom = patternEl.value === 'custom';
    customEl.style.display = isCustom ? 'block' : 'none';
    labelEl.style.display = isCustom ? 'block' : 'none';
  }

  async function downloadUrls(urls) {
    if (!urls.length) {
      if (statusEl) statusEl.textContent = 'Ничего не выбрано';
      return;
    }

    const settings = getDownloadSettings();
    showProgress('Создание архива…');
    updateProgress(10, 'Загрузка и обработка…');

    try {
      const response = await api.runtime.sendMessage({
        action: 'downloadImages',
        urls,
        settings
      });

      hideProgress();
      if (!response || response.success === false) {
        if (statusEl) statusEl.textContent = 'Ошибка архива';
        console.error(response?.error || 'No response from background');
        return;
      }

      if (response.zipBuffer) {
        downloadBlobInPage(response.zipBuffer, response.zipFileName || settings.zipFileName);
      }

      if (statusEl) statusEl.textContent = 'Готово';
    } catch (err) {
      hideProgress();
      if (statusEl) statusEl.textContent = 'Ошибка скачивания';
      console.error(err);
    }
  }

  async function downloadSelected() {
    await downloadUrls([...selected]);
  }

  function updateSelectionUI() {
    const countEl = document.getElementById('__idp_sel_count');
    if (countEl) countEl.textContent = selected.size;

    const btn = document.getElementById('__idp_btn_select_all');
    if (btn) {
      const allSel = filteredImages.length > 0 && filteredImages.every((img) => selected.has(img.url));
      btn.textContent = allSel ? '☑ Снять' : '☐ Все';
      btn.classList.toggle('idp-btn-checked', allSel);
    }
  }

  function applyFilters() {
    let filtered = [...allImages];
    const typeVal = document.getElementById('__idp_filter_type')?.value || 'all';
    const sizeVal = document.getElementById('__idp_filter_size')?.value || 'all';
    const layoutVal = document.getElementById('__idp_filter_layout')?.value || 'all';
    const urlQuery = document.getElementById('__idp_filter_url')?.value.trim().toLowerCase() || '';

    if (typeVal !== 'all') {
      filtered = filtered.filter((img) => (img.ext || '').toLowerCase() === typeVal);
    }
    if (sizeVal === 'small') {
      filtered = filtered.filter((img) => Math.max(img.width, img.height) < 200);
    } else if (sizeVal === 'medium') {
      filtered = filtered.filter((img) => {
        const m = Math.max(img.width, img.height);
        return m >= 200 && m <= 700;
      });
    } else if (sizeVal === 'large') {
      filtered = filtered.filter((img) => Math.max(img.width, img.height) > 700);
    }
    if (layoutVal === 'square') {
      filtered = filtered.filter((img) => {
        if (!img.width || !img.height) return false;
        const r = img.width / img.height;
        return r >= 0.8 && r <= 1.25;
      });
    } else if (layoutVal === 'wide') {
      filtered = filtered.filter((img) => img.width / img.height > 1.25);
    } else if (layoutVal === 'tall') {
      filtered = filtered.filter((img) => img.height / img.width > 1.25);
    }
    if (urlQuery) {
      filtered = filtered.filter((img) => img.url.toLowerCase().includes(urlQuery));
    }
    if (sortMode === 'pixels') {
      filtered.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    }

    filteredImages = filtered;
    renderList();
    updateSelectionUI();
  }

  function renderList() {
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!filteredImages.length) {
      const empty = document.createElement('div');
      empty.className = 'idp-empty';
      empty.textContent = 'Изображения не найдены';
      listContainer.appendChild(empty);
      return;
    }

    filteredImages.forEach((img) => {
      const isSel = selected.has(img.url);
      const card = document.createElement('div');
      card.className = 'idp-card' + (isSel ? ' idp-card-selected' : '');

      const checkDiv = document.createElement('div');
      checkDiv.className = 'idp-card-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'idp-checkbox';
      cb.dataset.url = img.url;
      cb.checked = isSel;
      checkDiv.appendChild(cb);
      card.appendChild(checkDiv);

      const topDiv = document.createElement('div');
      topDiv.className = 'idp-card-top';
      const link = document.createElement('a');
      link.className = 'idp-card-url';
      link.href = img.url;
      link.target = '_blank';
      link.title = img.url;
      link.textContent = truncateUrl(img.url, 55);
      topDiv.appendChild(link);
      card.appendChild(topDiv);

      const wrap = document.createElement('div');
      wrap.className = 'idp-card-image-wrap';
      const imgEl = document.createElement('img');
      imgEl.className = 'idp-card-img';
      imgEl.src = img.url;
      imgEl.loading = 'lazy';
      wrap.appendChild(imgEl);

      const meta = document.createElement('div');
      meta.className = 'idp-card-overlay-meta';
      for (const text of [`${img.width}×${img.height}`, formatSize(img.size), (img.ext || '').toUpperCase()]) {
        const badge = document.createElement('span');
        badge.className = 'idp-meta-badge';
        badge.textContent = text;
        meta.appendChild(badge);
      }
      wrap.appendChild(meta);
      card.appendChild(wrap);

      const actions = document.createElement('div');
      actions.className = 'idp-card-actions';
      for (const [cls, label] of [['idp-action-open', '🔗'], ['idp-action-dl', '⬇'], ['idp-action-search', '🔍']]) {
        const btn = document.createElement('button');
        btn.className = `idp-btn idp-btn-sm ${cls}`;
        btn.dataset.url = img.url;
        btn.textContent = label;
        actions.appendChild(btn);
      }
      card.appendChild(actions);
      listContainer.appendChild(card);
    });
  }

  function buildPanelHTML() {
    const cssUrl = getRuntimeURL('content/inject.css');
    const iconUrl = getRuntimeURL('icons/icon48.png');
    return `
      <div id="__idp_panel_root" class="idp-panel-hidden">
        <link rel="stylesheet" href="${cssUrl}">
        <div class="idp-resize-handle" id="__idp_resize_handle"></div>
        <div class="idp-panel-inner">
          <div class="idp-header">
            <div class="idp-header-brand">
              <img class="idp-header-icon" src="${iconUrl}" alt="" width="24" height="24">
              <span class="idp-title">Image Downloader Pro</span>
            </div>
            <div class="idp-header-actions">
              <button class="idp-btn idp-btn-area" id="__idp_btn_area" title="Выделить область">🖼️ Область</button>
              <button class="idp-btn idp-btn-icon" id="__idp_btn_refresh" title="Обновить">⟳</button>
              <button class="idp-btn idp-btn-icon" id="__idp_btn_settings" title="Настройки">⚙️</button>
              <button class="idp-btn idp-btn-icon" id="__idp_btn_close" title="Закрыть">✕</button>
            </div>
          </div>
          <div class="idp-filters">
            <div class="idp-filters-main">
              <select id="__idp_filter_type" class="idp-select">
                <option value="all">Форматы</option>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="gif">GIF</option>
              </select>
              <select id="__idp_filter_size" class="idp-select">
                <option value="all">Размеры</option>
                <option value="small">Маленькие</option>
                <option value="medium">Средние</option>
                <option value="large">Большие</option>
              </select>
              <select id="__idp_filter_layout" class="idp-select">
                <option value="all">Макеты</option>
                <option value="square">Квадратные</option>
                <option value="wide">Горизонтальные</option>
                <option value="tall">Вертикальные</option>
              </select>
            </div>
            <div class="idp-filters-extra">
              <div class="idp-url-filter-wrap">
                <button class="idp-btn idp-btn-sm" id="__idp_btn_url_filter">URL</button>
                <input type="text" id="__idp_filter_url" class="idp-input idp-filter-url-input" style="display:none">
              </div>
              <button class="idp-btn idp-btn-sm idp-btn-icon" id="__idp_btn_sort" title="Сортировка">⇅</button>
            </div>
          </div>
          <div id="__idp_progress_container" style="display:none">
            <div class="idp-progress-bar"><div id="__idp_progress_fill" class="idp-progress-fill"></div></div>
            <div id="__idp_progress_text"></div>
          </div>
          <div class="idp-toolbar">
            <button class="idp-btn idp-btn-primary" id="__idp_btn_select_all">☐ Все</button>
            <button class="idp-btn idp-btn-success" id="__idp_btn_download">
              ⬇ Скачать (<span id="__idp_sel_count">0</span>)
            </button>
          </div>
          <div class="idp-list" id="__idp_list"></div>
          <div class="idp-status" id="__idp_status">Готов</div>
        </div>
        <div class="idp-settings-overlay" id="__idp_settings_overlay" style="display:none">
          <div class="idp-settings-panel">
            <div class="idp-settings-header">
              <span>Настройки</span>
              <button class="idp-btn idp-btn-icon" id="__idp_btn_close_settings">✕</button>
            </div>
            <div class="idp-settings-body">
              <label class="idp-label">Имя ZIP-архива</label>
              <input type="text" id="__idp_setting_zip_name" class="idp-input" placeholder="images.zip">
              <label class="idp-label">Шаблон имени файла</label>
              <select id="__idp_setting_name_pattern" class="idp-select">
                <option value="custom">Переименовать</option>
                <option value="original">Оригинальное имя</option>
                <option value="numbered">image_N</option>
              </select>
              <label class="idp-label" id="__idp_label_custom_name" style="display:none">Своё имя</label>
              <input type="text" id="__idp_setting_custom_name" class="idp-input" placeholder="image" style="display:none">
              <label class="idp-label">Конвертировать в</label>
              <select id="__idp_setting_format" class="idp-select">
                <option value="original">Оригинальный</option>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
              <button class="idp-btn idp-btn-primary" id="__idp_btn_save_settings">Сохранить</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function setPageMargin(width) {
    document.body.style.marginRight = width > 0 ? `${width}px` : '';
  }

  function applyPanelWidth(width) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    if (panelRoot) panelRoot.style.width = `${clamped}px`;
    currentPanelWidth = clamped;
    setPageMargin(clamped);
  }

  function initResize() {
    const handle = document.getElementById('__idp_resize_handle');
    if (!handle) return;

    let startX;
    let startWidth;

    const onMove = (e) => applyPanelWidth(startWidth + (startX - e.clientX));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panelRoot?.getBoundingClientRect().width || MIN_WIDTH;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  function bindEvents() {
    document.getElementById('__idp_btn_refresh')?.addEventListener('click', startCollection);
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

    for (const id of ['__idp_filter_type', '__idp_filter_size', '__idp_filter_layout']) {
      document.getElementById(id)?.addEventListener('change', applyFilters);
    }

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

    document.getElementById('__idp_list')?.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.idp-action-open, .idp-action-dl, .idp-action-search');
      if (actionBtn) {
        const url = actionBtn.dataset.url;
        if (!url) return;

        if (actionBtn.classList.contains('idp-action-open')) {
          window.open(url, '_blank');
        } else if (actionBtn.classList.contains('idp-action-dl')) {
          downloadSingleFile(url);
        } else {
          window.open(`https://yandex.ru/images/search?rpt=imageview&url=${encodeURIComponent(url)}`, '_blank');
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

      const card = e.target.closest('.idp-card');
      if (!card) return;
      const checkbox = card.querySelector('.idp-checkbox');
      if (!checkbox) return;

      checkbox.checked = !checkbox.checked;
      const url = checkbox.dataset.url;
      if (checkbox.checked) selected.add(url);
      else selected.delete(url);
      card.classList.toggle('idp-card-selected', checkbox.checked);
      updateSelectionUI();
      if (statusEl) statusEl.textContent = `Выбрано: ${selected.size}`;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isVisible) hidePanel();
    });
  }

  function showProgress(text) {
    const container = document.getElementById('__idp_progress_container');
    if (container) container.style.display = 'block';
    const fill = document.getElementById('__idp_progress_fill');
    if (fill) fill.style.width = '0%';
    const label = document.getElementById('__idp_progress_text');
    if (label) label.textContent = text || 'Загрузка…';
  }

  function updateProgress(percent, text) {
    const fill = document.getElementById('__idp_progress_fill');
    if (fill) fill.style.width = `${Math.min(100, Math.round(percent))}%`;
    const label = document.getElementById('__idp_progress_text');
    if (label && text) label.textContent = text;
  }

  function hideProgress() {
    const container = document.getElementById('__idp_progress_container');
    if (container) container.style.display = 'none';
  }

  async function startCollection() {
    if (statusEl) statusEl.textContent = 'Сбор изображений…';
    showProgress('Сбор изображений…');

    try {
      allImages = window.IDP.collectAllImages();
      if (allImages._ready) await allImages._ready;
      hideProgress();
      if (statusEl) statusEl.textContent = `Найдено: ${allImages.length}`;
      applyFilters();
    } catch (err) {
      hideProgress();
      if (statusEl) statusEl.textContent = 'Ошибка сбора';
      console.error(err);
    }
  }

  async function startAreaMode() {
    if (statusEl) statusEl.textContent = 'Выделите область на странице…';
    panelRoot.classList.add('idp-panel-minimized');

    try {
      const areaImages = await window.IDP.startAreaSelection(allImages);
      panelRoot.classList.remove('idp-panel-minimized');

      if (areaImages.length) {
        allImages = areaImages;
        selected.clear();
        applyFilters();
        if (statusEl) statusEl.textContent = `Выделено: ${areaImages.length}`;
      } else if (statusEl) {
        statusEl.textContent = 'Ничего не выделено';
      }
    } catch (err) {
      panelRoot.classList.remove('idp-panel-minimized');
      if (statusEl) statusEl.textContent = 'Ошибка выделения';
      console.error(err);
    }
  }

async function downloadSingleFile(url) {
  try {
    // Пытаемся получить blob напрямую из content script
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();

    // Определяем расширение из URL или типа
    const ext = guessExt(url, blob);
    const filename = buildFileName(url, 0, 1, currentSettings, ext);

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

    if (statusEl) statusEl.textContent = `Скачан: ${filename}`;
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Ошибка скачивания';
    console.error('downloadSingleFile:', err);
  }
}

  function toggleSelectAll() {
    const allSel = filteredImages.length > 0 && filteredImages.every((img) => selected.has(img.url));
    if (allSel) filteredImages.forEach((img) => selected.delete(img.url));
    else filteredImages.forEach((img) => selected.add(img.url));
    renderList();
    updateSelectionUI();
  }

  async function showPanel() {
    if (!panelRoot) {
      const temp = document.createElement('div');
      temp.innerHTML = buildPanelHTML();
      while (temp.firstChild) {
        document.body.appendChild(temp.firstChild);
      }
      panelRoot = document.getElementById('__idp_panel_root');
      listContainer = document.getElementById('__idp_list');
      statusEl = document.getElementById('__idp_status');
      initResize();
      bindEvents();
    }

    applyPanelWidth(currentPanelWidth);
    panelRoot.classList.remove('idp-panel-hidden');
    panelRoot.classList.add('idp-panel-visible');
    isVisible = true;
    await loadSettings();
    startCollection();
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

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'togglePanel') {
      togglePanel();
      sendResponse({ success: true });
    }
    return true;
  });

  exports.applyFilters = applyFilters;
  exports.showPanel = showPanel;
  exports.hidePanel = hidePanel;
  exports.togglePanel = togglePanel;
})(window.IDP);
