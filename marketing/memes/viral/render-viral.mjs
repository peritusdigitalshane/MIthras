// Viral renderer — long-form (20s+) multi-scene videos with sound design.
//
//   <slug>.mp4               — 1080x1080 square (FB feed, IG feed, X)
//   <slug>-vertical.mp4      — 1080x1920 9:16   (FB Reels, IG Reels, Stories, TikTok)
//
// Both ship with a synthesized soundtrack: bass drone + impact hits at
// scene transitions. For a final post, layer trending audio in CapCut
// — the baked audio is the floor, trending audio is the algorithm boost.
//
// Run:  node marketing/memes/viral/render-viral.mjs           (all)
//       node marketing/memes/viral/render-viral.mjs <slug>    (one)

import { writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, ".frames");

const memeFiles = readdirSync(__dirname).filter((f) => f.endsWith(".html")).sort();
const ONLY = process.argv[2] ? process.argv[2].replace(/\.html$/, "") : null;

const SQUARE_W = 1080, SQUARE_H = 1080;
const VERT_W   = 1080, VERT_H   = 1920;
const FPS = 24;
const DURATION_S = 20;
const FRAMES = FPS * DURATION_S;
const isVerticalFile = (slug) => slug.endsWith("-vert");

// Per-meme scene transition timestamps (seconds) — defines where audio
// "whoosh" hits land. Defaults to a 5-scene 4s-per-scene cadence.
const SCENE_HITS = {
    "crowdstrike-viral": [0, 3, 8, 13, 17],
};

const { default: puppeteer } = await import("puppeteer");
const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();

async function captureFrame(timeS) {
    await page.evaluate((offsetMs) => {
        const els = document.querySelectorAll(".scene");
        for (const el of els) {
            el.style.animation = "none";
            void el.offsetHeight;
            el.style.animation = "";
            el.style.animationDelay = `${(-offsetMs + parseFloat(getComputedStyle(el).animationDelay) * 1000) / 1000}s`;
            // also reset children animations
            for (const c of el.querySelectorAll("*")) {
                const cs = getComputedStyle(c);
                if (cs.animationName !== "none" && cs.animationName !== "") {
                    const childDelay = parseFloat(cs.animationDelay) * 1000;
                    c.style.animation = "none";
                    void c.offsetHeight;
                    c.style.animation = "";
                    c.style.animationDelay = `${(-offsetMs + childDelay) / 1000}s`;
                }
            }
        }
    }, timeS * 1000).catch(() => null);
    await new Promise((r) => setTimeout(r, 35));
    return await page.screenshot({ type: "png" });
}

function ffmpeg(args) {
    const r = spawnSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 });
    if (r.status !== 0) {
        throw new Error(`ffmpeg failed (${r.status}): ${r.stderr?.toString().slice(-600)}`);
    }
}

// ---------------------------------------------------------------------------
// Sound design — synthesize a bass drone + impact hits at scene transitions.
// All pure ffmpeg filters; no external samples needed.
// ---------------------------------------------------------------------------
function buildAudioFilter(hits, duration) {
    // Two layers:
    //   1. Continuous low drone — sine wave at 55Hz, gentle level.
    //   2. Impact hit at each scene transition — short filtered noise burst.
    // Compressed and limited on the final mix so impacts feel punchy without
    // clipping when the user adds Reels music on top.
    const hitDelays = hits.map((t) => Math.round(t * 1000));

    const parts = [];
    parts.push(`sine=frequency=55:duration=${duration},volume=0.18[drone]`);

    let mixInputs = ["[drone]"];
    for (let i = 0; i < hits.length; i++) {
        parts.push(
            `anoisesrc=duration=0.5:colour=brown:amplitude=0.7,bandpass=f=300:width_type=h:w=400,adelay=${hitDelays[i]}|${hitDelays[i]},volume=0.55[hit${i}]`,
        );
        mixInputs.push(`[hit${i}]`);
    }

    parts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:dropout_transition=0:normalize=0[premix]`);
    parts.push(`[premix]acompressor=threshold=0.3:ratio=4:attack=10:release=200,alimiter=limit=0.95,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`);

    return parts.join(";");
}

function encodeMp4(framesDir, outPath, audioFilter) {
    // Frames are already at the target resolution (Puppeteer captured at
    // viewport size). No scaling/padding needed — encode straight through.
    ffmpeg([
        "-y",
        "-framerate", String(FPS),
        "-i", join(framesDir, "f_%04d.png"),
        "-filter_complex", audioFilter,
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "21",
        "-profile:v", "high",
        "-level", "4.0",
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        outPath,
    ]);
}

for (const file of memeFiles) {
    const slug = file.replace(/\.html$/, "");
    if (ONLY && slug !== ONLY) continue;

    const HTML_PATH = join(__dirname, file);
    const OUT_MP4   = join(__dirname, `${slug}.mp4`);

    const vertical = isVerticalFile(slug);
    const W = vertical ? VERT_W : SQUARE_W;
    const H = vertical ? VERT_H : SQUARE_H;

    const hits = SCENE_HITS[slug.replace(/-vert$/, "")] ?? [0, 4, 8, 12, 16];
    const audioFilter = buildAudioFilter(hits, DURATION_S);

    console.log(`\n=== ${slug} (${W}x${H}) ===`);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: "networkidle0" });

    if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true, force: true });
    mkdirSync(FRAMES_DIR, { recursive: true });

    process.stdout.write(`  capture ${FRAMES} frames @ ${FPS}fps`);
    for (let i = 0; i < FRAMES; i++) {
        const t = i / FPS;
        const fbuf = await captureFrame(t);
        writeFileSync(join(FRAMES_DIR, `f_${String(i).padStart(4, "0")}.png`), fbuf);
        if ((i + 1) % 60 === 0) process.stdout.write(".");
    }
    process.stdout.write("\n");

    encodeMp4(FRAMES_DIR, OUT_MP4, audioFilter);
    console.log(`  MP4  ${slug}.mp4  (${(statSync(OUT_MP4).size / 1024).toFixed(0)} KB)`);

    rmSync(FRAMES_DIR, { recursive: true, force: true });
}

await browser.close();
console.log("\nDone.");
