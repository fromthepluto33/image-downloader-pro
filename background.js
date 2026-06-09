importScripts('jszip.min.js');

// ---------- Клик по иконке расширения — открываем панель ----------
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/panel.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content/inject.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.IDP && window.IDP.showPanel) {
          window.IDP.showPanel();
        }
      }
    });
  } catch (e) {
    console.warn('Panel toggle error:', e);
  }
});

// ---------- Скачивание изображений (с прогрессом) ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImages') {
    downloadImages(message.urls, sender.tab.id).then(sendResponse);
    return true;
  }
});

function sanitizeFilename(name) {
  if (!name || !name.trim()) return 'downloaded_images';
  return name.replace(/[-~@#$%^&*(){}[\]'`\/\\:?<>|"\s]/g, '_');
}

async function downloadImages(urls, tabId) {
  const defaults = {
    folderName: 'downloaded_images',
    fileNamePattern: 'custom',
    customFileName: 'image',
    convertTo: 'original'
  };
  const settings = await chrome.storage.sync.get(defaults);
  const folderName = sanitizeFilename(settings.folderName || defaults.folderName);
  const zip = new JSZip();
  const CONCURRENCY = 5;
  let completed = 0;

  const fetchImage = async (url) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        return await resp.blob();
      } catch (e) {
        lastError = e;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw lastError;
  };

  const sendProgress = () => {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, {
        action: 'downloadProgress',
        current: completed,
        total: urls.length
      }).catch(() => {});
    }
  };

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map(async (url, chunkIndex) => {
      const globalIndex = i + chunkIndex;
      try {
        const blob = await fetchImage(url);
        let finalBlob = blob;

        if (settings.convertTo !== 'original') {
          const originalExt = getExtFromUrl(url) || getExtFromMime(blob.type) || 'jpg';
          if (originalExt !== settings.convertTo) {
            const converted = await convertBlob(blob, settings.convertTo);
            if (converted) finalBlob = converted;
          }
        }

        const originalName = sanitizeFilename(getNameFromUrl(url) || `image_${globalIndex}.jpg`);
        const ext = settings.convertTo !== 'original'
          ? settings.convertTo
          : (originalName.split('.').pop() || getExtFromMime(finalBlob.type) || 'jpg');

        let filename;
        if (settings.fileNamePattern === 'original') {
          filename = originalName.replace(/\.[^.]+$/, `.${ext}`);
        } else if (settings.fileNamePattern === 'custom') {
          const customName = settings.customFileName || defaults.customFileName;
          if (urls.length === 1) {
            filename = `${customName}.${ext}`;
          } else {
            filename = globalIndex === 0 ? `${customName}.${ext}` : `${customName}-${globalIndex}.${ext}`;
          }
        } else {
          filename = `image_${globalIndex + 1}.${ext}`;
        }

        zip.file(filename, finalBlob);
        completed++;
        sendProgress();
        return { success: true, index: globalIndex };
      } catch (e) {
        console.warn('Не удалось загрузить:', url, e);
        completed++;
        sendProgress();
        return { success: false, index: globalIndex };
      }
    });

    await Promise.all(chunkPromises);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: `${folderName}.zip`,
      saveAs: false
    });
  };
  reader.readAsDataURL(zipBlob);
}

function getNameFromUrl(url) {
  try { return new URL(url).pathname.split('/').pop() || null; } catch { return null; }
}

function getExtFromUrl(url) {
  try {
    const name = new URL(url).pathname.split('/').pop();
    if (!name) return null;
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : null;
  } catch { return null; }
}

function getExtFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
    'image/tiff': 'tiff', 'image/svg+xml': 'svg', 'image/avif': 'avif'
  };
  return map[mime] || null;
}

async function convertBlob(blob, format) {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    const mime = {
      jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon',
      tiff: 'image/tiff', svg: 'image/svg+xml'
    }[format] || 'image/png';
    return await canvas.convertToBlob({ type: mime, quality: 0.9 });
  } catch (e) { return null; }
}