// ClearEvo.com GIS Converter - logic
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools

// geo converter logic. Pure, tested.

// single-file vector outputs only (multi-file outputs like Shapefile/MapInfo
// would need zipping; shapefile works as INPUT via multi-select)
export const OUT_FORMATS = [
  { drv: 'GeoJSON', ext: 'geojson', label: 'GeoJSON' },
  { drv: 'GPX', ext: 'gpx', label: 'GPX' },
  { drv: 'KML', ext: 'kml', label: 'KML' },
  { drv: 'GPKG', ext: 'gpkg', label: 'GeoPackage' },
  { drv: 'CSV', ext: 'csv', label: 'CSV' },
  { drv: 'SQLite', ext: 'sqlite', label: 'SQLite/Spatialite' },
  { drv: 'DXF', ext: 'dxf', label: 'DXF (CAD)' },
  { drv: 'FlatGeobuf', ext: 'fgb', label: 'FlatGeobuf' },
];

// browser wasm memory is the ceiling, not gdal
export const WARN_BYTES = 100 * 1024 * 1024;
export const MAX_BYTES = 300 * 1024 * 1024;

// null = ok, string = refuse reason, {warn} = proceed with warning
export function sizeCheck(totalBytes) {
  if (totalBytes > MAX_BYTES) {
    return `total input ${(totalBytes / 1048576).toFixed(0)} MB exceeds the ${MAX_BYTES / 1048576} MB in-browser limit (WebAssembly memory) - split the data or use desktop ogr2ogr`;
  }
  if (totalBytes > WARN_BYTES) return { warn: `large input (${(totalBytes / 1048576).toFixed(0)} MB) - conversion may be slow, keep the tab in front` };
  return null;
}

export function buildArgs(drv, tSrs) {
  const args = ['-f', drv];
  if (tSrs && tSrs.trim()) args.push('-t_srs', tSrs.trim());
  return args;
}

export function outName(inputName, ext) {
  return inputName.replace(/\.[^.]+$/, '') + '.' + ext;
}

// minimal ZIP reader for KMZ: return the first .kml entry's bytes.
// inflateRaw(Uint8Array) -> Promise<Uint8Array> is injected (browser:
// DecompressionStream('deflate-raw'), tests: node zlib). ZIP64 not supported.
export async function kmzExtractKml(bytes, inflateRaw) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid KMZ/ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('bad ZIP central directory');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    if (name.toLowerCase().endsWith('.kml')) {
      const dataOff = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = bytes.subarray(dataOff, dataOff + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    off += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('no .kml found inside the KMZ');
}

// quick sanity hint for shapefile inputs
export function shpHint(names) {
  const lower = names.map((n) => n.toLowerCase());
  const hasShp = lower.some((n) => n.endsWith('.shp'));
  if (hasShp && !lower.some((n) => n.endsWith('.dbf'))) {
    return 'a .shp needs its sibling .dbf (and .shx/.prj) - select them together';
  }
  return null;
}
