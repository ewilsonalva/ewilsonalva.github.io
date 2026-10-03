/*
 * Popline rendering: ASS captions -> transparent ProRes 4444 overlay, plus preview stills / clips.
 * ffmpeg runs inside the session's work folder with the fonts copied next to the .ass file, so
 * no Windows drive-letter paths ever go into a filtergraph.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var util = require('./util.js');

/** Copy the bundled fonts into <workDir>/fonts once. */
function ensureFonts(extRoot, workDir) {
  var src = path.join(extRoot, 'fonts'), dst = path.join(workDir, 'fonts');
  fs.mkdirSync(dst, { recursive: true });
  fs.readdirSync(src).filter(function (n) { return /\.(ttf|otf)$/i.test(n); }).forEach(function (n) {
    var d = path.join(dst, n);
    if (!util.isFile(d)) fs.copyFileSync(path.join(src, n), d);
  });
  return dst;
}

function fpsArg(fps) {
  // 29.97 -> 30000/1001 etc. so frames line up with the sequence exactly.
  var known = { 23.976: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.952: '48000/1001', 119.88: '120000/1001' };
  var r = Math.round(fps * 1000) / 1000;
  return known[r] || String(Math.round(fps * 1000) / 1000);
}

function transparentSource(frame, durSec) {
  return 'color=c=black@0.0:s=' + frame.w + 'x' + frame.h + ':r=' + fpsArg(frame.fps || 30) + ':d=' + Math.max(0.1, durSec).toFixed(3) + ',format=rgba';
}

/**
 * Render the whole caption overlay as a transparent movie.
 * assName: file name of the .ass inside workDir. Returns {promise -> outPath, cancel}.
 */
function renderOverlay(tools, workDir, assName, frame, durSec, outPath, hooks) {
  hooks = hooks || {};
  var args = ['-hide_banner', '-y', '-f', 'lavfi', '-i', transparentSource(frame, durSec),
    '-vf', 'ass=' + assName + ':fontsdir=fonts:alpha=1',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-qscale:v', '11',
    '-progress', 'pipe:1', '-nostats', outPath];
  var job = runIn(tools.ffmpeg, args, workDir, function (line) {
    var m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m && hooks.onProgress) hooks.onProgress(Math.min(100, parseInt(m[1], 10) / 1e6 / durSec * 100));
  });
  return { cancel: job.cancel, promise: job.promise.then(function () { return outPath; }) };
}

/** Like util.run but with a working directory. */
function runIn(cmd, args, cwd, onLine) {
  var childProcess = require('child_process');
  var child = childProcess.spawn(cmd, args, { cwd: cwd, env: util.childEnv(), windowsHide: true });
  var tail = [], cancelled = false;
  function pump(stream) {
    var buf = '';
    stream.setEncoding('utf8');
    stream.on('data', function (c) {
      buf += c;
      var lines = buf.split(/\r\n|\n|\r/);
      buf = lines.pop();
      lines.forEach(function (l) { if (!l) return; tail.push(l); if (tail.length > 20) tail.shift(); if (onLine) onLine(l); });
    });
  }
  pump(child.stdout);
  pump(child.stderr);
  var promise = new Promise(function (resolve, reject) {
    child.on('error', function (e) { reject(e.code === 'ENOENT' ? new Error(path.basename(cmd) + ' not found.') : e); });
    child.on('close', function (code) {
      if (cancelled) return reject(Object.assign(new Error('Cancelled.'), { cancelled: true }));
      if (code === 0) return resolve();
      var errs = tail.filter(function (l) { return !/^[a-z_]+=/.test(l); });
      var msg = errs.slice(-3).join('\n') || 'ffmpeg exited with code ' + code;
      if (/No such filter: 'ass'|Filter not found/.test(msg)) msg = 'This ffmpeg was built without libass (needed to draw captions). Run the Popline installer, or put a full ffmpeg build in the bin/ folder.';
      else if (/libvpx|Unknown encoder/.test(msg)) msg = 'This ffmpeg cannot encode previews (no libvpx). Captions still render; use a full ffmpeg build for animated previews.';
      reject(new Error(msg));
    });
  });
  return {
    promise: promise,
    cancel: function () {
      if (child.exitCode != null) return;
      cancelled = true;
      if (util.IS_WIN) childProcess.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGTERM');
    }
  };
}

/**
 * A still of the source video at sequence time t, fitted into the sequence frame (letterboxed),
 * used as the preview background. src: { mediaPath, inSec, startSec, speed }
 */
function grabBackground(tools, src, t, frame, outPng) {
  var speed = src.speed && src.speed > 0 ? src.speed : 1;
  var srcTime = Math.max(0, (src.inSec || 0) + (t - src.startSec) * speed);
  var vf = 'scale=' + frame.w + ':' + frame.h + ':force_original_aspect_ratio=increase,crop=' + frame.w + ':' + frame.h;
  return util.run(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', srcTime.toFixed(3), '-i', src.mediaPath,
    '-frames:v', '1', '-vf', vf, '-update', '1', outPng]).promise.then(function () { return outPng; });
}

function backgroundInput(bgPng, frame) {
  if (bgPng && util.isFile(bgPng)) return ['-loop', '1', '-i', bgPng];
  return ['-f', 'lavfi', '-i', 'gradients=s=' + frame.w + 'x' + frame.h + ':c0=0x1d2b3a:c1=0x4a3560:seed=7'];
}

/** One preview frame at sequence-relative time t (seconds into the .ass timeline). */
function renderPreviewFrame(tools, workDir, assName, frame, t, bgPng, outName, width) {
  var w = width || 540;
  var args = ['-hide_banner', '-v', 'error', '-y'].concat(backgroundInput(bgPng, frame), [
    '-vf', 'scale=' + frame.w + ':' + frame.h + ',setpts=PTS+' + Math.max(0, t).toFixed(3) + '/TB,ass=' + assName + ':fontsdir=fonts,scale=' + w + ':-2',
    '-frames:v', '1', '-update', '1', outName]);
  return runIn(tools.ffmpeg, args, workDir).promise.then(function () { return path.join(workDir, outName); });
}

/** A short animated preview (WebM, plays in the panel) of [t0, t1]. */
function renderPreviewClip(tools, workDir, assName, frame, t0, t1, bgPng, outName, width) {
  var w = width || 432;
  var dur = Math.max(0.3, t1 - t0);
  var fps = Math.min(30, frame.fps || 30);
  var args = ['-hide_banner', '-v', 'error', '-y'].concat(backgroundInput(bgPng, frame), [
    '-t', dur.toFixed(3),
    '-vf', 'fps=' + fps + ',scale=' + frame.w + ':' + frame.h + ',setpts=PTS+' + t0.toFixed(3) + '/TB,ass=' + assName + ':fontsdir=fonts,scale=' + w + ':-2,setpts=PTS-STARTPTS,format=yuv420p',
    '-c:v', 'libvpx', '-b:v', '1500k', '-deadline', 'realtime', '-cpu-used', '8', '-an', outName]);
  return runIn(tools.ffmpeg, args, workDir).promise.then(function () { return path.join(workDir, outName); });
}

module.exports = {
  ensureFonts: ensureFonts,
  fpsArg: fpsArg,
  renderOverlay: renderOverlay,
  grabBackground: grabBackground,
  renderPreviewFrame: renderPreviewFrame,
  renderPreviewClip: renderPreviewClip,
  runIn: runIn
};
