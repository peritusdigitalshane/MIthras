# Mithras platform guides — recording instructions

This folder holds the **scripts** for each video on `/guides`. The page ships
with animated CSS previews that play instantly; you can replace each one with
a real screen-recorded video at any time.

## How to add a real video

Pick **one** of the two delivery modes per guide:

### Option A — YouTube (recommended)

1. Record + upload the video to YouTube (unlisted is fine)
2. Open `src/data/guides.tsx`
3. Find the guide entry by slug and add:

```ts
youtubeId: "abc123XYZ",  // the v= part of the YouTube URL
```

4. Rebuild + redeploy the frontend.

Zero file size impact on your hosting, adaptive streaming on every device, and
the player handles autoplay + muting automatically.

### Option B — Self-hosted MP4

1. Record + encode to H.264 MP4. Recommended ffmpeg recipe (good
   compression, broad compatibility):

```bash
ffmpeg -i raw-recording.mov \
  -c:v libx264 -preset slow -crf 24 \
  -vf "scale='min(1920,iw)':-2" \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  guides/microseg-lockdown.mp4
```

   For a 90-second screen recording this typically lands at 8–20 MB.

2. Drop the file into `public/guides/<slug>.mp4`
3. In `src/data/guides.tsx`, add:

```ts
videoUrl: "/guides/microseg-lockdown.mp4",
```

4. Rebuild + redeploy.

## Recording tips

- **Screen size**: 1920×1080. Anything larger is wasted; smaller is fuzzy.
- **Frame rate**: 30 fps is enough for UI walkthroughs.
- **Cursor**: keep it visible, move deliberately, no jittery scrolling.
- **Voiceover**: read the script in the matching `.md` file. Aim for the
  per-segment timing — there's slack built into each timestamp. If you record
  voiceover separately, the captions on the page sync to the wall-clock of
  the video.
- **Audio**: speak ~6 inches from the mic, use a pop filter, record in a
  carpeted room or with a foam pop shield. Loom and ScreenStudio normalise
  audio levels automatically. If you use ElevenLabs or another AI voice,
  pick a calm, mid-tone professional voice (Adam, Bella, Rachel are safe
  defaults).
- **Length**: keep each guide under 90 seconds. If you can't make a point
  in 90s, it's the wrong point.

## Scripts

- `microsegmentation-lockdown.md` — Lock down a port in one click
- `sysmon-process-tree.md` — See every process
- `monthly-pdf-report.md` — Send your customer a polished monthly report
- `dns-filtering.md` — Block malicious DNS without breaking the customer's
  internal network
