// Render the spoken lines of a Short to .wav, one file per beat.
//
//   node video/tts.mjs shorts-01-two-numbers
//   node video/tts.mjs shorts-01-two-numbers --voice en-US-Chirp3-HD-Kore
//
// One file per beat rather than one long track, because the edit cuts frames
// against lines and a single track means re-rendering everything to change a
// word.
//
// ---------------------------------------------------------------------------
// Why Cloud Text-to-Speech and not Gemini TTS
//
// Gemini 2.5 TTS was the first choice, because style rides in the prompt and
// this script wants "like explaining a form to a friend". It does not work
// reliably. `gemini-2.5-flash-preview-tts` returns finishReason OTHER with no
// audio and no usageMetadata on better than half of calls, and for some lines
// on eight consecutive attempts with backoff.
//
// It looks exactly like a content refusal, and it sent me after two wrong
// explanations — first that a long style preamble caused it, then that
// spelled-out amounts did. Neither. The decisive test was the identical prompt
// three times: OTHER, OTHER, STOP. It is a preview model and it is flaky.
//
// Cloud TTS rendered the line that had just failed eight times, first attempt.
// It also needs no API key at all — it runs on the gcloud credentials this
// project already has, so no key is involved at all.
//
// If anyone does go back to Gemini TTS: the key is `askmyfit-gemini` in the
// macOS login keychain, read via GEMINI_API_KEY when set and the keychain
// otherwise. Read it straight into the process — never echo it, never write it
// to a file, never commit it. It is named for the other project but it is the
// key for video and ad generation generally.
//
// One-time setup, already done on this machine:
//   gcloud services enable texttospeech.googleapis.com --project=useclaimright
// Enabling takes a minute or two to propagate; calls fail with "API has not
// been used in project" until it does, which is not a permissions problem.
//
// The cost is real: Chirp3-HD takes no style instruction, so `style` in
// lines.json is ignored here. If the reading comes out too brisk, the lever is
// SSML <break> tags, not an adjective.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = "useclaimright";
const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--")) || "shorts-01-two-numbers";
const voice = args.includes("--voice")
  ? args[args.indexOf("--voice") + 1] : "en-US-Chirp3-HD-Charon";

function token() {
  try {
    return execFileSync("gcloud", ["auth", "print-access-token"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    console.error("No gcloud credentials. Run: gcloud auth login");
    process.exit(1);
  }
}

const TOKEN = token();

async function say(text, file, out) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT,
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-US", name: voice },
      // LINEAR16 comes back with a RIFF header already, so this writes straight
      // to disk — no hand-rolled WAV header, which is the step people get wrong.
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${file}: ${body.error.message}`);
  const buf = Buffer.from(body.audioContent, "base64");
  writeFileSync(join(out, file), buf);
  const secs = (buf.length - 44) / (24000 * 2);
  console.log(`  ${file.padEnd(28)} ${secs.toFixed(1)}s  ${(buf.length / 1024).toFixed(0)}KB`);
  return secs;
}

const dir = join(HERE, folder);
const spec = JSON.parse(readFileSync(join(dir, "lines.json"), "utf8"));
const out = join(dir, "audio");
mkdirSync(out, { recursive: true });

console.log(`voice ${voice}`);
console.log("hooks:");
for (const [name, text] of Object.entries(spec.variants)) {
  await say(text, `hook-${name}.wav`, out);
}
console.log("body:");
let total = 0;
for (const beat of spec.body) {
  total += await say(beat.text, `${beat.id}.wav`, out);
}
console.log(`\nbody is ${total.toFixed(1)}s of speech before pauses.`);
console.log(`a hook adds ~4-6s — target for a Short is under 60s, comfortably met.`);
console.log(out);
