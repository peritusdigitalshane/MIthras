// Replace the audio track on every viral MP4 with viral-audio.aac.
// Reuses existing H.264 video stream (no re-encode → fast + lossless).
//
//   <slug>.mp4              →  <slug>.mp4              (audio swapped, video untouched)
//   <slug>-vertical.mp4     →  <slug>-vertical.mp4
//
// Run:  node marketing/memes/viral/mux-audio.mjs

import { readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO    = join(__dirname, "viral-audio.aac");

const targets = readdirSync(__dirname)
    .filter((f) => f.endsWith(".mp4"))
    .filter((f) => !f.endsWith(".tmp.mp4"));

for (const file of targets) {
    const src = join(__dirname, file);
    const tmp = join(__dirname, file.replace(/\.mp4$/, ".tmp.mp4"));

    console.log(`muxing ${file}...`);
    const r = spawnSync(ffmpegPath, [
        "-y",
        "-i", src,
        "-i", AUDIO,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "256k",
        "-shortest",
        "-movflags", "+faststart",
        tmp,
    ], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 256 });

    if (r.status !== 0) {
        console.error(`  FAIL: ${r.stderr.toString().slice(-500)}`);
        try { unlinkSync(tmp); } catch {}
        continue;
    }

    // Replace original with muxed version
    unlinkSync(src);
    renameSync(tmp, src);
    console.log(`  ✓ ${(statSync(src).size / 1024).toFixed(0)} KB`);
}

console.log("\nDone. Audio swapped on every viral video.");
