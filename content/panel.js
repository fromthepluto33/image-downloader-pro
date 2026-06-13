/**
 * Image Downloader Pro – боковая панель
 */
window.IDP = window.IDP || {};

(function(exports) {
  const { truncateUrl, formatSize } = window.IDP;

  let allImages = [], filteredImages = [], selected = new Set();
  let sortMode = 'index', panelRoot = null, listContainer = null, statusEl = null, isVisible = false;
  const MIN_WIDTH = 450, MAX_WIDTH = 1200;
  let currentPanelWidth = MIN_WIDTH;

  let currentSettings = {
    fileNamePattern: 'original',
    customFileName: 'image',
    convertTo: 'original',
    zipFileName: 'images.zip'
  };

  // ========== ЗАГРУЗКА / СОХРАНЕНИЕ НАСТРОЕК ==========
  async function loadSettings() {
    const defaults = {
      fileNamePattern: 'original',
      customFileName: 'image',
      convertTo: 'original',
      zipFileName: 'images.zip'
    };
    const saved = await chrome.storage.sync.get(defaults);
    currentSettings = {
      fileNamePattern: saved.fileNamePattern,
      customFileName: saved.customFileName,
      convertTo: saved.convertTo,
      zipFileName: saved.zipFileName
    };
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    if (patternEl) patternEl.value = currentSettings.fileNamePattern;
    const customEl = document.getElementById('__idp_setting_custom_name');
    if (customEl) customEl.value = currentSettings.customFileName;
    const formatEl = document.getElementById('__idp_setting_format');
    if (formatEl) formatEl.value = currentSettings.convertTo;
    const zipNameEl = document.getElementById('__idp_setting_zip_name');
    if (zipNameEl) zipNameEl.value = currentSettings.zipFileName;
    toggleCustomNameInput();
  }

  async function saveSettings() {
    const patternEl = document.getElementById('__idp_setting_name_pattern');
    const customEl = document.getElementById('__idp_setting_custom_name');
    const formatEl = document.getElementById('__idp_setting_format');
    const zipNameEl = document.getElementById('__idp_setting_zip_name');
    currentSettings = {
      fileNamePattern: patternEl ? patternEl.value : 'original',
      customFileName: customEl ? customEl.value.trim() : 'image',
      convertTo: formatEl ? formatEl.value : 'original',
      zipFileName: zipNameEl ? zipNameEl.value.trim() : 'images.zip'
    };
    if (!currentSettings.zipFileName.endsWith('.zip')) currentSettings.zipFileName += '.zip';
    await chrome.storage.sync.set(currentSettings);
    const overlay = document.getElementById('__idp_settings_overlay');
    if (overlay) overlay.style.display = 'none';
    if (statusEl) statusEl.textContent = 'Настройки сохранены';
    setTimeout(() => {
      if (statusEl && statusEl.textContent === 'Настройки сохранены')
        statusEl.textContent = 'Найдено: ' + allImages.length;
    }, 1500);
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

  // ========== ОДИНОЧНОЕ СКАЧИВАНИЕ ==========
  async function downloadSingleFile(url) {
    let baseName;
    if (currentSettings.fileNamePattern === 'original') {
      let raw = url.split('/').pop().split('?')[0];
      let dot = raw.lastIndexOf('.');
      baseName = dot !== -1 ? raw.substring(0, dot) : raw;
      if (!baseName || baseName === 'i') baseName = 'image';
    } else if (currentSettings.fileNamePattern === 'numbered') {
      baseName = 'image_1';
    } else {
      baseName = currentSettings.customFileName || 'image';
    }
    baseName = baseName.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!baseName || baseName === '') baseName = 'image';
    chrome.runtime.sendMessage({
      action: 'downloadSingleImage',
      url: url,
      targetFormat: currentSettings.convertTo !== 'original' ? currentSettings.convertTo : 'original',
      fileName: baseName
    });
    if (statusEl) statusEl.textContent = 'Скачивание начато...';
  }

  // ========== МАССОВОЕ СКАЧИВАНИЕ ==========
  async function downloadSelected() {
    const urls = Array.from(selected);
    if (!urls.length) {
      if (statusEl) statusEl.textContent = 'Ничего не выбрано';
      return;
    }
    showProgress('Подготовка к скачиванию...');
    updateProgress(0, 'Формирование архива...');
    const images = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let baseName;
      if (currentSettings.fileNamePattern === 'original') {
        let raw = url.split('/').pop().split('?')[0];
        let dot = raw.lastIndexOf('.');
        baseName = dot !== -1 ? raw.substring(0, dot) : raw;
        if (!baseName || baseName === 'i') baseName = 'image_' + (i+1);
      } else if (currentSettings.fileNamePattern === 'numbered') {
        baseName = 'image_' + (i+1);
      } else {
        baseName = currentSettings.customFileName || 'image';
        if (urls.length > 1) baseName = baseName + '_' + (i+1);
      }
      baseName = baseName.replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!baseName) baseName = 'image_' + (i+1);
      images.push({
        url: url,
        targetFormat: currentSettings.convertTo !== 'original' ? currentSettings.convertTo : 'original',
        baseName: baseName
      });
      updateProgress((i+1)/urls.length * 100, 'Подготовлено ' + (i+1) + '/' + urls.length);
    }
    chrome.runtime.sendMessage({
      action: 'downloadBatch',
      images: images,
      zipFileName: currentSettings.zipFileName
    });
    hideProgress();
    if (statusEl) statusEl.textContent = 'Архив создаётся...';
  }

  // ========== UI ФУНКЦИИ ==========
  function updateSelectionUI() {
    const countEl = document.getElementById('__idp_sel_count');
    if (countEl) countEl.textContent = selected.size;
    const btn = document.getElementById('__idp_btn_select_all');
    if (btn) {
      const allSel = filteredImages.length > 0 && filteredImages.every(img => selected.has(img.url));
      btn.textContent = allSel ? '✓ Снять' : '☐ Все';
    }
  }

  function applyFilters() {
    let filtered = allImages.slice();
    const typeEl = document.getElementById('__idp_filter_type');
    const sizeEl = document.getElementById('__idp_filter_size');
    const layoutEl = document.getElementById('__idp_filter_layout');
    const urlEl = document.getElementById('__idp_filter_url');
    const typeVal = typeEl ? typeEl.value : 'all';
    const sizeVal = sizeEl ? sizeEl.value : 'all';
    const layoutVal = layoutEl ? layoutEl.value : 'all';
    const urlQuery = urlEl ? urlEl.value.trim().toLowerCase() : '';
    if (typeVal !== 'all') filtered = filtered.filter(img => (img.ext || '').toLowerCase() === typeVal);
    if (sizeVal === 'small') filtered = filtered.filter(img => Math.max(img.width, img.height) < 200);
    else if (sizeVal === 'medium') filtered = filtered.filter(img => { const m = Math.max(img.width, img.height); return m>=200 && m<=700; });
    else if (sizeVal === 'large') filtered = filtered.filter(img => Math.max(img.width, img.height) > 700);
    if (layoutVal === 'square') filtered = filtered.filter(img => { if (!img.width || !img.height) return false; const r = img.width/img.height; return r>=0.8 && r<=1.25; });
    else if (layoutVal === 'wide') filtered = filtered.filter(img => img.width/img.height > 1.25);
    else if (layoutVal === 'tall') filtered = filtered.filter(img => img.height/img.width > 1.25);
    if (urlQuery) filtered = filtered.filter(img => img.url.toLowerCase().includes(urlQuery));
    if (sortMode === 'pixels') filtered.sort((a,b) => (b.width*b.height) - (a.width*a.height));
    filteredImages = filtered;
    renderList();
  }

  function renderList() {
    if (!listContainer) return;
    listContainer.innerHTML = '';
    if (!filteredImages.length) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'idp-empty';
      emptyDiv.textContent = 'Изображения не найдены';
      listContainer.appendChild(emptyDiv);
      return;
    }
    filteredImages.forEach(img => {
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
      const a = document.createElement('a');
      a.className = 'idp-card-url';
      a.href = img.url;
      a.target = '_blank';
      a.textContent = truncateUrl(img.url, 55);
      topDiv.appendChild(a);
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
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'idp-meta-badge';
      sizeSpan.textContent = img.width + '×' + img.height;
      const bytesSpan = document.createElement('span');
      bytesSpan.className = 'idp-meta-badge';
      bytesSpan.textContent = formatSize(img.size);
      const extSpan = document.createElement('span');
      extSpan.className = 'idp-meta-badge';
      extSpan.textContent = img.ext.toUpperCase();
      meta.appendChild(sizeSpan);
      meta.appendChild(bytesSpan);
      meta.appendChild(extSpan);
      wrap.appendChild(meta);
      card.appendChild(wrap);
      
      const actions = document.createElement('div');
      actions.className = 'idp-card-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'idp-btn idp-btn-sm idp-action-open';
      openBtn.dataset.url = img.url;
      openBtn.textContent = '🔗';
      const dlBtn = document.createElement('button');
      dlBtn.className = 'idp-btn idp-btn-sm idp-action-dl';
      dlBtn.dataset.url = img.url;
      dlBtn.textContent = '⬇';
      const searchBtn = document.createElement('button');
      searchBtn.className = 'idp-btn idp-btn-sm idp-action-search';
      searchBtn.dataset.url = img.url;
      searchBtn.textContent = '🔍';
      actions.appendChild(openBtn);
      actions.appendChild(dlBtn);
      actions.appendChild(searchBtn);
      card.appendChild(actions);
      
      listContainer.appendChild(card);
    });
  }

  function createPanelDOM() {
    const root = document.createElement('div');
    root.id = '__idp_panel_root';
    root.className = 'idp-panel-hidden';

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.type = 'text/css';
    cssLink.href = chrome.runtime.getURL('content/inject.css');
    root.appendChild(cssLink);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'idp-resize-handle';
    resizeHandle.id = '__idp_resize_handle';
    root.appendChild(resizeHandle);

    const inner = document.createElement('div');
    inner.className = 'idp-panel-inner';

    // header
    const header = document.createElement('div');
    header.className = 'idp-header';
    const titleDiv = document.createElement('div');
    titleDiv.style.display = 'flex';
    titleDiv.style.alignItems = 'center';
    titleDiv.style.gap = '4px';
    const iconImg = document.createElement('img');
    iconImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA5ElEQVR4AdyQMQrCQBBFJwFBT2CVVIKVhdgFBO2tBLuAkCKllTYB2xRGPICtF7C1FPEEVmKlASGFIBaCIsT5K4GQrEWClbBv98/Mzt9hVd3wTN2YnJgwI9zjmSpR6BKRxmRd3BO6bJCrOXpMg0EU5Dp/b1Crlmk8aEtBLTmmdIJ+t07A6jUIQINkM2IVW5zdPqBKayZ4PF8Eohi1+F3olAGSWfhXg6HdpON2RKViQQCNnOxvpH8wnW/IdpZ0ud4F0Mh9M/BlhdX6QB1rIYCW3eGczxMoDgSTWufgRiBV+CT4YcV5AwAA///7faflAAAABklEQVQDAMOhYLM9tZRAAAAAAElFTkSuQmCC';
    iconImg.width = 16;
    iconImg.height = 16;
    iconImg.style.display = 'block';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'idp-title';
    titleSpan.textContent = 'Image Downloader Pro';
    titleDiv.appendChild(iconImg);
    titleDiv.appendChild(titleSpan);
    header.appendChild(titleDiv);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'idp-header-actions';
    const btnArea = createButton('🖼️ Область', '__idp_btn_area', 'idp-btn idp-btn-icon');
    const btnRefresh = createButton('⟳', '__idp_btn_refresh', 'idp-btn idp-btn-icon');
    const btnSettings = createButton('⚙️', '__idp_btn_settings', 'idp-btn idp-btn-icon');
    const btnClose = createButton('✕', '__idp_btn_close', 'idp-btn idp-btn-icon');
    actionsDiv.appendChild(btnArea);
    actionsDiv.appendChild(btnRefresh);
    actionsDiv.appendChild(btnSettings);
    actionsDiv.appendChild(btnClose);
    header.appendChild(actionsDiv);
    inner.appendChild(header);

    // filters
    const filters = document.createElement('div');
    filters.className = 'idp-filters';
    
    const filterType = createSelect('__idp_filter_type', ['all','jpg','png','webp','gif'], ['Форматы','JPG','PNG','WebP','GIF']);
    const filterSize = createSelect('__idp_filter_size', ['all','small','medium','large'], ['Размеры','Маленькие','Средние','Большие']);
    const filterLayout = createSelect('__idp_filter_layout', ['all','square','wide','tall'], ['Макеты','Квадратные','Горизонтальные','Вертикальные']);
    
    // Обёртка URL
    const urlWrapper = document.createElement('div');
    urlWrapper.style.position = 'relative';
    urlWrapper.style.flexShrink = '0';
    const urlBtn = createButton('URL', '__idp_btn_url_filter', 'idp-btn idp-btn-sm');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.id = '__idp_filter_url';
    urlInput.className = 'idp-input';
    urlInput.placeholder = 'Введите часть URL';
    urlInput.style.display = 'none';
    urlInput.style.position = 'absolute';
    urlInput.style.top = '100%';
    urlInput.style.right = '0';
    urlInput.style.width = '220px';
    urlWrapper.appendChild(urlBtn);
    urlWrapper.appendChild(urlInput);
    
    const sortBtn = createButton('⇅', '__idp_btn_sort', 'idp-btn idp-btn-sm');
    
    // Группировка правых кнопок
    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.gap = '4px';
    rightGroup.style.marginLeft = 'auto';
    rightGroup.appendChild(urlWrapper);
    rightGroup.appendChild(sortBtn);
    
    filters.appendChild(filterType);
    filters.appendChild(filterSize);
    filters.appendChild(filterLayout);
    filters.appendChild(rightGroup);
    inner.appendChild(filters);

    // progress
    const progressContainer = document.createElement('div');
    progressContainer.id = '__idp_progress_container';
    progressContainer.style.display = 'none';
    const progressBar = document.createElement('div');
    progressBar.className = 'idp-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.id = '__idp_progress_fill';
    progressFill.className = 'idp-progress-fill';
    progressBar.appendChild(progressFill);
    const progressText = document.createElement('div');
    progressText.id = '__idp_progress_text';
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);
    inner.appendChild(progressContainer);

    // toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'idp-toolbar';
    const selectAllBtn = createButton('☐ Все', '__idp_btn_select_all', 'idp-btn idp-btn-primary');
    const downloadBtn = document.createElement('button');
    downloadBtn.id = '__idp_btn_download';
    downloadBtn.className = 'idp-btn idp-btn-success';
    downloadBtn.innerHTML = '⬇ Скачать (<span id="__idp_sel_count">0</span>)';
    toolbar.appendChild(selectAllBtn);
    toolbar.appendChild(downloadBtn);
    inner.appendChild(toolbar);

    // list
    const list = document.createElement('div');
    list.id = '__idp_list';
    list.className = 'idp-list';
    inner.appendChild(list);

    // status
    const status = document.createElement('div');
    status.id = '__idp_status';
    status.className = 'idp-status';
    status.textContent = 'Готов';
    inner.appendChild(status);

    // settings overlay
    const settingsOverlay = document.createElement('div');
    settingsOverlay.id = '__idp_settings_overlay';
    settingsOverlay.className = 'idp-settings-overlay';
    settingsOverlay.style.display = 'none';
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'idp-settings-panel';
    const settingsHeader = document.createElement('div');
    settingsHeader.className = 'idp-settings-header';
    settingsHeader.innerHTML = '<span>Настройки</span><button class="idp-btn idp-btn-icon" id="__idp_btn_close_settings">✕</button>';
    const settingsBody = document.createElement('div');
    settingsBody.className = 'idp-settings-body';
    settingsBody.innerHTML = `
      <label class="idp-label">Имя ZIP-архива</label>
      <input type="text" id="__idp_setting_zip_name" class="idp-input" placeholder="images.zip">
      <label class="idp-label">Шаблон имени файла</label>
      <select id="__idp_setting_name_pattern" class="idp-select">
        <option value="custom">Переименовать</option>
        <option value="original">Оригинальное имя</option>
        <option value="numbered">image_N</option>
      </select>
      <label class="idp-label" id="__idp_label_custom_name" style="display:none;">Своё имя</label>
      <input type="text" id="__idp_setting_custom_name" class="idp-input" placeholder="image" style="display:none;">
      <label class="idp-label">Конвертировать в</label>
      <select id="__idp_setting_format" class="idp-select">
        <option value="original">Оригинальный</option>
        <option value="jpg">JPG</option>
        <option value="png">PNG</option>
        <option value="webp">WebP</option>
      </select>
      <button class="idp-btn idp-btn-primary" id="__idp_btn_save_settings">Сохранить</button>
    `;
    settingsPanel.appendChild(settingsHeader);
    settingsPanel.appendChild(settingsBody);
    settingsOverlay.appendChild(settingsPanel);
    inner.appendChild(settingsOverlay);

    root.appendChild(inner);
    return root;
  }

  function createButton(text, id, className) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.id = id;
    btn.className = className;
    return btn;
  }

  function createSelect(id, values, labels) {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'idp-select';
    for (let i = 0; i < values.length; i++) {
      const opt = document.createElement('option');
      opt.value = values[i];
      opt.textContent = labels[i];
      select.appendChild(opt);
    }
    return select;
  }

  function setPanelHeight() {
    if (panelRoot) panelRoot.style.height = window.innerHeight + 'px';
  }

  function setPageMargin(w) { document.body.style.marginRight = w > 0 ? w + 'px' : ''; }
  function applyPanelWidth(w) {
    const c = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
    if (panelRoot) panelRoot.style.width = c + 'px';
    currentPanelWidth = c;
    setPageMargin(c);
  }
  function initResize() {
    const handle = document.getElementById('__idp_resize_handle');
    if (!handle) return;
    let startX, startW;
    const move = function(e) { applyPanelWidth(startW + (startX - e.clientX)); };
    const up = function() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      startX = e.clientX;
      startW = panelRoot ? panelRoot.getBoundingClientRect().width : MIN_WIDTH;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  function bindEvents() {
    document.getElementById('__idp_btn_refresh').addEventListener('click', startCollection);
    document.getElementById('__idp_btn_area').addEventListener('click', startAreaMode);
    document.getElementById('__idp_btn_close').addEventListener('click', hidePanel);
    document.getElementById('__idp_btn_select_all').addEventListener('click', toggleSelectAll);
    document.getElementById('__idp_btn_download').addEventListener('click', downloadSelected);
    document.getElementById('__idp_btn_settings').addEventListener('click', function() { document.getElementById('__idp_settings_overlay').style.display = 'flex'; loadSettings(); });
    document.getElementById('__idp_btn_close_settings').addEventListener('click', function() { document.getElementById('__idp_settings_overlay').style.display = 'none'; });
    document.getElementById('__idp_btn_save_settings').addEventListener('click', saveSettings);
    document.getElementById('__idp_btn_sort').addEventListener('click', function() { sortMode = sortMode === 'index' ? 'pixels' : 'index'; applyFilters(); });
    document.getElementById('__idp_setting_name_pattern').addEventListener('change', toggleCustomNameInput);
    ['__idp_filter_type', '__idp_filter_size', '__idp_filter_layout'].forEach(function(id) { document.getElementById(id).addEventListener('change', applyFilters); });
    const urlBtn = document.getElementById('__idp_btn_url_filter');
    const urlInput = document.getElementById('__idp_filter_url');
    if (urlBtn && urlInput) {
      urlBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (urlInput.style.display === 'none') { urlInput.style.display = 'block'; urlInput.focus(); }
        else { urlInput.style.display = 'none'; urlInput.value = ''; applyFilters(); }
      });
      urlInput.addEventListener('input', applyFilters);
    }
    document.getElementById('__idp_list').addEventListener('click', function(e) {
      const btn = e.target.closest('.idp-action-open, .idp-action-dl, .idp-action-search');
      if (btn) {
        const url = btn.dataset.url;
        if (!url) return;
        if (btn.classList.contains('idp-action-open')) window.open(url, '_blank');
        else if (btn.classList.contains('idp-action-dl')) downloadSingleFile(url);
        else if (btn.classList.contains('idp-action-search')) window.open('https://yandex.ru/images/search?rpt=imageview&url=' + encodeURIComponent(url), '_blank');
        return;
      }
      if (e.target.matches('input[type="checkbox"]')) {
        const url = e.target.dataset.url;
        if (e.target.checked) selected.add(url); else selected.delete(url);
        e.target.closest('.idp-card').classList.toggle('idp-card-selected', e.target.checked);
        updateSelectionUI();
        if (statusEl) statusEl.textContent = 'Выбрано: ' + selected.size;
        return;
      }
      const card = e.target.closest('.idp-card');
      if (card) {
        const ch = card.querySelector('.idp-checkbox');
        if (ch) { ch.checked = !ch.checked; const url = ch.dataset.url; if (ch.checked) selected.add(url); else selected.delete(url); card.classList.toggle('idp-card-selected', ch.checked); updateSelectionUI(); if (statusEl) statusEl.textContent = 'Выбрано: ' + selected.size; }
      }
    });
    window.addEventListener('resize', setPanelHeight);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && isVisible) hidePanel(); });
  }

  function showProgress(text) {
    const c = document.getElementById('__idp_progress_container');
    if (c) c.style.display = 'block';
    const f = document.getElementById('__idp_progress_fill');
    if (f) f.style.width = '0%';
    const t = document.getElementById('__idp_progress_text');
    if (t) t.textContent = text || 'Загрузка…';
  }
  function updateProgress(percent, text) {
    const f = document.getElementById('__idp_progress_fill');
    if (f) f.style.width = Math.min(100, Math.round(percent)) + '%';
    const t = document.getElementById('__idp_progress_text');
    if (t && text) t.textContent = text;
  }
  function hideProgress() {
    const c = document.getElementById('__idp_progress_container');
    if (c) c.style.display = 'none';
  }

  async function startCollection() {
    if (statusEl) statusEl.textContent = 'Сбор изображений…';
    showProgress('Сбор изображений…');
    try {
      allImages = window.IDP.collectAllImages({
        onProgress: function(loaded, total) { var percent = total > 0 ? (loaded / total) * 100 : 100; updateProgress(percent, 'Определение размеров: ' + loaded + '/' + total); }
      });
      if (allImages._ready) await allImages._ready;
      hideProgress();
      if (statusEl) statusEl.textContent = 'Найдено: ' + allImages.length;
      applyFilters();
    } catch(e) { hideProgress(); if (statusEl) statusEl.textContent = 'Ошибка сбора'; console.error(e); }
  }

  async function startAreaMode() {
    if (statusEl) statusEl.textContent = 'Выделите область на странице…';
    panelRoot.classList.add('idp-panel-minimized');
    try {
      const areaImages = await window.IDP.startAreaSelection(allImages);
      panelRoot.classList.remove('idp-panel-minimized');
      if (areaImages.length) { allImages = areaImages; selected.clear(); applyFilters(); if (statusEl) statusEl.textContent = 'Выделено: ' + areaImages.length; }
      else if (statusEl) statusEl.textContent = 'Ничего не выделено';
    } catch(e) { panelRoot.classList.remove('idp-panel-minimized'); if (statusEl) statusEl.textContent = 'Ошибка выделения'; }
  }

  function toggleSelectAll() {
    const allSel = filteredImages.length && filteredImages.every(img => selected.has(img.url));
    if (allSel) filteredImages.forEach(img => selected.delete(img.url));
    else filteredImages.forEach(img => selected.add(img.url));
    renderList(); updateSelectionUI();
  }

  function showPanel() {
    if (!panelRoot) {
      panelRoot = createPanelDOM();
      document.body.appendChild(panelRoot);
      listContainer = document.getElementById('__idp_list');
      statusEl = document.getElementById('__idp_status');
      initResize(); bindEvents();
    }
    applyPanelWidth(currentPanelWidth);
    panelRoot.classList.remove('idp-panel-hidden');
    panelRoot.classList.add('idp-panel-visible');
    setPanelHeight();
    isVisible = true;
    loadSettings();
    startCollection();
  }

  function hidePanel() {
    if (panelRoot) { panelRoot.classList.add('idp-panel-hidden'); panelRoot.classList.remove('idp-panel-visible'); }
    isVisible = false;
    setPageMargin(0);
  }

  function togglePanel() { if (isVisible) hidePanel(); else showPanel(); }

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.action === 'togglePanel') { togglePanel(); sendResponse({ success: true }); }
    return true;
  });

  exports.applyFilters = applyFilters;
  exports.showPanel = showPanel;
  exports.hidePanel = hidePanel;
  exports.togglePanel = togglePanel;
})(window.IDP);
console.log('IDP panel loaded');