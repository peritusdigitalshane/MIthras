// Generate a viral-grade cinematic audio track via ffmpeg synthesis.
//
// Architecture: each "instrument" is a fully-modelled synth voice, then the
// master bus does sidechain compression + reverb + limiting. Tempo = 100 BPM
// (beat = 0.6s), 20s total = 8.33 bars.
//
// Structure:
//   0-3s     intro: sub-bass drone, half-time kick
//   3-9s     build: full kick + hi-hat 16ths + snare on 2/4
//   9-12s    pre-drop: rising white noise + pitched riser
//   12-13s   drop transition (kicks duck out, riser peaks)
//   13-17s   payoff: chord progression Am→F→C→G, 4-on-the-floor + hats
//   17-20s   outro: filter sweep down, fade
//
// Real-instrument synthesis principles:
//   KICK   = click (short white noise burst) + body (sine sweep 80→40Hz) + sub (sine 30Hz)
//   SNARE  = body (sine 200Hz brief) + snares (noise band-pass 1k-4k)
//   HAT    = white noise high-passed 8kHz, very short envelope
//   BASS   = saw wave at root, low-pass filter
//   PAD    = stacked sine triads (root/3rd/5th) with slow attack
//
// Output: viral-audio.aac (256kbit, stereo, 44.1kHz)

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "viral-audio.aac");

const DURATION = 20;
const BPM = 100;
const BEAT = 60 / BPM;        // 0.6s
const DROP_T = 13;             // drop moment

// Helper: build a kick drum hit at time t
function kick(t, vol = 1.0) {
    const ms = Math.round(t * 1000);
    // Click: 8ms of high-freq noise burst — gives the kick its attack snap
    const click = `anoisesrc=duration=0.008:colour=white:amplitude=0.6,highpass=f=2000,volume='1-t*125':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.5}`;
    // Body: 55Hz sine with a tight envelope = punchy thunk
    const body = `sine=frequency=55:duration=0.15:sample_rate=44100,volume='if(lt(t,0.003),t*333,exp(-t*10))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.85}`;
    // Pitch-shift overshoot: a brief higher-frequency layer at the very start
    // emulates the classic 808-style frequency sweep without aevalsrc.
    const sweep = `sine=frequency=120:duration=0.04:sample_rate=44100,volume='exp(-t*45)':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.5}`;
    // Sub: sustained 30Hz sine for body weight
    const sub = `sine=frequency=30:duration=0.18,volume='if(lt(t,0.005),t*200,exp(-t*7))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.6}`;
    return [click, sweep, body, sub];
}

// Helper: snare hit
function snare(t, vol = 1.0) {
    const ms = Math.round(t * 1000);
    const body = `sine=frequency=200:duration=0.1,volume='if(lt(t,0.003),t*333,exp(-t*22))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.35}`;
    const snares = `anoisesrc=duration=0.12:colour=white:amplitude=0.7,bandpass=f=2200:width_type=h:w=2200,volume='if(lt(t,0.003),t*333,exp(-t*15))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.4}`;
    return [body, snares];
}

// Helper: hi-hat (closed)
function hat(t, vol = 1.0) {
    const ms = Math.round(t * 1000);
    return `anoisesrc=duration=0.04:colour=white:amplitude=0.5,highpass=f=8000,volume='if(lt(t,0.002),t*500,exp(-t*40))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.18}`;
}

// Helper: open hat (slightly longer)
function ohat(t, vol = 1.0) {
    const ms = Math.round(t * 1000);
    return `anoisesrc=duration=0.18:colour=white:amplitude=0.5,highpass=f=7000,volume='if(lt(t,0.002),t*500,exp(-t*10))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.15}`;
}

// Helper: sustained pad chord (triad). Returns array of layered sines.
// root, third, fifth are frequencies. duration is in seconds.
function pad(t, root, third, fifth, duration, vol = 1.0) {
    const ms = Math.round(t * 1000);
    const env = `volume='if(lt(t,0.4),t*${1.0 / 0.4},if(lt(t,${duration - 0.6}),1,max(0,(${duration}-t)/0.6)))':eval=frame`;
    return [
        `sine=frequency=${root}:duration=${duration},${env},adelay=${ms}|${ms},volume=${vol * 0.07}`,
        `sine=frequency=${third}:duration=${duration},${env},adelay=${ms}|${ms},volume=${vol * 0.05}`,
        `sine=frequency=${fifth}:duration=${duration},${env},adelay=${ms}|${ms},volume=${vol * 0.04}`,
        // Octave up for sparkle
        `sine=frequency=${root * 2}:duration=${duration},${env},adelay=${ms}|${ms},volume=${vol * 0.025}`,
    ];
}

