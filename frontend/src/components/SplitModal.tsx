import { useRef, useState, useEffect, useCallback } from 'react';
import { X, Scissors, Trash2, Play, Pause, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

interface ProgressItem {
  segment: number;
  status: 'pending' | 'running' | 'done' | 'error';
  file: string;
  progress?: number;
  error?: string;
}

interface Props {
  folderPath: string;
  files: string[];
  initialFile: string;
  onClose: () => void;
}

function secsToHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function secsToHMSF(s: number, fps: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const frame = Math.floor((s % 1) * fps);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}:${String(frame).padStart(2,'0')}`;
}

function secsToTimecode(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec.toFixed(3).padStart(6,'0')}`;
}

function fileStem(name: string): string { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; }
function fileExt(name: string): string { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; }

// Derive segment names from the file stem by splitting on ' - ' from the right.
// "09 - Part A - Part B" into 2 segments → ["09 - Part A", "Part B"] + ext.
// Falls back to _part1/_part2 etc. if there aren't enough separators.
function autoNames(stem: string, ext: string, count: number): string[] {
  const sep = ' - ';
  const parts = stem.split(sep);
  if (count >= 2 && parts.length >= count) {
    const splitIdx = parts.length - (count - 1);
    const result = [parts.slice(0, splitIdx).join(sep) + ext];
    for (let i = splitIdx; i < parts.length; i++) result.push(parts[i] + ext);
    return result;
  }
  return Array.from({ length: count }, (_, i) => `${stem}_part${i + 1}${ext}`);
}

