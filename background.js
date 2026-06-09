/**
 * Image Downloader Pro — background service worker (Chrome + Firefox).
 */
if (typeof importScripts !== 'undefined') {
  importScripts('shared/common.js', 'shared/zip.js');
}

const {
  api,
  DEFAULT_SETTINGS,
  normalizeFormat,
  formatToMime,
  guessExt,
  ensureZipName,
  buildFileName
} = IDPCommon;

const { zipStore } = IDPZip;

const CONTENT_SCRIPTS = [
  'shared/common.js',
  'content/util.js',
  'content/imageCollector.js',
  'content/areaSelector.js',
  'content/panel.js'
];

async function convertImage(blob, targetFormat) {
  const format = normalizeFormat(targetFormat);
  if (format === 'original') return blob;

  const mimeType = formatToMime(format);
  if (!mimeType) return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: mimeType, quality: 0.92 });
  } finally {
    bitmap.close();
  }
}

async function processImageUrl(url, index, total, settings) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let blob = await response.blob();
  let ext = guessExt(url, blob);
  const convertTo = normalizeFormat(settings.convertTo);

  if (convertTo !== 'original') {
    blob = await convertImage(blob, convertTo);
    ext = convertTo;
  }

  const name = buildFileName(url, index, total, settings, ext);
  const buffer = await blob.arrayBuffer();
  return { name, data: new Uint8Array(buffer) };
}

async function downloadImages(urls, rawSettings = {}) {
  if (!urls?.length) throw new Error('No URLs');

  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  const files = [];

  for (let i = 0; i < urls.length; i++) {
    try {
      files.push(await processImageUrl(urls[i], i, urls.length, settings));
    } catch (err) {
      console.warn(`Skipped ${urls[i]}:`, err);
    }
  }

  if (!files.length) throw new Error('No images processed');

  const zipBytes = zipStore(files);
  const zipFileName = ensureZipName(settings.zipFileName);
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength
  );

// Превращаем ArrayBuffer в обычный массив для безопасной передачи через sendMessage
const zipArray = Array.from(new Uint8Array(zipBuffer));
return { zipBuffer: zipArray, zipFileName };
}

async function injectPanel(tabId) {
  await api.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPTS
  });
  await new Promise((r) => setTimeout(r, 100));
  await api.tabs.sendMessage(tabId, { action: 'togglePanel' });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'downloadImages') return false;

  downloadImages(message.urls, message.settings)
    .then((result) => sendResponse({ success: true, ...result }))
    .catch((err) => {
      console.error('downloadImages failed:', err);
      sendResponse({ success: false, error: String(err.message || err) });
    });

  return true;
});

api.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  api.tabs.sendMessage(tab.id, { action: 'togglePanel' }).catch(async (err) => {
    const msg = String(err?.message || err);
    if (!msg.includes('Could not establish connection') && !msg.includes('Receiving end does not exist')) {
      console.warn('togglePanel:', err);
      return;
    }
    try {
      await injectPanel(tab.id);
    } catch (injectErr) {
      console.error('Failed to inject panel:', injectErr);
    }
  });
});

console.log('Image Downloader Pro: background ready');
