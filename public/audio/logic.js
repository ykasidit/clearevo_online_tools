// ClearEvo.com Audio Converter - logic
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

// audio converter logic. Pure, tested.

export const OUT_FORMATS = [
  { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-q:a', '2'], label: 'MP3' },
  { ext: 'wav', args: ['-c:a', 'pcm_s16le'], label: 'WAV' },
  { ext: 'flac', args: ['-c:a', 'flac'], label: 'FLAC' },
  { ext: 'ogg', args: ['-c:a', 'libvorbis', '-q:a', '5'], label: 'OGG (Vorbis)' },
  { ext: 'opus', args: ['-c:a', 'libopus', '-b:a', '96k'], label: 'Opus' },
  { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '192k'], label: 'M4A (AAC)' },
];

// ponytail: honest in-browser ceilings - ffmpeg.wasm needs ~2-3x file size in
// RAM and mobile browsers kill long jobs; scoped to audio + small clips
export const WARN_BYTES = 100 * 1024 * 1024;
export const MAX_BYTES = 500 * 1024 * 1024;

export function sizeCheck(bytes, deviceMemGB) {
  if (bytes > MAX_BYTES) {
    return `file is ${(bytes / 1048576).toFixed(0)} MB - the in-browser converter is limited to ${MAX_BYTES / 1048576} MB (WebAssembly memory); for big videos use desktop ffmpeg`;
  }
  if (deviceMemGB && bytes * 3 > deviceMemGB * 1073741824 * 0.5) {
    return `file needs ~${(bytes * 3 / 1073741824).toFixed(1)} GB working memory but this device reports ${deviceMemGB} GB RAM - conversion would likely crash the tab`;
  }
  if (bytes > WARN_BYTES) return { warn: `large file (${(bytes / 1048576).toFixed(0)} MB) - in-browser conversion is ~10-20x slower than native ffmpeg; keep the tab in front` };
  return null;
}

export function buildArgs(inName, fmt, outName) {
  return ['-i', inName, '-vn', ...fmt.args, outName];
}

export function outName(inputName, ext) {
  const base = inputName.replace(/\.[^.]+$/, '');
  const name = base + '.' + ext;
  return name === inputName ? base + '_converted.' + ext : name;
}
