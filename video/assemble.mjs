// Cut a Short together from the generated scenes and the rendered voice lines.
//
//   node video/assemble.mjs shorts-01-two-numbers
//   node video/assemble.mjs shorts-01-two-numbers --variant 2-contradiction
//   node video/assemble.mjs shorts-01-two-numbers --no-b4
//
// Needs ffmpeg plus the outputs of scenes.py and tts.mjs. Every input is
// generated, so this is reproducible: delete the mp4 and run the three commands.
//
// A beat is three pieces, so ffmpeg only plays real frames while the circle is
// being drawn and holds a still the rest of the time:
//
//   base  ->  held until circleAt of the spoken line
//   anim  ->  12 frames at 24fps, the circle going on
//   done  ->  held to the end of the line, plus the pause
//
// circleAt is per beat in lines.json, set so the circle closes as the figure is
// said rather than before it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--")) || "shorts-01-two-numbers";
const variant = args.includes("--variant") ? args[args.indexOf("--variant") + 1] : "1-number";
const dropB4 = args.includes("--no-b4");

const PAD = { hook: 0.55, line: 0.35, last: 0.9 };
const ANIM_FPS = 24, ANIM_N = 12;
const ANIM_LEN = ANIM_N / ANIM_FPS;

const dir = join(HERE, folder);
const audio = join(dir, "audio");
const work = join(dir, ".work");
const spec = JSON.parse(readFileSync(join(dir, "lines.json"), "utf8"));

const dur = (f) => Number(execFileSync("ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
  { encoding: "utf8" }).trim());

const beats = [
  { wav: join(audio, `hook-${variant}.wav`), scene: spec.hookScene,
    at: spec.hookCircleAt, pad: PAD.hook },
  ...spec.body.filter((b) => !(dropB4 && b.id === "b4")).map((b, i, a) => ({
    wav: join(audio, `${b.id}.wav`), scene: b.scene, at: b.circleAt,
    pad: i === a.length - 1 ? PAD.last : PAD.line,
  })),
  { wav: null, scene: null, pad: 2.2 },
];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const V = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30"];
const A = ["-c:a", "aac", "-b:a", "192k", "-ar", "24000"];
const segs = [];

function still(png, len, wav, offset, idx, tag) {
  const seg = join(work, `s${String(idx).padStart(2, "0")}${tag}.mp4`);
  // Each piece takes its slice of the line's audio, so speech stays continuous
  // across the base/anim/done cut rather than restarting.
  const a = wav
    ? ["-ss", String(offset), "-i", wav, "-filter_complex", `[1:a]apad=whole_dur=${len}[a]`,
       "-map", "0:v", "-map", "[a]"]
    : ["-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=24000:cl=mono",
       "-map", "0:v", "-map", "1:a"];
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-t", String(len),
    "-i", png, ...a, ...V, ...A, "-shortest", seg]);
  segs.push(seg);
}

let total = 0;
beats.forEach((b, i) => {
  const speech = b.wav ? dur(b.wav) : 0;
  const len = +(speech + b.pad).toFixed(3);
  total += len;

  if (!b.scene) {                                   // the disclaimer card
    still(join(dir, "E-disclaimer.png"), len, null, 0, i, "x");
    console.log(`  ${String(i).padStart(2)}  ${len.toFixed(2)}s  disclaimer`);
    return;
  }

  const base = join(dir, `${b.scene}-base.png`);
  const done = join(dir, `${b.scene}-done.png`);
  if (!existsSync(base)) throw new Error(`missing ${base} — run scenes.py`);

  const pre = Math.max(0.2, +(speech * b.at).toFixed(3));
  const post = +(len - pre - ANIM_LEN).toFixed(3);
  if (post < 0.2) throw new Error(`${b.scene}: line too short for a circle at ${b.at}`);

  still(base, pre, b.wav, 0, i, "a");
  // The animation itself: real frames, carrying its slice of the speech.
  const anim = join(work, `s${String(i).padStart(2, "0")}b.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error",
    "-framerate", String(ANIM_FPS), "-i", join(dir, `${b.scene}-anim-%03d.png`),
    "-ss", String(pre), "-i", b.wav,
    "-filter_complex", `[1:a]apad=whole_dur=${ANIM_LEN}[a]`, "-map", "0:v", "-map", "[a]",
    ...V, ...A, "-t", String(ANIM_LEN), anim]);
  segs.push(anim);
  still(done, post, b.wav, pre + ANIM_LEN, i, "c");

  console.log(`  ${String(i).padStart(2)}  ${len.toFixed(2)}s  ${b.scene}  circle at ${pre.toFixed(1)}s`);
});

const list = join(work, "list.txt");
writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n") + "\n");
const out = join(dir, `${variant}${dropB4 ? "-short" : ""}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
  "-i", list, "-c", "copy", out]);
rmSync(work, { recursive: true, force: true });

console.log(`\n${out}`);
console.log(`${total.toFixed(1)}s · 1080x1920 · ${dropB4 ? "without" : "with"} the network-contract line`);
