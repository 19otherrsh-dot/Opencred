import { deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer.
 *
 * A `.pkpass` is a ZIP archive, and this is the only reason we need one. The
 * archive is a handful of small files, so a 120-line writer over `zlib` is a
 * better trade than a dependency — and, more to the point, it lets the byte
 * layout be *read* by whoever is auditing how a signed pass is assembled.
 *
 * Supports store and deflate, which is the whole of what PKZIP requires for
 * this use and what every unzip implementation handles.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Table-driven CRC-32, as ZIP requires. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * MS-DOS date and time, which is what ZIP stores.
 *
 * A fixed timestamp is used by default rather than "now": two builds of the
 * same pass should produce identical bytes, so that a diff of two `.pkpass`
 * files shows a content change rather than the clock moving.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function createZip(entries: ZipEntry[], modifiedAt = new Date(0)): Buffer {
  const { time, date } = dosDateTime(modifiedAt);

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.data;
    const crc = crc32(uncompressed);

    // Only take deflate if it actually helps; tiny JSON files often inflate.
    const deflated = deflateRawSync(uncompressed, { level: 9 });
    const useDeflate = deflated.length < uncompressed.length;
    const body = useDeflate ? deflated : uncompressed;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Entry names in a built archive, for tests and inspection. */
export function listZipEntries(zip: Buffer): string[] {
  const names: string[] = [];
  let position = 0;

  while (position < zip.length - 4) {
    if (zip.readUInt32LE(position) !== LOCAL_HEADER) break;
    const nameLength = zip.readUInt16LE(position + 26);
    const extraLength = zip.readUInt16LE(position + 28);
    const compressedSize = zip.readUInt32LE(position + 18);
    names.push(zip.subarray(position + 30, position + 30 + nameLength).toString('utf8'));
    position += 30 + nameLength + extraLength + compressedSize;
  }

  return names;
}
