import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';

const W = 1280;
const H = 720;
const BG = '0x0f1628'; // midnight lacquer behind letterboxing and picture-less moments

export function run(bin, args, { timeoutMs = 6 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 20000) err = err.slice(-10000);
    });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(bin)} exited with ${code}: ${err.trim().slice(-800)}`));
    });
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const sec = (ms) => (ms / 1000).toFixed(3);

/**
 * Turns the raw per-track files of a recording into one MP4.
 *
 * manifest: {
 *   durationMs,
 *   audio: [{ file }],                       Ogg Opus, all aligned to t=0
 *   video: [{ id, file, firstPtsMs }],       VP8 IVF, timestamps in ms since the recording start
 *   timeline: [{ at, video }]                which video id is on screen from `at` (ms), null = none
 * }
 */
export async function compose(dir, manifest, outFile) {
  const dur = Math.max(1, manifest.durationMs);
  const tmp = [];
  try {
    // 1. Normalise every picture track to 1280x720 on its own (resolution changes, e.g. a shared
    //    window being resized, are handled by FFmpeg's per-input filter re-initialisation).
    const tracks = [];
    for (const v of manifest.video) {
      const intervals = [];
      manifest.timeline.forEach((seg, i) => {
        if (seg.video !== v.id) return;
        const end = manifest.timeline[i + 1]?.at ?? dur;
        if (end > seg.at) intervals.push([seg.at, end]);
      });
      if (!intervals.length || v.firstPtsMs === null || v.firstPtsMs === undefined) continue;
      const stat = await fs.stat(path.join(dir, v.file)).catch(() => null);
      if (!stat || stat.size <= 32) continue;
      const norm = path.join(dir, `${v.id}.norm.mkv`);
      tmp.push(norm);
      await run(env.FFMPEG_PATH, [
        '-hide_banner', '-loglevel', 'error', '-i', path.join(dir, v.file),
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},format=yuv420p`,
        '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-an', '-y', norm,
      ]);
      tracks.push({ file: norm, offset: v.firstPtsMs, intervals });
    }

    // 2. Lay the pictures over a canvas, each only during its moments on screen, and mix the voices.
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=30:d=${sec(dur)}`];
    for (const t of tracks) args.push('-i', t.file);
    const audioStart = 1 + tracks.length;
    for (const a of manifest.audio) args.push('-i', path.join(dir, a.file));
    const f = [];
    let last = '[0:v]';
    tracks.forEach((t, i) => {
      const enable = t.intervals.map(([a, b]) => `between(t,${sec(a)},${sec(b)})`).join('+');
      f.push(`[${i + 1}:v]setpts=PTS-STARTPTS+${sec(t.offset)}/TB[t${i}]`);
      f.push(`${last}[t${i}]overlay=eof_action=pass:repeatlast=1:enable='${enable}'[o${i}]`);
      last = `[o${i}]`;
    });
    f.push(`${last}fps=30,format=yuv420p[v]`);
    if (manifest.audio.length) {
      const ins = manifest.audio.map((_, i) => `[${audioStart + i}:a]`).join('');
      f.push(`${ins}amix=inputs=${manifest.audio.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad,atrim=0:${sec(dur)}[a]`);
    } else {
      f.push(`anullsrc=r=48000:cl=mono,atrim=0:${sec(dur)}[a]`);
    }
    args.push(
      '-filter_complex', f.join(';'),
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-t', sec(dur), '-movflags', '+faststart', '-y', outFile,
    );
    await run(env.FFMPEG_PATH, args);
  } finally {
    for (const t of tmp) await fs.rm(t, { force: true });
  }
}

export async function probe(file) {
  const out = JSON.parse(await run(env.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height', '-of', 'json', file], { timeoutMs: 60_000 }));
  return {
    durationSec: Math.round(Number(out.format?.duration || 0)),
    sizeBytes: Number(out.format?.size || 0),
    streams: (out.streams || []).map((s) => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height })),
  };
}

export async function thumbnail(file, outFile, durationSec) {
  const at = Math.min(Math.max(1, durationSec * 0.2), Math.max(0, durationSec - 0.5));
  await run(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', '-y', outFile], { timeoutMs: 60_000 });
}
