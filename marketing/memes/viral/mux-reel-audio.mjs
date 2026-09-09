// Mux "reel audio.mp3" (first 20s) onto every viral .mp4.
// Re-encodes audio to AAC, leaves video stream untouched (fast + lossless).
// Includes a 0.5s audio fade-out at the end so the loop is clean.

import { readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(__dirname, "reel audio.mp3");

const targets = readdirSync(__dirname)
    .filter((f) => f.endsWith(".mp4") && !f.endsWith(".tmp.mp4"));

console.log(`Muxing "reel audio.mp3" (first 20s) onto ${targets.length} videos...\n`);

let ok = 0, failed = 0;
for (const file of targets) {
    const src = join(__dirname, file);
    const tmp = join(__dirname, file.replace(/\.mp4$/, ".tmp.mp4"));

    process.stdout.write(`  ${file.padEnd(40)}`);
    const r = spawnSync(ffmpegPath, [
        "-y",
        "-i", src,                  // video source
        "-ss", "0",                 // start audio at 0
        "-t", "20",                 // first 20 seconds
        "-i", AUDIO,                // audio source
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "256k",
        "-af", "afade=t=out:st=19.5:d=0.5",
        "-shortest",
        "-movflags", "+faststart",
        tmp,
    ], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 256 });

    if (r.status !== 0) {
        console.log(" FAIL");
        console.error("   " + r.stderr.toString().slice(-300));
        try { unlinkSync(tmp); } catch {}
        failed++;
        continue;
    }
    unlinkSync(src);
    renameSync(tmp, src);
    console.log(` ✓ ${(statSync(src).size / 1024).toFixed(0)} KB`);
    ok++;
}

console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
