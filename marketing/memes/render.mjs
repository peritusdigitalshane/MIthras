// Render every meme in this directory.
//
//   PNG       — 1080x1080, final composition. Static social.
//   GIF       — 1080x1080, 3-second loop. LinkedIn, X, FB comments.
//   MP4       — 1080x1080, 4-second loop. FB feed, IG feed, X.
//   MP4 (9:16)— 1080x1920, 4-second loop. FB Reels, IG Reels, TikTok, Stories.
//
// All MP4s are H.264 + AAC silent track at 30fps. Loop seamlessly (last
// frame == first frame timing). Captioned to play sound-off.
//
// Run:  node marketing/memes/render.mjs          (all memes, all formats)
//       node marketing/memes/render.mjs <slug>   (single meme)
//
// Add a new meme: drop <slug>.html in this directory; everything else is
// automatic.

import { writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import gifencPkg from "gifenc";
import ffmpegPath from "ffmpeg-static";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, ".frames");

const memeFiles = readdirSync(__dirname).filter((f) => f.endsWith(".html")).sort();
const ONLY = process.argv[2] ? process.argv[2].replace(/\.html$/, "") : null;

const W = 1080, H = 1080;
const FPS_GIF = 20;
const FPS_MP4 = 30;
const DURATION_S = 4.0;
const FRAMES_GIF = Math.round(FPS_GIF * 3.0);
const FRAMES_MP4 = Math.round(FPS_MP4 * DURATION_S);

const { default: puppeteer } = await import("puppeteer");
const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

// ---------------------------------------------------------------------------
// Frame capture helper
// ---------------------------------------------------------------------------
async function captureFrame(timeS) {
    await page.evaluate((offsetMs) => {
        const els = document.querySelectorAll("[class]");
        for (const el of els) {
            const styles = getComputedStyle(el);
            if (styles.animationName === "none" || styles.animationName === "") continue;
            el.style.animation = "none";
            void el.offsetHeight;
            el.style.animation = "";
            el.style.animationDelay = `${(-offsetMs + parseFloat(getComputedStyle(el).animationDelay) * 1000) / 1000}s`;
        }
    }, timeS * 1000).catch(() => null);
    await new Promise((r) => setTimeout(r, 40));
    return await page.screenshot({ type: "png", omitBackground: false });
}

// PNG → RGBA decoder via in-page canvas
async function pngToRgba(pngBuf) {
    const dataUrl = "data:image/png;base64," + Buffer.from(pngBuf).toString("base64");
    const rgba = await page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    }, dataUrl);
    return new Uint8Array(rgba);
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------
function ffmpeg(args) {
    const r = spawnSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 });
    if (r.status !== 0) {
        throw new Error(`ffmpeg failed (${r.status}): ${r.stderr?.toString().slice(-400)}`);
    }
}

function encodeMp4Square(framesDir, outPath, fps) {
    ffmpeg([
        "-y",
        "-framerate", String(fps),
        "-i", join(framesDir, "f_%04d.png"),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "20",
        "-profile:v", "high",
        "-level", "4.0",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "96k",
        "-shortest",
        "-loop", "0",
        outPath,
    ]);
}

function encodeMp4Vertical(framesDir, outPath, fps) {
    // 1080x1080 source → centred on a 1080x1920 9:16 canvas with vertical
    // bars (gradient fill) so the meme reads on Reels without cropping.
    ffmpeg([
        "-y",
        "-framerate", String(fps),
        "-i", join(framesDir, "f_%04d.png"),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf",
        "scale=1080:1080,pad=1080:1920:0:420:black",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "20",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "96k",
        "-shortest",
        outPath,
    ]);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
for (const file of memeFiles) {
    const slug = file.replace(/\.html$/, "");
    if (ONLY && slug !== ONLY) continue;

    const HTML_PATH    = join(__dirname, file);
    const OUT_PNG      = join(__dirname, `${slug}.png`);
    const OUT_GIF      = join(__dirname, `${slug}.gif`);
    const OUT_MP4_SQ   = join(__dirname, `${slug}.mp4`);
    const OUT_MP4_VERT = join(__dirname, `${slug}-vertical.mp4`);

    console.log(`\n=== ${slug} ===`);
    await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: "networkidle0" });

    // 1. Static PNG — final composition
    await new Promise((r) => setTimeout(r, 2200));
    const pngBuf = await page.screenshot({ type: "png" });
    writeFileSync(OUT_PNG, pngBuf);
    console.log(`  PNG  ${(pngBuf.length / 1024).toFixed(0)} KB`);

    // 2. Capture frames once for both MP4s (highest framerate). The GIF
    //    re-samples this stream at 20fps via stride.
    if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true, force: true });
    mkdirSync(FRAMES_DIR, { recursive: true });

    const animEnd = 1.6; // sec — by which time all CSS animations have finished
    process.stdout.write(`  capture ${FRAMES_MP4} frames @ ${FPS_MP4}fps...`);
    for (let i = 0; i < FRAMES_MP4; i++) {
        // Hold the final pose for the last second so the loop has a beat.
        const t = Math.min(i / FPS_MP4, animEnd);
        const fbuf = await captureFrame(t);
        writeFileSync(join(FRAMES_DIR, `f_${String(i).padStart(4, "0")}.png`), fbuf);
        if ((i + 1) % 30 === 0) process.stdout.write(".");
    }
    process.stdout.write("\n");

    // 3. MP4 (1080x1080) for FB feed
    encodeMp4Square(FRAMES_DIR, OUT_MP4_SQ, FPS_MP4);
    console.log(`  MP4  ${slug}.mp4  (${(statSize(OUT_MP4_SQ) / 1024).toFixed(0)} KB)`);

    // 4. MP4 (1080x1920) for Reels / Stories
    encodeMp4Vertical(FRAMES_DIR, OUT_MP4_VERT, FPS_MP4);
    console.log(`  MP4  ${slug}-vertical.mp4  (${(statSize(OUT_MP4_VERT) / 1024).toFixed(0)} KB)`);

    // 5. GIF from a subset of the same frames (every Nth)
    const stride = Math.round(FPS_MP4 / FPS_GIF);
    const gif = GIFEncoder();
    const indices = [];
    for (let i = 0; i < FRAMES_MP4; i += stride) indices.push(i);
    if (indices[indices.length - 1] !== FRAMES_MP4 - 1) indices.push(FRAMES_MP4 - 1);
    for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const fpath = join(FRAMES_DIR, `f_${String(i).padStart(4, "0")}.png`);
        const buf = readFileSync(fpath);
        const rgba = await pngToRgba(buf);
        const palette = quantize(rgba, 256, { format: "rgba4444" });
        const idx = applyPalette(rgba, palette, "rgba4444");
        gif.writeFrame(idx, W, H, { palette, delay: Math.round(1000 / FPS_GIF), transparent: false });
    }
    gif.finish();
    writeFileSync(OUT_GIF, Buffer.from(gif.bytes()));
    console.log(`  GIF  ${slug}.gif  (${(statSize(OUT_GIF) / 1024).toFixed(0)} KB)`);

    rmSync(FRAMES_DIR, { recursive: true, force: true });
}

await browser.close();
console.log("\nDone.");

function statSize(p) { return statSync(p).size; }
