// BatRay by ClearEvo.com - Show on TV: draws frames, encodes them in the browser (WebCodecs), muxes fMP4 and uploads an HLS window to the relay
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

import { Muxer, StreamTarget } from './mp4-muxer.js';
import { BoxSplitter, takeSegments, tvLink, isSegmentStart } from './tv-logic.js';
import { drawTvFrame } from './tv-draw.js';

const API = '/batray/api';
// H.264 first (what a Chromecast / Android TV / smart-TV player expects in HLS);
// VP9 stays as the fallback for browsers built without H.264.
export const TV_CODECS = ['avc1.42E01E', 'avc1.4D401F', 'avc1.640028', 'vp09.00.10.08'];

const j = async (path, init = {}) => {
  const r = await fetch(`${API}/${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${path}: ${r.status} ${body.error || ''}`.trim()); e.status = r.status; throw e; }
  return body;
};

export class TvStream {
  /** opts: { width, height, fps, segS, bitrate, model(), log, onState, codecs, texts } */
  constructor(o) {
    this.width = o.width || 1920; this.height = o.height || 1080; this.fps = o.fps || 1; this.segS = o.segS || 4;
    this.bitrate = o.bitrate || Math.round(this.width * this.height * 0.25);   // ~500 kbps at 1080p: a near-static picture needs far less
    this.model = o.model || (() => ({ waiting: true })); this.log = o.log || (() => {}); this.onState = o.onState || (() => {});
    this.codecs = o.codecs || TV_CODECS;
    this.state = { live: false, url: null, id: null, codec: null, segs: 0, bytes: 0, hits: 0, pullAgeS: null, error: null, uploading: 0 };
    this.frame = 0; this.n = 0; this.tick = 0; this.sinceKey = 0; this.pendingDurs = []; this.initSent = false;
    this.chain = Promise.resolve(); this.stopped = false;
  }
  emit() { this.onState({ ...this.state }); }

  async start() {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') { const e = new Error('no WebCodecs'); e.code = 'nocodec'; throw e; }
    for (const c of this.codecs) {
      const cfg = this.encoderConfig(c);
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { this.codec = c; break; } } catch { /* next */ }
    }
    if (!this.codec) { const e = new Error('no supported video encoder'); e.code = 'nocodec'; throw e; }
    const { tv, token } = await j('tv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codecs: this.codec, target: this.segS + 1 }) });
    this.id = tv; this.token = token;
    this.state.id = tv; this.state.url = tvLink(location.origin, tv); this.state.codec = this.codec;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.width; this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.splitter = new BoxSplitter();
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (d, pos) => this.splitter.push(d, pos) }),
      video: { codec: this.codec.startsWith('avc') ? 'avc' : 'vp9', width: this.width, height: this.height },
      fastStart: 'fragmented', minFragmentDuration: Math.max(0.5, this.segS - 0.5), firstTimestampBehavior: 'strict',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { this.muxer.addVideoChunk(chunk, meta); if (chunk.type === 'key') this.harvest(); } catch (e) { this.fail(e); }
      },
      error: (e) => this.fail(e),
    });
    this.encoder.configure(this.encoderConfig(this.codec));
    this.log(`tv: ${this.width}x${this.height} ${this.codec} ${Math.round(this.bitrate / 1000)} kbps, ${this.segS} s segments -> ${this.state.url}`);
    this.state.live = true; this.emit();
    this.timer = setInterval(() => this.tickFrame(), 1000 / this.fps);
    this.statusTimer = setInterval(() => this.poll(), 5000);
    this.tickFrame();
    return this.state.url;
  }
  encoderConfig(codec) {
    const cfg = { codec, width: this.width, height: this.height, bitrate: this.bitrate, framerate: this.fps, latencyMode: 'realtime' };
    if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    return cfg;
  }
  tickFrame() {
    if (this.stopped || !this.encoder || this.encoder.state !== 'configured') return;
    if (this.encoder.encodeQueueSize > 2) { this.log('tv: encoder busy, frame skipped'); return; }
    this.tick++;
    let m; try { m = this.model(); } catch (e) { m = { waiting: true, waitingTxt: e.message }; }
    drawTvFrame(this.ctx, this.width, this.height, { tick: this.tick, ...m });
    const key = isSegmentStart(this.frame, this.fps, this.segS);
    if (key && this.frame > 0) { this.pendingDurs.push(this.sinceKey / this.fps); this.sinceKey = 0; }
    const vf = new VideoFrame(this.canvas, { timestamp: Math.round(this.frame * 1e6 / this.fps), duration: Math.round(1e6 / this.fps) });
    try { this.encoder.encode(vf, { keyFrame: key }); } finally { vf.close(); }
    this.frame++; this.sinceKey++;
  }
  /** Called right after the muxer closed a fragment: everything buffered is final. */
  harvest() {
    const { init, segments } = takeSegments(this.splitter);
    if (init && !this.initSent) { this.initSent = true; this.upload('init.mp4', init); }
    for (const seg of segments) { const dur = this.pendingDurs.length ? this.pendingDurs.shift() : this.sinceKey / this.fps; this.upload(`seg/${this.n++}`, seg, `&dur=${dur.toFixed(3)}`); }
  }
  upload(path, bytes, extra = '') {
    this.state.uploading++;
    this.chain = this.chain.then(async () => {
      if (this.stopped && !path.startsWith('seg')) return;
      try {
        const r = await fetch(`${API}/tv/${this.id}/${path}?token=${this.token}${extra}`, { method: 'PUT', body: bytes });
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        this.state.bytes += bytes.length; if (path.startsWith('seg')) this.state.segs++;
        this.state.error = null;
      } catch (e) { this.state.error = e.message; this.log(`tv: upload failed: ${e.message}`); }
      finally { this.state.uploading--; this.emit(); }
    });
  }
  async poll() {
    if (!this.id || this.stopped) return;
    try {
      const s = await j(`tv/${this.id}/status?token=${this.token}`);
      this.state.hits = s.hits; this.state.pullAgeS = s.pullAgeS === null || s.pullAgeS === undefined ? null : Math.round(s.pullAgeS);
      this.emit();
    } catch (e) { this.log(`tv: status: ${e.message}`); }
  }
  fail(e) {
    this.log(`tv: ${e.message}`); this.state.error = e.message; this.emit();
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer); clearInterval(this.statusTimer);
    try { if (this.encoder && this.encoder.state === 'configured') await this.encoder.flush(); } catch { /* */ }
    try { if (this.muxer) { this.muxer.finalize(); this.harvest(); } } catch { /* the last partial fragment is optional */ }
    try { if (this.encoder) this.encoder.close(); } catch { /* */ }
    await this.chain;
    if (this.id) { try { await fetch(`${API}/tv/${this.id}?token=${this.token}`, { method: 'DELETE' }); } catch { /* the relay forgets it in 2 min anyway */ } }
    this.state.live = false; this.emit();
    this.log('tv: stopped');
  }
}
