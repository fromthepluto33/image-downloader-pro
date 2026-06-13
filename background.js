// background.js – с client-zip worker (глобальная downloadZip)

async function convertBlob(blob, targetFormat) {
    if (targetFormat === 'original') return blob;
    try {
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        let mimeType = targetFormat === 'jpg' ? 'image/jpeg' : (targetFormat === 'png' ? 'image/png' : 'image/webp');
        const converted = await canvas.convertToBlob({ type: mimeType, quality: 0.92 });
        bitmap.close();
        return converted;
    } catch(e) {
        return blob;
    }
}

async function downloadSingleImage(url, targetFormat, fileName) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let blob = await response.blob();
        let ext = (url.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
        if (targetFormat !== 'original' && targetFormat !== ext) {
            blob = await convertBlob(blob, targetFormat);
            ext = targetFormat;
        }
        let safeName = fileName.replace(/[<>:"/\\|?*]/g, '_').trim();
        if (!safeName || safeName === 'i') safeName = 'image';
        const finalFileName = `${safeName}.${ext}`;
        const objectUrl = URL.createObjectURL(blob);
        chrome.downloads.download({ url: objectUrl, filename: finalFileName, saveAs: true }, () => URL.revokeObjectURL(objectUrl));
    } catch(e) {
        console.error('Single download error:', e);
    }
}

async function downloadBatch(images, zipFileName) {
    const files = [];
    for (const img of images) {
        try {
            const response = await fetch(img.url);
            if (!response.ok) continue;
            let blob = await response.blob();
            let ext = (img.url.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
            if (img.targetFormat !== 'original' && img.targetFormat !== ext) {
                blob = await convertBlob(blob, img.targetFormat);
                ext = img.targetFormat;
            }
            let safeBase = img.baseName.replace(/[<>:"/\\|?*]/g, '_').trim();
            if (!safeBase || safeBase === 'i') safeBase = 'image';
            const fileName = `${safeBase}.${ext}`;
            files.push({ name: fileName, input: blob });
        } catch(e) {
            console.warn(e);
        }
    }
    const zipBlob = await downloadZip(files).blob(); // downloadZip – глобальная
    const objectUrl = URL.createObjectURL(zipBlob);
    chrome.downloads.download({ url: objectUrl, filename: zipFileName, saveAs: true }, () => URL.revokeObjectURL(objectUrl));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'downloadSingleImage') {
        downloadSingleImage(msg.url, msg.targetFormat, msg.fileName);
        sendResponse({ status: 'processing' });
    } else if (msg.action === 'downloadBatch') {
        downloadBatch(msg.images, msg.zipFileName);
        sendResponse({ status: 'processing' });
    }
    return true;
});

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
    } catch(e) {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/util.js', 'content/imageCollector.js', 'content/areaSelector.js', 'content/panel.js']
        });
        await new Promise(r => setTimeout(r, 150));
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
    }
});