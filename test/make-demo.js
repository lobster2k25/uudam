// Turns the frames from record-demo.js into docs/demo.mp4 (1080p, with sound) and docs/demo.gif (1280 wide, 15 fps).
// While the popup is open the picture zooms in smoothly on the popup and the subtitle line, then back out.
// Usage: FFMPEG=<path to ffmpeg.exe> node test/make-demo.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const frames = path.join(__dirname, 'out', 'demo-frames');
const docs = path.join(__dirname, '..', 'docs');
const { times, player, marks } = JSON.parse(fs.readFileSync(path.join(frames, 'times.json'), 'utf8'));
const even = (v) => Math.round(v / 2) * 2;

// The 16:9 video inside the player.
const down2 = (v) => Math.floor(v / 2) * 2;
const vh = down2(Math.min(player.h, (player.w * 9) / 16));
const vw = down2((vh * 16) / 9);
const x0 = even(player.x + (player.w - vw) / 2);
const y0 = even(player.y + (player.h - vh) / 2);
const s = 1920 / vw; // page px → output px

// Zoom target: the popup and the line, with some room around them, kept inside the picture.
const pad = 40;
const f = { x: (marks.focus.x - x0) * s - pad, y: (marks.focus.y - y0) * s - pad, w: marks.focus.w * s + 2 * pad, h: marks.focus.h * s + 2 * pad };
const Z = Math.min(1920 / f.w, 1080 / f.h, 2);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cx = clamp(f.x + f.w / 2, 960 / Z, 1920 - 960 / Z);
const cy = clamp(f.y + f.h / 2, 540 / Z, 1080 - 540 / Z);

// e(t): 0 → 1 (smoothstep over D s) after zoomIn, back to 0 after zoomOut. Times relative to the first frame.
const t0 = times[0];
const a = marks.zoomIn - t0 + 0.2;
const b = marks.zoomOut - t0 + 0.3;
const D = 0.9;
const step = (start) => `(clip((on/30-${start.toFixed(3)})/${D},0,1)*clip((on/30-${start.toFixed(3)})/${D},0,1)*(3-2*clip((on/30-${start.toFixed(3)})/${D},0,1)))`;
const e = `(${step(a)}-${step(b)})`;
// zoompan on a 2× picture (3840×2160) so the slow pan doesn't jitter.
const z = `1+${(Z - 1).toFixed(4)}*${e}`;
const x = `(1920+${(cx * 2 - 1920).toFixed(1)}*${e})-iw/zoom/2`;
const y = `(1080+${(cy * 2 - 1080).toFixed(1)}*${e})-ih/zoom/2`;
const vf = `crop=${vw}:${vh}:${x0}:${y0},scale=3840:2160:flags=lanczos:out_range=tv,setsar=1,fps=30,`
  + `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=1920x1080:fps=30,setsar=1,format=yuv420p`;

console.log(`video ${vw}x${vh}+${x0}+${y0}, zoom ${Z.toFixed(2)}x to (${Math.round(cx)}, ${Math.round(cy)}) from ${a.toFixed(1)} s to ${b.toFixed(1)} s`);
const audio = path.join(frames, 'audio.webm');
const hasAudio = fs.existsSync(audio);
const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
run([
  '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
  ...(hasAudio ? ['-itsoffset', (marks.audio - t0).toFixed(3), '-i', audio] : []),
  '-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
  ...(hasAudio ? ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : []),
  '-color_range', 'tv', '-movflags', '+faststart', path.join(docs, 'demo.mp4'),
]);
run([
  '-i', path.join(docs, 'demo.mp4'),
  '-vf', 'fps=15,scale=1280:-1:flags=lanczos,hqdn3d=3:3:6:6,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  path.join(docs, 'demo.gif'),
]);
for (const n of ['demo.mp4', 'demo.gif']) console.log(n, (fs.statSync(path.join(docs, n)).size / 1048576).toFixed(1), 'MB');
