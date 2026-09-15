// Cut a Short together from the generated frames and the rendered voice lines.
//
//   node video/assemble.mjs shorts-01-two-numbers                 # variant 1
//   node video/assemble.mjs shorts-01-two-numbers --variant 2-contradiction
//   node video/assemble.mjs shorts-01-two-numbers --no-b4         # the short cut
//
// Writes <folder>/<variant>.mp4. Needs ffmpeg and the outputs of frames.py and
// tts.mjs. Every input is generated, so this is reproducible end to end: delete
// the mp4 and run the three commands again.
//
// Each frame is held for exactly as long as its line takes to say, plus a beat
// of silence, rather than a fixed duration — a line that gets rewritten changes
// its own frame's length and nothing else drifts.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--")) || "shorts-01-two-numbers";
const variant = args.includes("--variant")
  ? args[args.indexOf("--variant") + 1] : "1-number";
const dropB4 = args.includes("--no-b4");

// Silence after each line. The gap after the hook is longer on purpose: it is
// the beat where a viewer decides to stay, and a line landing straight on top
// of the hook gives them no room to read the numbers.
const PAD = { hook: 0.55, line: 0.35, last: 0.9 };

const dir = join(HERE, folder);
const audio = join(dir, "audio");
const work = join(dir, ".work");
const spec = JSON.parse(readFileSync(join(dir, "lines.json"), "utf8"));

const dur = (f) => Number(execFileSync("ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
  { encoding: "utf8" }).trim());

// The hook shows the frame the variant opens on; the body follows lines.json.
const HOOK_FRAME = { "1-number": "C-both.png", "2-contradiction": "C-both.png",
                     "3-instruction": "A-bill.png" };

const beats = [
  { wav: join(audio, `hook-${variant}.wav`), png: join(dir, HOOK_FRAME[variant]), pad: PAD.hook },
  ...spec.body
    .filter((b) => !(dropB4 && b.id === "b4"))
    .map((b, i, a) => ({
      wav: join(audio, `${b.id}.wav`),
      png: join(dir, b.frame),
      pad: i === a.length - 1 ? PAD.last : PAD.line,
    })),
  { wav: null, png: join(dir, "E-disclaimer.png"), pad: 2.2 },
];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const segs = [];
let total = 0;
beats.forEach((b, i) => {
  const speech = b.wav ? dur(b.wav) : 0;
  const len = +(speech + b.pad).toFixed(3);
  total += len;
  const seg = join(work, `seg${String(i).padStart(2, "0")}.mp4`);
  const a = b.wav
    // Pad the speech with silence to the segment length so video and audio end
    // together; without apad the last frame of a segment races ahead.
    ? ["-i", b.wav, "-filter_complex", `[1:a]apad=whole_dur=${len}[a]`, "-map", "0:v", "-map", "[a]"]
    : ["-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=24000:cl=mono", "-map", "0:v", "-map", "1:a"];
  execFileSync("ffmpeg", ["-y", "-loglevel", "error",
    "-loop", "1", "-t", String(len), "-i", b.png, ...a,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "24000", "-shortest", seg]);
  segs.push(seg);
  console.log(`  ${String(i).padStart(2)}  ${len.toFixed(2)}s  ${b.png.split("/").pop()}`);
});

const list = join(work, "list.txt");
writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n") + "\n");
const out = join(dir, `${variant}${dropB4 ? "-short" : ""}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
  "-i", list, "-c", "copy", out]);
rmSync(work, { recursive: true, force: true });

console.log(`\n${out}`);
console.log(`${total.toFixed(1)}s · 1080x1920 · ${dropB4 ? "without" : "with"} the network-contract line`);
