import { useEffect, useRef, useState } from "react";
import { Guide } from "@/data/guides";
import { GuideAnimation } from "./GuideAnimations";
import { Play, Pause, RotateCcw, Volume2, VolumeX, X } from "lucide-react";

interface GuidePlayerProps {
  guide: Guide;
  onClose?: () => void;
}

export function GuidePlayer({ guide, onClose }: GuidePlayerProps) {
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [currentSec, setCurrentSec] = useState(0);
  const [seekKey, setSeekKey] = useState(0); // bump to restart the CSS animation
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startedAt = useRef<number>(Date.now());
  const accumulated = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Drive the caption timer. If we have a real <video>, sync to currentTime.
  // Otherwise we track wall-clock for the CSS animation.
  useEffect(() => {
    if (guide.videoUrl) return; // video element fires its own timeupdate
    if (!playing) return;
    startedAt.current = Date.now();
    const tick = () => {
      const elapsed = accumulated.current + (Date.now() - startedAt.current) / 1000;
      setCurrentSec(Math.min(elapsed, guide.durationSec));
      if (elapsed >= guide.durationSec) {
        setPlaying(false);
        accumulated.current = guide.durationSec;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      accumulated.current += (Date.now() - startedAt.current) / 1000;
    };
  }, [playing, guide.durationSec, guide.videoUrl, seekKey]);

  const activeCaption = guide.captions.find(
    (c) => currentSec >= c.startSec && currentSec < c.endSec,
  );

  const togglePlay = () => {
    if (videoRef.current) {
      if (playing) videoRef.current.pause();
      else void videoRef.current.play();
    }
    setPlaying((p) => !p);
  };

  const restart = () => {
    accumulated.current = 0;
    setCurrentSec(0);
    setSeekKey((k) => k + 1);
    setPlaying(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      void videoRef.current.play();
    }
  };

  const toggleMute = () => {
    if (videoRef.current) videoRef.current.muted = !muted;
    setMuted((m) => !m);
  };

  // Use the best source: YouTube > mp4 > CSS animation.
  const usingYoutube = !!guide.youtubeId;
  const usingMp4 = !usingYoutube && !!guide.videoUrl;

  return (
    <div className="bg-black rounded-2xl overflow-hidden shadow-2xl border border-border/40">
      {/* Top bar with title + close (only in modal context) */}
      {onClose && (
        <div className="flex items-center justify-between px-5 py-3 bg-black/60 border-b border-border/20">
          <div>
            <p className="text-xs uppercase tracking-wider text-primary font-semibold">
              {guide.category}
            </p>
            <h3 className="text-lg font-semibold text-white">{guide.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Video / animation surface */}
      <div className="relative aspect-video w-full bg-black">
        {usingYoutube && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${guide.youtubeId}?rel=0&modestbranding=1${playing ? "&autoplay=1" : ""}${muted ? "&mute=1" : ""}`}
            title={guide.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        {usingMp4 && (
          <video
            ref={videoRef}
            src={guide.videoUrl}
            className="w-full h-full object-cover"
            autoPlay
            muted={muted}
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => setCurrentSec((e.target as HTMLVideoElement).currentTime)}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
        )}
        {!usingYoutube && !usingMp4 && (
          <GuideAnimation
            animationKey={guide.animationKey}
            durationSec={guide.durationSec}
            playing={playing}
            seekKey={seekKey}
          />
        )}

        {/* Caption strip (overlays bottom of video) */}
        {activeCaption && !usingYoutube && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[80%] px-4 py-2 rounded-md bg-black/75 backdrop-blur text-white text-sm md:text-base leading-snug text-center">
            {activeCaption.text}
          </div>
        )}

        {/* Custom controls overlay (only for animation/mp4 — YouTube has its own) */}
        {!usingYoutube && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="rounded-full p-2 bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              onClick={restart}
              className="rounded-full p-2 bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Restart"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <div className="flex-1 mx-2">
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.min(100, (currentSec / guide.durationSec) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-white/60 mt-1">
                <span>{formatTime(currentSec)}</span>
                <span>{formatTime(guide.durationSec)}</span>
              </div>
            </div>
            {usingMp4 && (
              <button
                onClick={toggleMute}
                className="rounded-full p-2 bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
          </div>
        )}

        {/* "Animation preview" badge when no real video uploaded yet */}
        {!usingYoutube && !usingMp4 && (
          <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-white/10 backdrop-blur text-[10px] uppercase tracking-wider text-white/80 border border-white/15">
            Animated preview
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
