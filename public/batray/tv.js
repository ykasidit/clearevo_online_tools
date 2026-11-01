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
import { BoxSplitter, takeSegments, tvLink, tvMp4Link, isSegmentStart } from './tv-logic.js';
import { drawTvFrame } from './tv-draw.js';
import { Channel, select, sleep, every, isAbort, abortError } from './sync.js';

const API = '/batray/api';
// H.264 first (what a Chromecast / Android TV / smart-TV player expects in HLS);
// VP9 stays as the fallback for browsers built without H.264.
export const TV_CODECS = ['avc1.42E01E', 'avc1.4D401F', 'avc1.640028', 'vp09.00.10.08'];
// The stream is three loops under one stop signal (house rule, 0.9.84): frames (draw + encode, 1 / fps), the status
// poll (5 s) and the uploader (one PUT at a time from a queue). An upload that hangs ends after UPLOAD_MS instead of
// holding every later segment; a queue longer than QUEUE_MAX (an uplink slower than the stream) drops its oldest
// segments - a live picture never needs an old one - instead of growing for as long as the phone runs.
export const UPLOAD_MS = 15000, QUEUE_MAX = 20, STOP_DRAIN_MS = 15000;
// A WebCodecs encoder can die under the page (Chrome reclaims a hardware codec, MediaCodec fails) or wedge with its
// queue full: the frame loop builds a new one (a new init segment goes first, as in a revival), at most REBUILD_MAX
// times an hour; after that the stream stops and says so instead of sitting "live" on a frozen picture.
export const REBUILD_MAX = 5, BUSY_MS = 10000, RELAY_MS = 15000;
const END = Symbol('end');

const j = async (path, init = {}) => {
  const r = await fetch(`${API}/${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${path}: ${r.status} ${body.error || ''}`.trim()); e.status = r.status; throw e; }
  return body;
};

export class TvStream {
  /** opts: { width, height, fps, segS, bitrate, model(), log, onState, codecs, texts, uploadMs, queueMax } */
  constructor(o) {
    this.width = o.width || 1920; this.height = o.height || 1080; this.fps = o.fps || 1; this.segS = o.segS || 1;   // 1 s segments: a player needs 3 before it starts, so the first picture is ~3-4 s out
    this.bitrate = o.bitrate || Math.round(this.width * this.height * 0.25);   // ~500 kbps at 1080p: a near-static picture needs far less
    this.model = o.model || (() => ({ waiting: true })); this.log = o.log || (() => {}); this.onState = o.onState || (() => {});
    this.codecs = o.codecs || TV_CODECS;
    this.state = { live: false, url: null, mp4Url: null, id: null, codec: null, segs: 0, bytes: 0, hits: 0, pullAgeS: null, error: null, uploading: 0 };
    this.onFrame = o.onFrame || (() => {});
    this.state = { ...this.state, episodes: 0 };
    this.frame = 0; this.n = 0; this.tick = 0; this.sinceKey = 0; this.pendingDurs = []; this.initSent = false; this.initBytes = null; this.reviving = false;
    this.lastErr = null; this.errRepeat = 0;
    this.uploadMs = o.uploadMs || UPLOAD_MS; this.queueMax = o.queueMax || QUEUE_MAX;
    this.q = new Channel(); this.ac = new AbortController(); this.task = null; this.startTask = null; this.sendTask = null; this.stopped = false; this.dropped = 0;
    this.encErr = null; this.busySince = null; this.rebuilds = []; this.died = false;
  }
  emit() { this.onState({ ...this.state }); }

