// Render the spoken lines of a Short to .wav, plus per-word timings for karaoke
// captions.
//
//   node video/tts.mjs shorts-01-two-numbers
//   node video/tts.mjs shorts-01-two-numbers --voice en-US-Neural2-F
//
// Writes audio/<id>.wav and audio/timings.json.
//
// ---------------------------------------------------------------------------
// Voice choice is forced by the captions, not by taste.
//
// Chirp3-HD sounds the best of the Cloud TTS families and CANNOT do this: it
// returns an empty timepoints array, because Chirp3 does not support SSML.
// Studio voices reject <mark> outright — "not currently supported by Studio
// voices". Neural2 and Wavenet both return exact per-word timings.
//
// So: Neural2. Word-accurate captions are worth more on a muted-by-default feed
// than a marginally smoother read, and most of this audience watches without
// sound at first.
//
// (Gemini 2.5 TTS was tried before any of these and is too flaky to use —
// finishReason OTHER with no audio on better than half of calls. See git log.)
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = "useclaimright";
const ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--")) || "shorts-01-two-numbers";
const voice = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "en-US-Neural2-D";

const TOKEN = execFileSync("gcloud", ["auth", "print-access-token"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");

// A mark before every word. The timepoint that comes back for wN is when wN
// starts being spoken, which is exactly what a caption needs to highlight on.
function ssml(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const body = words.map((w, i) => `<mark name="w${i}"/>${esc(w)}`).join(" ");
  return { ssml: `<speak>${body}</speak>`, words };
}

async function say(text, id, out) {
  const { ssml: doc, words } = ssml(text);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json",
               "x-goog-user-project": PROJECT },
    body: JSON.stringify({
      input: { ssml: doc },
      voice: { languageCode: "en-US", name: voice },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate: 0.96 },
      enableTimePointing: ["SSML_MARK"],
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${id}: ${body.error.message}`);
  const buf = Buffer.from(body.audioContent, "base64");
  writeFileSync(join(out, `${id}.wav`), buf);
  const secs = (buf.length - 44) / (24000 * 2);

  const points = body.timepoints || [];
  if (points.length !== words.length) {
    console.warn(`  ! ${id}: ${points.length} timepoints for ${words.length} words`);
  }
  // [word, startSeconds]. The last word ends when the audio does.
  const timing = words.map((w, i) => [w, points[i] ? points[i].timeSeconds : (secs * i) / words.length]);
  console.log(`  ${id.padEnd(6)} ${secs.toFixed(1)}s  ${words.length} words`);
  return { secs, timing };
}

const dir = join(HERE, folder);
const spec = JSON.parse(readFileSync(join(dir, "lines.json"), "utf8"));
const out = join(dir, "audio");
mkdirSync(out, { recursive: true });

console.log(`voice ${voice}`);
const timings = {};
for (const [name, text] of Object.entries(spec.variants)) {
  timings[`hook-${name}`] = await say(text, `hook-${name}`, out);
}
for (const beat of spec.body) {
  timings[beat.id] = await say(beat.text, beat.id, out);
}
if (spec.cta) timings.cta = await say(spec.cta, "cta", out);

writeFileSync(join(out, "timings.json"), JSON.stringify(timings, null, 1));
const total = spec.body.reduce((n, b) => n + timings[b.id].secs, 0);
console.log(`\nbody ${total.toFixed(1)}s · timings.json written`);
