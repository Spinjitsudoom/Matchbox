import { useState, useEffect, useRef } from 'react';
import { X, Film, CheckSquare, Square, Loader2, CheckCircle2, XCircle, SkipForward, AlertCircle, ShieldCheck, Scissors, ChevronDown, ChevronRight } from 'lucide-react';
import { getFiles, checkFFmpeg, getAudioTracks, validateFiles } from '../api/client';
import type { FileAudioTracks, FileValidation } from '../api/client';
import { SplitModal } from './SplitModal';

interface ProgressItem {
  file: string;
  out?: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  error?: string;
  progress?: number;
}

interface Props {
  folderPath: string;
  onClose: () => void;
}

const FORMATS = ['mkv', 'mp4', 'm4v'] as const;
type Format = typeof FORMATS[number];

export function RemuxModal({ folderPath, onClose }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetFmt, setTargetFmt] = useState<Format>('mkv');
  const [deleteOrig, setDeleteOrig] = useState(false);
  const [defaultAudioTrack, setDefaultAudioTrack] = useState<number | null>(null);
  const [defaultSubtitleTrack, setDefaultSubtitleTrack] = useState<number | null>(null);
  const [maxAudioTracks, setMaxAudioTracks] = useState(0);
  const [maxSubtitleTracks, setMaxSubtitleTracks] = useState(0);
  const [fileAudioData, setFileAudioData] = useState<FileAudioTracks[]>([]);
  const [loadingAudioTracks, setLoadingAudioTracks] = useState(false);
  const [running, setRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<FileValidation[] | null>(null);
  const [expandedValidation, setExpandedValidation] = useState<Set<string>>(new Set());
  const [showSplit, setShowSplit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([
      getFiles(folderPath).catch(() => [] as string[]),
      checkFFmpeg().catch(() => ({ available: false })),
    ]).then(([list, ffCheck]) => {
      setFiles(list);
      setSelected(new Set(list));
      setFfmpegOk(ffCheck.available);
      setLoadingFiles(false);
      if (list.length > 0) {
        setLoadingAudioTracks(true);
        getAudioTracks(folderPath, list)
          .then(audio => {
            setMaxAudioTracks(audio.max_audio_tracks);
            setMaxSubtitleTracks(audio.max_subtitle_tracks);
            setFileAudioData(audio.files);
          })
          .catch(() => { setMaxAudioTracks(0); setMaxSubtitleTracks(0); setFileAudioData([]); })
          .finally(() => setLoadingAudioTracks(false));
      }
    });
    return () => { abortRef.current?.abort(); };
  }, [folderPath]);

  const toggleFile = (f: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const toggleAll = () =>
    setSelected(prev => prev.size === files.length ? new Set() : new Set(files));

  const handleStart = async () => {
    const filesToProcess = files.filter(f => selected.has(f));
    if (!filesToProcess.length) return;

    setRunning(true);
    setIsDone(false);
    setProgress(filesToProcess.map(f => ({ file: f, status: 'pending' })));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch('http://127.0.0.1:8765/api/remux', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath,
          files: filesToProcess,
          target_format: targetFmt,
          delete_original: deleteOrig,
          default_audio_track: defaultAudioTrack,
          default_subtitle_track: defaultSubtitleTrack,
        }),
      });

      if (!resp.ok) throw new Error('Request failed');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.status === 'complete') { setIsDone(true); break; }
            setProgress(prev => prev.map(p =>
              p.file === ev.file ? { ...p, ...ev } : p
            ));
          } catch {}
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setProgress(prev => prev.map(p =>
          (p.status === 'pending' || p.status === 'running')
            ? { ...p, status: 'error', error: 'Connection lost' }
            : p
        ));
      }
    } finally {
      setRunning(false);
      setIsDone(true);
    }
  };

  const labelFor = (key: 'tracks' | 'subtitle_tracks', pos: number): string => {
    const tracks = fileAudioData
      .filter(f => selected.has(f.file) && f[key].length >= pos)
      .map(f => f[key][pos - 1]);
    const lang = tracks.map(t => t.language).find(Boolean);
    const title = tracks.map(t => t.title).find(Boolean);
    const suffix = [lang, title].filter(Boolean).join(' · ');
    return suffix ? `Track ${pos} — ${suffix}` : `Track ${pos}`;
  };

  const missingFor = (key: 'tracks' | 'subtitle_tracks', pos: number): number => {
    const relevant = fileAudioData.filter(f => selected.has(f.file));
    return relevant.filter(f => f[key].length < pos).length;
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const result = await validateFiles(folderPath, [...selected]);
      setValidationResults(result.files);
    } finally {
      setValidating(false);
    }
  };

  const singleSelected = selected.size === 1 ? [...selected][0] : null;

  const selectedCount = files.filter(f => selected.has(f)).length;
  const completedCount = progress.filter(p => p.status !== 'pending' && p.status !== 'running').length;
  const barProgress = progress.length === 0 ? 0 : progress.reduce((sum, p) => {
    if (p.status === 'done' || p.status === 'skipped' || p.status === 'error') return sum + 1;
    if (p.status === 'running' && p.progress != null) return sum + p.progress / 100;
    return sum;
  }, 0) / progress.length * 100;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <div className="rounded-xl border shadow-2xl w-full max-w-3xl flex flex-col" style={{ background: 'var(--bg-800)', borderColor: 'var(--border)', maxHeight: '88vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <Film size={15} style={{ color: 'var(--accent-400)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Remux Files</h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>— change container, no re-encoding</span>
          <button onClick={() => { abortRef.current?.abort(); onClose(); }} className="ml-auto hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        {/* FFmpeg missing warning */}
        {ffmpegOk === false && (
          <div className="flex items-center gap-2 px-5 py-3 text-xs" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
            <AlertCircle size={14} />
            ffmpeg not found — install it to use remux
          </div>
        )}

        {/* Config rows */}
        {!running && !isDone && (
          <div className="flex flex-col border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-700)' }}>
            {/* Row 1: format + delete */}
            <div className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Output</span>
              <div className="flex gap-1">
                {FORMATS.map(f => (
                  <button key={f} onClick={() => setTargetFmt(f)}
                    className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                    style={{
                      background: targetFmt === f ? 'var(--accent-600)' : 'var(--bg-500)',
                      color: targetFmt === f ? '#fff' : 'var(--text-secondary)',
                    }}>
                    .{f}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={deleteOrig} onChange={e => setDeleteOrig(e.target.checked)} className="accent-blue-500" />
                Delete originals
              </label>
            </div>
            {/* Row 2: default audio */}
            <div className="flex items-center gap-3 px-5 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Default audio</span>
              <select
                value={defaultAudioTrack ?? ''}
                onChange={e => setDefaultAudioTrack(e.target.value ? Number(e.target.value) : null)}
                disabled={loadingAudioTracks || maxAudioTracks === 0}
                className="rounded px-2 py-1 text-xs border focus:outline-none disabled:opacity-50"
                style={{ background: 'var(--bg-600)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)', minWidth: 200 }}
              >
                <option value="">{loadingAudioTracks ? 'Checking...' : 'No change'}</option>
                {Array.from({ length: maxAudioTracks }, (_, i) => i + 1).map(pos => {
                  const missing = missingFor('tracks', pos);
                  return (
                    <option key={pos} value={pos}>
                      {labelFor('tracks', pos)}{missing > 0 ? ` (${missing} file${missing !== 1 ? 's' : ''} missing)` : ''}
                    </option>
                  );
                })}
              </select>
              {defaultAudioTrack != null && missingFor('tracks', defaultAudioTrack) > 0 && (
                <span className="text-xs" style={{ color: '#facc15' }}>
                  ⚠ {missingFor('tracks', defaultAudioTrack)} file{missingFor('tracks', defaultAudioTrack) !== 1 ? 's' : ''} missing this track — will error
                </span>
              )}
              <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>All other tracks are preserved</span>
            </div>
            {/* Row 3: default subtitle (only when embedded subtitles exist) */}
            {(loadingAudioTracks || maxSubtitleTracks > 0) && (
              <div className="flex items-center gap-3 px-5 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>Default subtitle</span>
                <select
                  value={defaultSubtitleTrack ?? ''}
                  onChange={e => setDefaultSubtitleTrack(e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingAudioTracks || maxSubtitleTracks === 0}
                  className="rounded px-2 py-1 text-xs border focus:outline-none disabled:opacity-50"
                  style={{ background: 'var(--bg-600)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)', minWidth: 200 }}
                >
                  <option value="">{loadingAudioTracks ? 'Checking...' : 'No change'}</option>
                  {Array.from({ length: maxSubtitleTracks }, (_, i) => i + 1).map(pos => {
                    const missing = missingFor('subtitle_tracks', pos);
                    return (
                      <option key={pos} value={pos}>
                        {labelFor('subtitle_tracks', pos)}{missing > 0 ? ` (${missing} file${missing !== 1 ? 's' : ''} missing)` : ''}
                      </option>
                    );
                  })}
                </select>
                {defaultSubtitleTrack != null && missingFor('subtitle_tracks', defaultSubtitleTrack) > 0 && (
                  <span className="text-xs" style={{ color: '#facc15' }}>
                    ⚠ {missingFor('subtitle_tracks', defaultSubtitleTrack)} file{missingFor('subtitle_tracks', defaultSubtitleTrack) !== 1 ? 's' : ''} missing this track — will error
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Progress bar */}
        {running && progress.length > 0 && (
          <div className="shrink-0">
            <div className="w-full h-1.5" style={{ background: 'var(--bg-500)' }}>
              <div className="h-1.5 transition-all duration-300 rounded-r"
                style={{ width: `${Math.max(2, barProgress)}%`, background: 'var(--accent-500)' }} />
            </div>
            <div className="flex items-center justify-between px-5 py-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {completedCount} / {progress.length} complete
              </span>
              <span className="text-xs font-mono font-medium" style={{ color: 'var(--accent-400)' }}>
                {Math.round(barProgress)}%
              </span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {validationResults ? (
            <div className="p-4 space-y-2">
              <button onClick={() => setValidationResults(null)}
                className="text-xs mb-1 flex items-center gap-1 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-muted)' }}>
                ← Back to file list
              </button>
              {validationResults.map(v => {
                const hasWarns = (v.warnings?.length ?? 0) > 0;
                const expanded = expandedValidation.has(v.file);
                return (
                  <div key={v.file} className="rounded-lg border overflow-hidden"
                    style={{ borderColor: hasWarns ? 'rgba(251,146,60,0.4)' : 'var(--bg-400)', background: 'var(--bg-700)' }}>
                    <button className="flex items-center gap-2 w-full px-3 py-2 text-left"
                      onClick={() => setExpandedValidation(prev => { const n = new Set(prev); n.has(v.file) ? n.delete(v.file) : n.add(v.file); return n; })}>
                      {hasWarns
                        ? <AlertCircle size={13} style={{ color: '#fb923c', flexShrink: 0 }} />
                        : <ShieldCheck size={13} className="text-green-400 shrink-0" />}
                      <span className="flex-1 text-xs truncate" style={{ color: 'var(--text-primary)' }}>{v.file}</span>
                      {v.error && <span className="text-xs text-red-400 mr-2">{v.error}</span>}
                      {hasWarns && <span className="text-xs mr-2" style={{ color: '#fb923c' }}>{v.warnings!.length} warning{v.warnings!.length !== 1 ? 's' : ''}</span>}
                      {expanded ? <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                    </button>
                    {expanded && !v.error && (
                      <div className="px-3 pb-3 space-y-1.5 border-t" style={{ borderColor: 'var(--bg-500)' }}>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
                          {v.video?.[0] && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Video: <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{v.video[0].codec ?? '?'}</span></span>}
                          {v.audio?.map((a, i) => <span key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>Audio {i + 1}: <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{a.codec ?? '?'}{a.language ? ` (${a.language})` : ''}</span></span>)}
                          {(v.subtitles?.length ?? 0) > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Subtitles: <span style={{ color: 'var(--text-primary)' }}>{v.subtitles!.length}</span></span>}
                          {v.duration != null && v.duration > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Duration: <span style={{ color: 'var(--text-primary)' }}>{Math.floor(v.duration / 3600)}:{String(Math.floor((v.duration % 3600) / 60)).padStart(2, '0')}:{String(Math.floor(v.duration % 60)).padStart(2, '0')}</span></span>}
                          {v.size != null && v.size > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Size: <span style={{ color: 'var(--text-primary)' }}>{(v.size / 1e9).toFixed(2)} GB</span></span>}
                        </div>
                        {hasWarns && <div className="space-y-1 mt-1">{v.warnings!.map((w, i) => <p key={i} className="text-xs" style={{ color: '#fb923c' }}>⚠ {w}</p>)}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : loadingFiles ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
            </div>
          ) : progress.length > 0 ? (
            <div className="p-4 space-y-1">
              {progress.map(p => (
                <div key={p.file} className="flex items-center gap-2.5 text-xs py-1">
                  {p.status === 'pending'  && <div className="w-3.5 h-3.5 rounded-full border-2 shrink-0" style={{ borderColor: 'var(--bg-400)' }} />}
                  {p.status === 'running'  && <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--accent-400)' }} />}
                  {p.status === 'done'     && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
                  {p.status === 'skipped'  && <SkipForward size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  {p.status === 'error'    && <XCircle size={14} className="text-red-400 shrink-0" />}
                  <span className="truncate flex-1" style={{
                    color: p.status === 'error' ? '#f87171'
                      : p.status === 'done' ? '#4ade80'
                      : p.status === 'skipped' ? 'var(--text-muted)'
                      : 'var(--text-secondary)',
                  }}>
                    {p.status === 'done' && p.out ? p.out : p.file}
                  </span>
                  {p.status === 'error' && p.error && (
                    <span className="text-red-400 truncate shrink-0 max-w-xs" title={p.error}>{p.error}</span>
                  )}
                  {p.status === 'skipped' && (
                    <span className="shrink-0" style={{ color: 'var(--text-muted)', fontSize: 10 }}>same format</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <button onClick={toggleAll}
                className="flex items-center gap-2 w-full px-5 py-2.5 border-b text-xs hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                {selected.size === files.length
                  ? <CheckSquare size={13} style={{ color: 'var(--accent-400)' }} />
                  : <Square size={13} />}
                <span>{selected.size === files.length ? 'Deselect all' : 'Select all'}</span>
                <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{selectedCount} / {files.length} selected</span>
              </button>
              {files.map(f => (
                <button key={f} onClick={() => toggleFile(f)}
                  className="flex items-center gap-2.5 w-full px-5 py-2 border-b text-left hover:opacity-80 transition-opacity"
                  style={{ borderColor: 'var(--border)' }}>
                  {selected.has(f)
                    ? <CheckSquare size={13} style={{ color: 'var(--accent-400)' }} />
                    : <Square size={13} style={{ color: 'var(--text-muted)' }} />}
                  <span className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>{f}</span>
                  <span className="text-xs shrink-0 uppercase" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    {f.split('.').pop()}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-700)' }}>
          {isDone && !running && (
            <span className="text-xs text-green-400">
              Done — {progress.filter(p => p.status === 'done').length} remuxed
              {progress.filter(p => p.status === 'skipped').length > 0 && `, ${progress.filter(p => p.status === 'skipped').length} skipped`}
              {progress.filter(p => p.status === 'error').length > 0 && `, ${progress.filter(p => p.status === 'error').length} failed`}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {!isDone && !running && !validationResults && (
              <>
                {singleSelected && (
                  <button onClick={() => setShowSplit(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                    style={{ background: 'var(--bg-500)', color: 'var(--text-secondary)' }}
                    title="Split this file into multiple parts">
                    <Scissors size={13} /> Split
                  </button>
                )}
                <button onClick={handleValidate} disabled={validating || selectedCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40"
                  style={{ background: 'var(--bg-500)', color: 'var(--text-secondary)' }}>
                  {validating ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  {validating ? 'Checking…' : 'Validate'}
                </button>
              </>
            )}
            <button
              onClick={() => { abortRef.current?.abort(); onClose(); }}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'var(--bg-500)', color: 'var(--text-secondary)' }}>
              {isDone ? 'Close' : 'Cancel'}
            </button>
            {!isDone && !validationResults && (
              <button
                onClick={handleStart}
                disabled={running || selectedCount === 0 || ffmpegOk === false}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent-600)' }}>
                {running ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />}
                {running ? 'Remuxing…' : `Remux ${selectedCount} File${selectedCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    {showSplit && singleSelected && (
      <SplitModal folderPath={folderPath} files={files} initialFile={singleSelected} onClose={() => setShowSplit(false)} />
    )}
    </>
  );
}