  /** One start per stream: a second call gets the first one's promise (never a second relay stream). */
  start() { if (this.startTask === null) this.startTask = this.begin(); return this.startTask; }
  async begin() {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') { const e = new Error('no WebCodecs'); e.code = 'nocodec'; throw e; }
    for (const c of this.codecs) {
      const cfg = this.encoderConfig(c);
      try { const r = await VideoEncoder.isConfigSupported(cfg); this.log(`tv: codec ${c} ${r.supported ? 'supported' : 'not supported'}`); if (r.supported) { this.codec = c; break; } } catch (e) { this.log(`tv: codec ${c} probe failed: ${e.message}`); }
    }
    if (!this.codec) { const e = new Error('no supported video encoder'); e.code = 'nocodec'; throw e; }
    this.own();                                                           // stopped while the codecs were probed
    const signal = this.ac.signal;
    const r = await select(signal, {
      post: (s) => j('tv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codecs: this.codec, target: this.segS + 1 }), signal: s }),
      late: (s) => sleep(RELAY_MS, s),
    });
    if (r.key === 'late') throw new Error(`the relay did not answer in ${RELAY_MS / 1000} s`);
    const { tv, token } = r.value;
    this.id = tv; this.token = token;
    this.own();
    this.state.id = tv; this.state.url = tvLink(location.origin, tv); this.state.mp4Url = tvMp4Link(location.origin, tv); this.state.codec = this.codec;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.width; this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.makeEncoder();
    this.log(`tv: ${this.width}x${this.height} ${this.codec} ${Math.round(this.bitrate / 1000)} kbps, ${this.segS} s segments -> ${this.state.url}`);
    this.state.live = true; this.emit();
    const died = (what) => (e) => { if (!isAbort(e)) this.fail(new Error(`${what} loop died: ${e.message}`)); };
    this.task = this.frames(signal).catch(died('frame'));
    void every(5000, () => this.poll(), { signal, onError: (e) => this.uploadFailed(`status: ${e.message}`) }).catch(died('status'));
    this.sendTask = this.sender().catch(died('upload'));                 // not on the stop signal: stop() drains it first
    return this.state.url;
  }
  /** Stopped meanwhile: end start() here (an encoder made after a stop would never be closed). */
  own() { if (this.stopped) throw abortError(); }
  /** A fresh splitter, muxer and encoder: at start, and when the old encoder died. Its first fragment carries a new
   *  init segment, sent before its segments (the queue keeps the order). */
  makeEncoder() {
    this.splitter = new BoxSplitter();
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (d, pos) => this.splitter.push(d, pos) }),
      video: { codec: this.codec.startsWith('avc') ? 'avc' : 'vp9', width: this.width, height: this.height },
      fastStart: 'fragmented', minFragmentDuration: Math.max(0.5, this.segS - 0.5), firstTimestampBehavior: 'strict',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { this.muxer.addVideoChunk(chunk, meta); if (chunk.type === 'key') this.harvest(); } catch (e) { this.encErr = this.encErr || e; }
      },
      error: (e) => { this.encErr = this.encErr || e; },                // the boundary only notes it; the frame loop recovers
    });
    this.encoder.configure(this.encoderConfig(this.codec));
    this.frame = 0; this.sinceKey = 0; this.pendingDurs = []; this.initSent = false; this.busySince = null;
  }
  /** The encoder died or wedged: a new one, or - past REBUILD_MAX an hour - the stream stops and says so. */
  recover() {
    const e = this.encErr, now = Date.now(); this.encErr = null;
    this.rebuilds = this.rebuilds.filter((t) => now - t < 3600e3);
    if (this.rebuilds.length >= REBUILD_MAX) {
      this.died = true; this.state.live = false; this.state.error = `the video encoder keeps failing (${e.message})`;
      this.log(`tv: the encoder failed again (${e.message}) - ${REBUILD_MAX} new ones within an hour, the stream stops`);
      this.ac.abort(); this.q.push(END); this.emit();                   // the uploader ends after what is queued, stopped or not
      return;
    }
    this.rebuilds.push(now);
    this.log(`tv: the encoder failed (${e.message}) - building a new one (${this.rebuilds.length} in the last hour)`);
    try { if (this.encoder.state !== 'closed') this.encoder.close(); } catch { /* already gone */ }
    this.makeEncoder();
    this.state.episodes++; this.emit();
  }
  encoderConfig(codec) {
    const cfg = { codec, width: this.width, height: this.height, bitrate: this.bitrate, framerate: this.fps, latencyMode: 'realtime' };
    if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    return cfg;
  }
  /** Draw and encode one frame every 1 / fps. A frame that throws is reported and the loop goes on. */
  async frames(signal) {
    for (;;) {
      if (this.encErr) this.recover();
      if (this.died) return;
      try { this.tickFrame(); } catch (e) { this.encErr = this.encErr || e; }
      await sleep(1000 / this.fps, signal);
    }
  }
  tickFrame() {
    if (this.stopped || !this.encoder) return;
    if (this.encoder.state === 'closed') { this.encErr = this.encErr || new Error('the encoder was closed'); return; }
    if (this.encoder.state !== 'configured') return;
    if (this.encoder.encodeQueueSize > 2) {                                // busy: skip the frame; wedged for BUSY_MS: a new encoder
      const now = Date.now();
      if (this.busySince === null) { this.busySince = now; this.log('tv: encoder busy, frames skipped'); }
      else if (now - this.busySince > BUSY_MS) this.encErr = new Error(`the encoder has been busy for ${Math.round(BUSY_MS / 1000)} s`);
      return;
    }
    this.busySince = null;
    this.tick++;
    let m; try { m = this.model(); } catch (e) { m = { waiting: true, waitingTxt: e.message }; }
    drawTvFrame(this.ctx, this.width, this.height, { tick: this.tick, ...m });
    try { this.onFrame(this.canvas); } catch { /* the preview is optional */ }
    const key = isSegmentStart(this.frame, this.fps, this.segS);
    if (key && this.frame > 0) { this.pendingDurs.push(this.sinceKey / this.fps); this.sinceKey = 0; }
    const vf = new VideoFrame(this.canvas, { timestamp: Math.round(this.frame * 1e6 / this.fps), duration: Math.round(1e6 / this.fps) });
    try { this.encoder.encode(vf, { keyFrame: key }); } finally { vf.close(); }
    this.frame++; this.sinceKey++;
  }
  /** Called right after the muxer closed a fragment: everything buffered is final. */
  harvest() {
    const { init, segments } = takeSegments(this.splitter);
    if (init) this.initBytes = init;
    if (init && !this.initSent) { this.initSent = true; this.upload('init.mp4', init); }
    for (const seg of segments) { const dur = this.pendingDurs.length ? this.pendingDurs.shift() : this.sinceKey / this.fps; this.upload('seg', seg, `&dur=${dur.toFixed(3)}`); }   // numbered when sent: a dropped segment leaves no gap in the playlist
  }
  /** Queue an upload; the uploader loop sends them in order. */
  upload(path, bytes, extra = '') {
    if (path.startsWith('seg')) {
      while (this.q.size >= this.queueMax) {
        const old = this.q.remove((x) => x !== END && x.path.startsWith('seg'));
        if (!old) break;
        this.state.uploading--; this.dropped++;
        if (this.dropped === 1 || this.dropped % 50 === 0) this.log(`tv: the uplink is behind - dropped ${this.dropped} old segment${this.dropped > 1 ? 's' : ''} so far (queue ${this.queueMax})`);
      }
    }
    this.state.uploading++;
    this.q.push({ path, bytes, extra });
  }
  /** One PUT at a time until stop() queues END. */
  async sender() {
    for (;;) {
      const job = await this.q.next();
      if (job === END) return;
      try { await this.put(job); } finally { this.state.uploading--; this.emit(); }
    }
  }
  async put({ path: queued, bytes, extra }) {
    const path = queued === 'seg' ? `seg/${this.n++}` : queued;
    if (this.stopped && !path.startsWith('seg')) return;
    if (this.reviving && path.startsWith('seg')) return;                    // queued before the init goes again: the relay would refuse them
    if (path === 'init.mp4') this.reviving = false;
    const t0 = Date.now();
    try {
      const r = await select(null, {
        put: (s) => fetch(`${API}/tv/${this.id}/${path}?token=${this.token}${extra}`, { method: 'PUT', body: bytes, signal: s }),
        late: (s) => sleep(this.uploadMs, s),
      });
      if (r.key === 'late') throw new Error(`${path}: no answer in ${this.uploadMs / 1000} s`);
      const res = r.value;
      if ((res.status === 404 || res.status === 409) && path.startsWith('seg')) { this.revive(`${path}: ${res.status}`); return; }
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      this.state.bytes += bytes.length; if (path.startsWith('seg')) this.state.segs++;
      this.uploadOk();
      this.log(`tv: ${path} ${Math.round(bytes.length / 1024)} KB in ${Date.now() - t0} ms`);
    } catch (e) { this.uploadFailed(e.message); }
  }
  /** The relay forgot the segments (no upload for 2 min: a Wi-Fi gap) but kept the token, so the init segment
   *  sent again revives the same stream and the link stays valid. The reader used to PUT into a deleted stream
   *  for hours, two log lines a second (owner's log 2026-09-29). */
  revive(why) {
    if (!this.initBytes) { this.uploadFailed(`${why} and no init segment to send again`); return; }
    this.reviving = true; this.initSent = true; this.state.segs = 0; this.state.episodes++;
    this.log(`tv: the relay dropped the stream (${why}) - sending the init segment again, same link (revival ${this.state.episodes})`);
    this.upload('init.mp4', this.initBytes);
  }
  /** Errors are logged when they change, plus one line with the repeat count when they stop. */
  uploadFailed(msg) {
    this.state.error = msg;
    if (msg === this.lastErr) { this.errRepeat++; return; }
    this.flushRepeat(); this.lastErr = msg; this.log(`tv: upload failed: ${msg}`);
  }
  uploadOk() { this.state.error = null; if (this.lastErr) { this.flushRepeat(); this.log('tv: uploads ok again'); this.lastErr = null; } }
  flushRepeat() { if (this.errRepeat) { this.log(`tv: (that upload error repeated ${this.errRepeat} more times)`); this.errRepeat = 0; } }
  async poll() {
    if (!this.id || this.stopped) return;
    try {
      const r = await select(this.ac.signal, { s: (sg) => j(`tv/${this.id}/status?token=${this.token}`, { signal: sg }), late: (sg) => sleep(RELAY_MS, sg) });
      if (r.key === 'late') throw new Error(`no answer in ${RELAY_MS / 1000} s`);
      const s = r.value;
      this.state.hits = s.hits; this.state.pullAgeS = s.pullAgeS === null || s.pullAgeS === undefined ? null : Math.round(s.pullAgeS);
      this.emit();
    } catch (e) { if (!isAbort(e)) this.uploadFailed(`status: ${e.message}`); }
  }
  fail(e) {
    this.log(`tv: ${e.message}`); this.state.error = e.message; this.emit();
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ac.abort();                                                      // frames, the status poll and a start still running end here
    try { if (this.encoder && this.encoder.state === 'configured') await select(null, { f: () => this.encoder.flush(), late: (s) => sleep(5000, s) }); } catch { /* a wedged encoder: closed below */ }
    try { if (this.muxer) { this.muxer.finalize(); this.harvest(); } } catch { /* the last partial fragment is optional */ }
    try { if (this.encoder) this.encoder.close(); } catch { /* */ }
    this.q.push(END);                                                     // the uploader sends what is queued, then ends
    if (this.sendTask !== null) { const r = await select(null, { done: () => this.sendTask, late: (s) => sleep(STOP_DRAIN_MS, s) }); if (r.key === 'late') this.log(`tv: uploads still pending after ${STOP_DRAIN_MS / 1000} s - leaving them`); }
    this.flushRepeat();
    if (this.id) { try { await select(null, { d: (s) => fetch(`${API}/tv/${this.id}?token=${this.token}`, { method: 'DELETE', signal: s }), late: (s) => sleep(5000, s) }); } catch { /* the relay forgets it in 2 min anyway */ } }
    this.state.live = false; this.emit();
    this.log('tv: stopped');
  }
}