// Helper: bass note (saw wave, kick-ducked)
function bass(t, freq, duration, vol = 1.0) {
    const ms = Math.round(t * 1000);
    // Saw approximated by summing odd harmonics with decreasing amplitude
    return [
        `sine=frequency=${freq}:duration=${duration},volume='if(lt(t,0.02),t*50,if(lt(t,${duration - 0.05}),1,(${duration}-t)*20))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.18}`,
        `sine=frequency=${freq * 2}:duration=${duration},volume='if(lt(t,0.02),t*50,if(lt(t,${duration - 0.05}),1,(${duration}-t)*20))':eval=frame,adelay=${ms}|${ms},volume=${vol * 0.06}`,
    ];
}

function build() {
    const F = [];
    const mixTags = [];
    let idx = 0;
    const addLayer = (filters, prefix) => {
        for (const f of filters) {
            const tag = `${prefix}${idx++}`;
            F.push(`${f}[${tag}]`);
            mixTags.push(`[${tag}]`);
        }
    };

    // ============ INTRO 0-3s — atmospheric ============
    // Sub bass drone
    F.push(`sine=frequency=55:duration=${DURATION},volume='if(lt(t,3),0.15+t*0.02,if(lt(t,${DROP_T}),0.22,0.30))':eval=frame[drone]`);
    mixTags.push("[drone]");
    // Half-time kick at beats 1 and 3
    for (let bar = 0; bar < 2; bar++) {
        const t = bar * 4 * BEAT;
        if (t < 3) addLayer(kick(t, 0.7), "k_intro_");
        if (t + 2 * BEAT < 3) addLayer(kick(t + 2 * BEAT, 0.6), "k_intro_");
    }

    // ============ BUILD 3-12s — full beat pattern ============
    // Kicks: every beat (4-on-the-floor) from 3s onwards
    let kickT = 3.0;
    while (kickT < DROP_T - 0.8) {
        addLayer(kick(kickT, 0.95), "k_build_");
        kickT += BEAT;
    }
    // Snares on beats 2 and 4 (backbeat)
    let snareT = 3.0 + BEAT;
    while (snareT < DROP_T - 0.8) {
        addLayer(snare(snareT, 0.85), "sn_build_");
        snareT += 2 * BEAT;
    }
    // Hi-hat 8th notes from 4.5s
    let hatT = 4.5;
    while (hatT < DROP_T - 0.5) {
        const isOff = Math.round((hatT - 4.5) / (BEAT / 2)) % 2 === 1;
        addLayer([isOff ? hat(hatT, 0.7) : hat(hatT, 1.0)], "h_build_");
        hatT += BEAT / 2;
    }
    // Open hat on the "and" of beat 4 every bar — funkifies it
    let ohT = 3.0 + 3.5 * BEAT;
    while (ohT < DROP_T - 0.5) {
        addLayer([ohat(ohT, 0.8)], "oh_build_");
        ohT += 4 * BEAT;
    }
    // Bass line — root note on each kick, low octave
    let bassT = 3.0;
    while (bassT < DROP_T - 0.8) {
        addLayer(bass(bassT, 55, BEAT * 0.95, 0.7), "b_build_");
        bassT += BEAT;
    }

    // ============ PRE-DROP RISER (12-13s) ============
    const riserStart = Math.round((DROP_T - 1) * 1000);
    F.push(
        `anoisesrc=duration=1.0:colour=white:amplitude=1,` +
        `highpass=f=100,` +
        `volume='pow(t,1.6)':eval=frame,` +
        `adelay=${riserStart}|${riserStart},` +
        `volume=0.45[riser]`
    );
    mixTags.push("[riser]");
    // Pitched riser sweep 200 → 2000Hz
    F.push(
        `sine=frequency=400:duration=1.0,` +
        `volume='pow(t,2.5)':eval=frame,` +
        `adelay=${riserStart}|${riserStart},` +
        `volume=0.2[riserSine]`
    );
    mixTags.push("[riserSine]");

    // ============ THE DROP (13s) — massive impact + chord ============
    const dropMs = Math.round(DROP_T * 1000);
    F.push(`sine=frequency=28:duration=2.5,volume='if(lt(t,0.005),t*200,exp(-t*1.2))':eval=frame,adelay=${dropMs}|${dropMs},volume=1.0[dropSub]`);
    mixTags.push("[dropSub]");
    F.push(`anoisesrc=duration=0.5:colour=brown:amplitude=1,bandpass=f=180:width_type=h:w=300,volume='if(lt(t,0.005),t*200,exp(-t*5))':eval=frame,adelay=${dropMs}|${dropMs},volume=0.55[dropMid]`);
    mixTags.push("[dropMid]");
    F.push(`sine=frequency=2000:duration=0.08,volume='if(lt(t,0.002),t*500,exp(-t*30))':eval=frame,adelay=${dropMs}|${dropMs},volume=0.4[dropClick]`);
    mixTags.push("[dropClick]");

    // Reverse crash (white noise swelling in 0.4s before drop)
    const crashStart = Math.round((DROP_T - 0.4) * 1000);
    F.push(`anoisesrc=duration=0.4:colour=white:amplitude=1,highpass=f=4000,volume='pow(t/0.4,2)':eval=frame,adelay=${crashStart}|${crashStart},volume=0.3[crash]`);
    mixTags.push("[crash]");

    // ============ PAYOFF 13-17s — chord progression + drums ============
    // Chord progression: Am → F → C → G (the "axis of awesome")
    // 1 bar per chord = 2.4s each, but we have 4s for payoff so play 4 chords in 4s = 1s each
    // A=220, F=174.6, C=261.6, G=196 (root frequencies)
    // Am triad: A C E   (220, 261, 330)
    // F  triad: F A C   (174.6, 220, 261.6)
    // C  triad: C E G   (261.6, 330, 392)
    // G  triad: G B D   (196, 246.9, 294)
    const chords = [
        { t: 13.0, dur: 1.0, root: 220.0, third: 261.6, fifth: 329.6 }, // Am
        { t: 14.0, dur: 1.0, root: 174.6, third: 220.0, fifth: 261.6 }, // F
        { t: 15.0, dur: 1.0, root: 261.6, third: 329.6, fifth: 392.0 }, // C
        { t: 16.0, dur: 1.0, root: 196.0, third: 246.9, fifth: 293.7 }, // G
    ];
    for (const c of chords) {
        addLayer(pad(c.t, c.root, c.third, c.fifth, c.dur, 1.0), "p_");
        // Bass note follows the chord
        addLayer(bass(c.t, c.root / 2, c.dur, 0.8), "bp_");
    }
    // 4-on-the-floor kick during payoff
    let payoffK = DROP_T + 0.6;
    while (payoffK < 17.0) {
        addLayer(kick(payoffK, 0.95), "k_pay_");
        payoffK += BEAT;
    }
    // Snare backbeat
    let payoffS = DROP_T + BEAT + 0.6;
    while (payoffS < 17.0) {
        addLayer(snare(payoffS, 0.9), "sn_pay_");
        payoffS += 2 * BEAT;
    }
    // Hi-hat 8ths
    let payoffH = DROP_T + 0.3;
    while (payoffH < 17.0) {
        addLayer([hat(payoffH, 0.85)], "h_pay_");
        payoffH += BEAT / 2;
    }

    // ============ OUTRO 17-20s — pad sustains, drums drop out ============
    // Sustained C major chord
    addLayer(pad(17.0, 261.6, 329.6, 392.0, 3.0, 0.7), "p_out_");
    // Final kick at 17s as resolution
    addLayer(kick(17.0, 0.8), "k_out_");
    addLayer(kick(17.0 + 2 * BEAT, 0.6), "k_out_");

    // ============ FINAL MIX → MASTER ============
    F.push(`${mixTags.join("")}amix=inputs=${mixTags.length}:dropout_transition=0:normalize=0[mix]`);

    // Master chain: compression (sidechain-style pumping via parallel comp),
    // reverb tail, stereo widening (slight LR delay), limiter.
    F.push(
        `[mix]` +
        // First compressor: aggressive for "modern" sound
        `acompressor=threshold=0.2:ratio=6:attack=3:release=80,` +
        // Second pass: gentler, evens it out
        `acompressor=threshold=0.4:ratio=2:attack=10:release=150,` +
        // Reverb tail
        `aecho=0.7:0.6:60:0.25,` +
        // Brick-wall limiter at -3dB
        `alimiter=limit=0.95,` +
        // Final EQ tilt — slight high-shelf for sparkle
        `equalizer=f=10000:width_type=q:width=1:g=2,` +
        // Boost low end a touch
        `equalizer=f=80:width_type=q:width=1:g=2,` +
        `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
    );

    return F.join(";");
}

const filterGraph = build();
const SCRIPT_FILE = join(__dirname, ".filter-script.txt");
writeFileSync(SCRIPT_FILE, filterGraph);

const args = [
    "-y",
    "-filter_complex_script", SCRIPT_FILE,
    "-map", "[a]",
    "-c:a", "aac",
    "-b:a", "256k",
    OUT,
];

console.log(`Synthesizing 20-second cinematic track... (${filterGraph.length} chars filter graph, written to script file)`);
const r = spawnSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 256 });
try { unlinkSync(SCRIPT_FILE); } catch {}
if (r.status !== 0) {
    console.error("ffmpeg failed:");
    console.error((r.stderr?.toString() ?? String(r.error ?? "unknown")).slice(-3000));
    process.exit(1);
}
console.log(`✓ Wrote ${OUT}`);
