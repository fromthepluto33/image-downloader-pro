/**
 * Минимальный ZIP (метод STORE, без сжатия) для service worker.
 * Без streams и URL.createObjectURL — Chrome + Firefox.
 */
(function (root) {
  const encoder = new TextEncoder();

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosTimeDate(date) {
    const d = date || new Date();
    const year = Math.max(1980, d.getFullYear());
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = Math.floor(d.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosTime, dosDate };
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  /**
   * @param {{ name: string, data: Uint8Array }[]} files
   * @returns {Uint8Array}
   */
  function zipStore(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = dosTimeDate(new Date());

    for (const file of files) {
      const nameBytes = encoder.encode(file.name.replace(/\\/g, '/'));
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const checksum = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      writeUint32(lv, 0, 0x04034b50);
      writeUint16(lv, 4, 20);
      writeUint16(lv, 6, 0);
      writeUint16(lv, 8, 0);
      writeUint16(lv, 10, now.dosTime);
      writeUint16(lv, 12, now.dosDate);
      writeUint32(lv, 14, checksum);
      writeUint32(lv, 18, data.length);
      writeUint32(lv, 22, data.length);
      writeUint16(lv, 26, nameBytes.length);
      writeUint16(lv, 28, 0);
      local.set(nameBytes, 30);

      localParts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      writeUint32(cv, 0, 0x02014b50);
      writeUint16(cv, 4, 20);
      writeUint16(cv, 6, 20);
      writeUint16(cv, 8, 0);
      writeUint16(cv, 10, 0);
      writeUint16(cv, 12, now.dosTime);
      writeUint16(cv, 14, now.dosDate);
      writeUint32(cv, 16, checksum);
      writeUint32(cv, 20, data.length);
      writeUint32(cv, 24, data.length);
      writeUint16(cv, 28, nameBytes.length);
      writeUint16(cv, 30, 0);
      writeUint16(cv, 32, 0);
      writeUint16(cv, 34, 0);
      writeUint16(cv, 36, 0);
      writeUint32(cv, 38, 0);
      writeUint32(cv, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    writeUint32(ev, 0, 0x06054b50);
    writeUint16(ev, 4, 0);
    writeUint16(ev, 6, 0);
    writeUint16(ev, 8, files.length);
    writeUint16(ev, 10, files.length);
    writeUint32(ev, 12, centralSize);
    writeUint32(ev, 16, offset);
    writeUint16(ev, 20, 0);

    const totalSize = offset + centralSize + end.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;

    for (const part of localParts) {
      result.set(part, pos);
      pos += part.length;
    }
    for (const part of centralParts) {
      result.set(part, pos);
      pos += part.length;
    }
    result.set(end, pos);

    return result;
  }

  root.IDPZip = { zipStore };
})(typeof globalThis !== 'undefined' ? globalThis : self);