export function SplitModal({ folderPath, files, initialFile, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Direct DOM refs updated by RAF — no React state re-renders during playback
  const timelineFillRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const markLabelRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  // Refs for values needed inside RAF/callbacks without closure staleness
  const fpsRef = useRef(0);
  const durationRef = useRef(0);
  // Gate: ignore new step requests until the current seek finishes
  const steppingRef = useRef(false);

  const [fileIdx, setFileIdx] = useState(() => {
    const idx = files.indexOf(initialFile);
    return idx >= 0 ? idx : 0;
  });
  const filename = files[fileIdx] ?? initialFile;

  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const [splits, setSplits] = useState<number[]>([]);
  const [names, setNames] = useState<string[]>([
    `${fileStem(filename)}_part1${fileExt(filename)}`,
    `${fileStem(filename)}_part2${fileExt(filename)}`,
  ]);
  const [deleteOriginal, setDeleteOriginal] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [done, setDone] = useState(false);
  const [originalDeleted, setOriginalDeleted] = useState(false);

  const videoUrl = `http://127.0.0.1:8765/api/video?path=${encodeURIComponent(`${folderPath}/${filename}`)}`;

  // Reset per-file state when navigating to a different file
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    durationRef.current = 0;
    fpsRef.current = 0;
    steppingRef.current = false;
    setDuration(0);
    setFps(0);
    setPlaying(false);
    setUnsupported(false);
    setSplits([]);
    setNames([
      `${fileStem(filename)}_part1${fileExt(filename)}`,
      `${fileStem(filename)}_part2${fileExt(filename)}`,
    ]);
    setRunning(false);
    setProgress([]);
    setDone(false);
    setOriginalDeleted(false);

    fetch(`http://127.0.0.1:8765/api/probe/video?path=${encodeURIComponent(`${folderPath}/${filename}`)}`)
      .then(r => r.json())
      .then(d => { if (d.fps) { setFps(d.fps); fpsRef.current = d.fps; } })
      .catch(() => {});
  }, [fileIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel RAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Recalculate all segment names whenever the split count changes.
  useEffect(() => {
    setNames(autoNames(fileStem(filename), fileExt(filename), splits.length + 1));
  }, [splits.length, filename]);

  // Update timecode display + timeline fill directly in the DOM (no React re-render)
  const updateLive = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    const dur = durationRef.current;
    const f = fpsRef.current;
    const pct = dur > 0 ? (t / dur) * 100 : 0;
    const label = f > 0 ? secsToHMSF(t, f) : secsToHMS(t);
    if (timecodeRef.current) timecodeRef.current.textContent = label;
    if (markLabelRef.current) markLabelRef.current.textContent = label;
    if (timelineFillRef.current) timelineFillRef.current.style.width = `${pct}%`;
    if (playheadRef.current) playheadRef.current.style.left = `${pct}%`;
  }, []);

  const startRAF = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => { updateLive(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
  }, [updateLive]);

  const stopRAF = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    updateLive();
  }, [updateLive]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  // Gate stepping: ignore new step while a seek is in flight
  const stepFrame = useCallback((dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v || !fpsRef.current || steppingRef.current) return;
    v.pause();
    steppingRef.current = true;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / fpsRef.current));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      if (e.code === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, stepFrame]);

  const markSplit = () => {
    const t = videoRef.current?.currentTime ?? 0;
    if (t <= 0 || t >= durationRef.current) return;
    setSplits(prev => {
      if (prev.some(s => Math.abs(s - t) < 0.1)) return prev;
      return [...prev, t].sort((a, b) => a - b);
    });
  };

  const removeSplit = (idx: number) => setSplits(prev => prev.filter((_, i) => i !== idx));

  const timelineSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!durationRef.current || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(durationRef.current, ((e.clientX - rect.left) / rect.width) * durationRef.current));
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
  };

  const handleSplit = async () => {
    if (splits.length === 0) return;
    setRunning(true);
    setProgress(names.map((n, i) => ({ segment: i + 1, status: 'pending', file: n })));
    try {
      const resp = await fetch('http://127.0.0.1:8765/api/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath,
          filename,
          splits: splits.map(secsToTimecode),
          output_names: names,
          delete_original: deleteOriginal,
        }),
      });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.status === 'deleted_original') { setOriginalDeleted(true); continue; }
          if (ev.status === 'complete') { setDone(true); break; }
          setProgress(prev => prev.map(p =>
            p.segment === ev.segment ? { ...p, status: ev.status, error: ev.error } : p
          ));
        }
      }
    } catch (e: any) {
      setProgress(prev => prev.map(p =>
        p.status !== 'done' ? { ...p, status: 'error', error: String(e) } : p
      ));
    } finally {
      setRunning(false);
    }
  };

  const canGoPrev = fileIdx > 0;
  const canGoNext = fileIdx < files.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div
        className="rounded-2xl w-full max-w-2xl shadow-2xl border flex flex-col"
        style={{ background: 'var(--bg-800)', borderColor: 'var(--border)', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Split File</h2>
            <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-muted)' }}>{filename}</p>
          </div>
          {files.length > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setFileIdx(i => i - 1)}
                disabled={!canGoPrev}
                className="p-1 rounded hover:opacity-70 disabled:opacity-30 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
                title="Previous file"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-xs tabular-nums px-1" style={{ color: 'var(--text-muted)' }}>
                {fileIdx + 1} / {files.length}
              </span>
              <button
                onClick={() => setFileIdx(i => i + 1)}
                disabled={!canGoNext}
                className="p-1 rounded hover:opacity-70 disabled:opacity-30 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
                title="Next file"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }} className="hover:opacity-70 transition-opacity shrink-0">
            <X size={18} />
          </button>
        </div>

        {!running && !done && (
          <>
            {/* Video player */}
            <div className="px-6 shrink-0">
              <div className="relative rounded-lg overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="w-full block"
                  style={{ maxHeight: 260, objectFit: 'contain' }}
                  preload="auto"
                  onLoadedMetadata={() => {
                    const dur = videoRef.current?.duration ?? 0;
                    setDuration(dur);
                    durationRef.current = dur;
                    updateLive();
                  }}
                  onPlay={() => { setPlaying(true); startRAF(); }}
                  onPause={() => { setPlaying(false); stopRAF(); }}
                  onSeeked={() => { steppingRef.current = false; updateLive(); }}
                  onError={() => setUnsupported(true)}
                />
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.3)' }}
                >
                  {playing ? <Pause size={40} className="text-white/90" /> : <Play size={40} className="text-white/90" />}
                </button>
              </div>
              {unsupported && (
                <p className="text-xs text-amber-400 mt-1.5">
                  This format may not play in-app — use the timeline or enter split times manually.
                </p>
              )}
            </div>

            {/* Timeline */}
            <div className="px-6 pt-3 shrink-0">
              <div
                ref={timelineRef}
                className="relative h-7 rounded-md cursor-crosshair select-none"
                style={{ background: 'var(--bg-600)' }}
                onClick={timelineSeek}
              >
                <div
                  ref={timelineFillRef}
                  className="absolute top-0 left-0 h-full rounded-l-md pointer-events-none"
                  style={{ width: '0%', background: 'var(--accent-600)', opacity: 0.35 }}
                />
                {duration > 0 && splits.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full w-0.5 pointer-events-none"
                    style={{ left: `${(t / duration) * 100}%`, background: 'var(--accent-400)' }}
                  >
                    <div
                      className="absolute -top-4 left-1/2 -translate-x-1/2 text-white rounded px-1 whitespace-nowrap"
                      style={{ fontSize: 9, background: 'var(--accent-600)' }}
                    >
                      {secsToHMS(t)}
                    </div>
                  </div>
                ))}
                <div
                  ref={playheadRef}
                  className="absolute top-0 h-full w-px bg-white/80 pointer-events-none"
                  style={{ left: '0%' }}
                />
              </div>

              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>00:00:00</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={togglePlay} style={{ color: 'var(--text-muted)' }} className="hover:opacity-70">
                    {playing ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    onClick={() => stepFrame(-1)}
                    disabled={!fps}
                    className="hover:opacity-70 disabled:opacity-30 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                    title="Previous frame (←)"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    <span ref={timecodeRef}>00:00:00</span>
                    {duration > 0 && <span style={{ color: 'var(--text-muted)' }}> / {secsToHMS(duration)}</span>}
                  </span>
                  <button
                    onClick={() => stepFrame(1)}
                    disabled={!fps}
                    className="hover:opacity-70 disabled:opacity-30 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                    title="Next frame (→)"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {duration > 0 ? secsToHMS(duration) : '--:--:--'}
                  {fps > 0 && <span> @ {fps % 1 === 0 ? fps : fps.toFixed(2)}fps</span>}
                </span>
              </div>
            </div>

            {/* Mark + delete original */}
            <div className="px-6 pt-2 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={markSplit}
                  disabled={!duration}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--accent-600)', color: '#fff' }}
                >
                  <Scissors size={13} />
                  Mark split at <span ref={markLabelRef}>00:00:00</span>
                </button>
                <div className="flex items-center gap-3 ml-auto">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
                    <input type="checkbox" checked={deleteOriginal} onChange={e => setDeleteOriginal(e.target.checked)} className="rounded" />
                    Delete original
                  </label>
                </div>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Space = play/pause · ← → = step one frame · click timeline to seek
              </p>
            </div>

            {/* Segment list */}
            <div className="flex-1 overflow-y-auto px-6 pt-3 pb-2 space-y-1.5 min-h-0">
              {splits.length === 0 ? (
                <p className="text-xs py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                  No split points yet — play the video and click Mark Split
                </p>
              ) : (
                names.map((name, i) => {
                  const segStart = i === 0 ? 0 : splits[i - 1];
                  const segEnd = i < splits.length ? splits[i] : duration;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2 rounded-lg border"
                      style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)' }}
                    >
                      <span className="text-xs font-mono shrink-0 w-5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {i + 1}
                      </span>
                      <span className="text-xs font-mono shrink-0" style={{ color: 'var(--accent-400)' }}>
                        {fps > 0 ? secsToHMSF(segStart, fps) : secsToHMS(segStart)}
                      </span>
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
                      <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {fps > 0 ? secsToHMSF(segEnd, fps) : secsToHMS(segEnd)}
                      </span>
                      <input
                        value={name}
                        onChange={e => setNames(prev => prev.map((n, idx) => idx === i ? e.target.value : n))}
                        className="flex-1 min-w-0 rounded px-2 py-1 text-xs font-mono border focus:outline-none"
                        style={{ background: 'var(--bg-600)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
                      />
                      {i > 0 && (
                        <button
                          onClick={() => removeSplit(i - 1)}
                          className="shrink-0 hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--text-muted)' }}
                          title="Remove this split point"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Progress view */}
        {(running || done) && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 min-h-0">
            {progress.map(p => (
              <div key={p.segment} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-700)' }}>
                {p.status === 'done' && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
                {p.status === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                {p.status === 'running' && <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent-400)' }} />}
                {p.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 shrink-0" style={{ borderColor: 'var(--bg-400)' }} />}
                <span className="flex-1 text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{p.file}</span>
                {p.status === 'running' && p.progress != null && (
                  <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--accent-400)' }}>{p.progress}%</span>
                )}
                {p.error && <span className="text-xs text-red-400 truncate max-w-40">{p.error}</span>}
              </div>
            ))}
            {done && originalDeleted && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-700)' }}>
                <Trash2 size={13} className="text-amber-400 shrink-0" />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Original deleted: {filename}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border text-sm transition-opacity hover:opacity-80"
            style={{ borderColor: 'var(--bg-400)', color: 'var(--text-secondary)' }}
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {done && canGoNext && (
            <button
              onClick={() => setFileIdx(i => i + 1)}
              className="flex-1 py-2 rounded-lg text-white font-medium text-sm"
              style={{ background: 'var(--accent-600)' }}
            >
              Next File →
            </button>
          )}
          {!done && (
            <button
              onClick={handleSplit}
              disabled={running || splits.length === 0}
              className="flex-1 py-2 rounded-lg text-white font-medium text-sm disabled:opacity-40"
              style={{ background: 'var(--accent-600)' }}
            >
              {running ? 'Splitting…' : `Split into ${splits.length + 1} part${splits.length > 0 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
