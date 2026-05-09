import { useState, useEffect, useRef } from 'react';
import { X, Film, CheckSquare, Square, Loader2, CheckCircle2, XCircle, SkipForward, AlertCircle } from 'lucide-react';
import { getFiles, checkFFmpeg } from '../api/client';

interface ProgressItem {
  file: string;
  out?: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  error?: string;
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
  const [running, setRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
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
      const resp = await fetch('/api/remux', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath,
          files: filesToProcess,
          target_format: targetFmt,
          delete_original: deleteOrig,
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

  const selectedCount = files.filter(f => selected.has(f)).length;
  const completedCount = progress.filter(p => p.status !== 'pending' && p.status !== 'running').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <div className="rounded-xl border shadow-2xl w-full max-w-lg flex flex-col" style={{ background: 'var(--bg-800)', borderColor: 'var(--border)', maxHeight: '85vh' }}>

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

        {/* Config row */}
        {!running && !isDone && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-700)' }}>
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
            <label className="flex items-center gap-1.5 ml-auto cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={deleteOrig} onChange={e => setDeleteOrig(e.target.checked)} className="accent-blue-500" />
              Delete originals
            </label>
          </div>
        )}

        {/* Progress bar (while running) */}
        {running && progress.length > 0 && (
          <div className="w-full h-1 shrink-0" style={{ background: 'var(--bg-500)' }}>
            <div className="h-1 transition-all duration-300"
              style={{ width: `${(completedCount / progress.length) * 100}%`, background: 'var(--accent-500)' }} />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loadingFiles ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
            </div>
          ) : progress.length > 0 ? (
            /* Progress list */
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
                    <span className="text-red-400 truncate max-w-40 shrink-0" title={p.error}>error</span>
                  )}
                  {p.status === 'skipped' && (
                    <span className="shrink-0" style={{ color: 'var(--text-muted)', fontSize: 10 }}>same format</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* File picker */
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
          {running && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {completedCount} / {progress.length} complete…
            </span>
          )}
          {isDone && !running && (
            <span className="text-xs text-green-400">
              Done — {progress.filter(p => p.status === 'done').length} remuxed
              {progress.filter(p => p.status === 'skipped').length > 0 && `, ${progress.filter(p => p.status === 'skipped').length} skipped`}
              {progress.filter(p => p.status === 'error').length > 0 && `, ${progress.filter(p => p.status === 'error').length} failed`}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => { abortRef.current?.abort(); onClose(); }}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'var(--bg-500)', color: 'var(--text-secondary)' }}>
              {isDone ? 'Close' : 'Cancel'}
            </button>
            {!isDone && (
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
  );
}
