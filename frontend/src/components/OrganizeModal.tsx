import { useState, useEffect, useRef } from 'react';
import { X, Loader2, FolderInput, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import { organizeApply, getOrganizeUndoPreview, organizeUndo } from '../api/client';
import type { OrganizeMove, OrganizeHistoryMove } from '../api/client';
import toast from 'react-hot-toast';

type Scheme = 'flat' | 'az' | 'year' | 'genre' | 'studio' | 'franchise';

const SCHEMES: { id: Scheme; label: string; desc: string }[] = [
  { id: 'flat',      label: 'Flat',       desc: 'All files in one folder' },
  { id: 'az',        label: 'A – Z',      desc: 'One folder per letter' },
  { id: 'year',      label: 'Year',       desc: 'One folder per release year' },
  { id: 'genre',     label: 'Genre',      desc: 'Animation, Action…  (TMDB)' },
  { id: 'studio',    label: 'Studio',     desc: 'Production company  (TMDB)' },
  { id: 'franchise', label: 'Franchise',  desc: 'Series together, rest flat  (TMDB)' },
];

interface Props {
  moviePath: string;
  onClose: () => void;
  onApplied: () => void;
}

export function OrganizeModal({ moviePath, onClose, onApplied }: Props) {
  const [scheme, setScheme]         = useState<Scheme>('az');
  const [moves, setMoves]           = useState<OrganizeMove[]>([]);
  const [progress, setProgress]     = useState<{ done: number; total: number } | null>(null);
  const [loading, setLoading]       = useState(false);
  const [applying, setApplying]     = useState(false);
  const [movesOnly, setMovesOnly]   = useState(true);
  const [undoHistory, setUndoHistory] = useState<OrganizeHistoryMove[]>([]);
  const [undoing, setUndoing]       = useState(false);

  const movesRef  = useRef<OrganizeMove[]>([]);
  const flushRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const flush = () => setMoves([...movesRef.current]);

  const scheduleFlush = () => {
    if (flushRef.current) clearTimeout(flushRef.current);
    flushRef.current = setTimeout(flush, 120);
  };

  const loadPreview = async (s: Scheme) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    movesRef.current = [];
    setMoves([]);
    setProgress(null);
    setLoading(true);

    try {
      const resp = await fetch('http://127.0.0.1:8765/api/organize/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movie_path: moviePath, scheme: s }),
        signal: ctrl.signal,
      });

      const reader = resp.body!.getReader();
      const dec    = new TextDecoder();
      let buf      = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'move') {
              movesRef.current.push(obj as OrganizeMove);
              scheduleFlush();
            } else if (obj.type === 'progress') {
              setProgress({ done: obj.done, total: obj.total });
            } else if (obj.type === 'done') {
              flush();
              setProgress(p => p ? { ...p, done: obj.total } : { done: obj.total, total: obj.total });
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error('Preview failed');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };

  // Load preview whenever scheme changes
  useEffect(() => { loadPreview(scheme); }, [scheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for undo history on mount
  useEffect(() => {
    getOrganizeUndoPreview().then(r => setUndoHistory(r.moves)).catch(() => {});
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const result = await organizeUndo();
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} error(s): ${result.errors[0]}`);
      } else {
        toast.success(`Restored ${result.restored} file${result.restored !== 1 ? 's' : ''}`);
        setUndoHistory([]);
        onApplied();
        onClose();
      }
    } catch {
      toast.error('Undo failed');
    } finally {
      setUndoing(false);
    }
  };

  const handleApply = async () => {
    const toMove = moves.filter(m => m.changed);
    if (toMove.length === 0) { toast('No files to move'); return; }
    setApplying(true);
    try {
      const result = await organizeApply(toMove);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} error(s): ${result.errors[0]}`);
      } else {
        toast.success(`Moved ${result.moved} file${result.moved !== 1 ? 's' : ''}`);
        onApplied();
        onClose();
      }
    } catch {
      toast.error('Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const willMove   = moves.filter(m => m.changed).length;
  const alreadyOk  = moves.filter(m => !m.changed).length;
  const displayed  = movesOnly ? moves.filter(m => m.changed) : moves;

  // Group displayed moves by target folder for a cleaner view
  const byFolder: Record<string, OrganizeMove[]> = {};
  for (const m of displayed) {
    const key = m.folder || '(root)';
    (byFolder[key] ??= []).push(m);
  }
  const folders = Object.keys(byFolder).sort((a, b) =>
    a === '(root)' ? 1 : b === '(root)' ? -1 : a.localeCompare(b)
  );

  const needsTmdb = scheme === 'genre' || scheme === 'franchise' || scheme === 'studio';
  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl border w-[720px] max-w-[95vw]"
        style={{
          background: 'var(--bg-800)',
          borderColor: 'var(--border)',
          maxHeight: '85vh',
        }}
      >
        {/* ── header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <FolderInput size={16} className="text-brand-400" />
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Organize Library</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }} className="hover:opacity-80">
            <X size={16} />
          </button>
        </div>

        {/* ── undo banner ───────────────────────────────────────────────── */}
        {undoHistory.length > 0 && (
          <div
            className="flex items-center justify-between px-5 py-2.5 border-b shrink-0"
            style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--accent-600) 8%, transparent)' }}
          >
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <RotateCcw size={12} style={{ color: 'var(--accent-400)' }} />
              <span>Last organize can be undone — <span style={{ color: 'var(--text-secondary)' }}>{undoHistory.length} file{undoHistory.length !== 1 ? 's' : ''}</span> will be restored</span>
            </div>
            <button
              onClick={handleUndo}
              disabled={undoing}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--accent-600)', color: '#fff' }}
            >
              {undoing && <Loader2 size={11} className="animate-spin" />}
              Undo
            </button>
          </div>
        )}

        {/* ── scheme selector ────────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-3 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Scheme</p>
          <div className="flex gap-2 flex-wrap">
            {SCHEMES.map(s => (
              <button
                key={s.id}
                onClick={() => { if (!loading) setScheme(s.id); }}
                className="flex flex-col px-3 py-2 rounded-lg border text-left transition-colors"
                style={{
                  borderColor: scheme === s.id ? 'var(--accent-500)' : 'var(--border)',
                  background: scheme === s.id ? 'color-mix(in srgb, var(--accent-600) 12%, transparent)' : 'transparent',
                  opacity: loading && scheme !== s.id ? 0.5 : 1,
                }}
              >
                <span className="text-xs font-medium" style={{ color: scheme === s.id ? 'var(--accent-400)' : 'var(--text-primary)' }}>
                  {s.label}
                </span>
                <span className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── progress bar (TMDB schemes) ────────────────────────────────── */}
        {needsTmdb && (loading || (progress && progress.total > 0)) && (
          <div className="px-5 py-3 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {loading ? 'Looking up movies on TMDB…' : 'Done'}
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {progress?.done ?? 0} / {progress?.total ?? 0}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-600)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: 'var(--accent-500)' }}
              />
            </div>
          </div>
        )}

        {/* ── summary ─────────────────────────────────────────────────────── */}
        {moves.length > 0 && (
          <div
            className="flex items-center gap-4 px-5 py-2.5 border-b text-xs shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{moves.length}</span> files total</span>
            <span className="text-green-400 font-medium flex items-center gap-1">
              <CheckCircle2 size={12} /> {willMove} will move
            </span>
            <span>{alreadyOk} already in place</span>
            <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
              <input
                type="checkbox"
                checked={movesOnly}
                onChange={e => setMovesOnly(e.target.checked)}
                className="accent-blue-500"
              />
              Show moves only
            </label>
          </div>
        )}

        {/* ── preview table ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && moves.length === 0 && (
            <div className="flex items-center justify-center h-32 gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={14} className="animate-spin" />
              <span>{needsTmdb ? 'Looking up movies on TMDB…' : 'Calculating…'}</span>
            </div>
          )}

          {!loading && moves.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-xs gap-1" style={{ color: 'var(--text-muted)' }}>
              <AlertCircle size={20} />
              <span>No video files found in {moviePath}</span>
            </div>
          )}

          {folders.map(folder => (
            <div key={folder}>
              {/* folder header */}
              <div
                className="flex items-center gap-2 px-4 py-1.5 sticky top-0"
                style={{ background: 'var(--bg-700)', borderBottom: '1px solid var(--border)' }}
              >
                <FolderInput size={12} style={{ color: 'var(--accent-400)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--accent-400)' }}>
                  {folder === '(root)' ? '/ (root)' : folder + '/'}
                </span>
                <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                  {byFolder[folder].length} file{byFolder[folder].length !== 1 ? 's' : ''}
                </span>
              </div>
              {/* files in this folder */}
              {byFolder[folder].map(m => {
                const filename = m.source.split('/').pop()!;
                const srcFolder = m.source.includes('/') ? m.source.substring(0, m.source.lastIndexOf('/')) : '(root)';
                return (
                  <div
                    key={m.source}
                    className="flex items-center gap-2 px-5 py-1.5 text-xs border-b"
                    style={{
                      borderColor: 'var(--border)',
                      background: m.changed ? 'transparent' : 'color-mix(in srgb, var(--bg-600) 30%, transparent)',
                    }}
                  >
                    <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }} title={m.source}>
                      {filename}
                    </span>
                    {m.changed ? (
                      <>
                        <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {srcFolder}/
                        </span>
                        <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
                        <span className="shrink-0 font-medium" style={{ color: 'var(--accent-400)' }}>
                          {folder === '(root)' ? '/' : folder + '/'}
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0 text-green-600 text-xs">✓ already here</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── footer ──────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Source: <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{moviePath}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'var(--bg-600)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying || loading || willMove === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--accent-600)', color: '#fff' }}
            >
              {applying && <Loader2 size={12} className="animate-spin" />}
              Apply {willMove > 0 ? `${willMove} move${willMove !== 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
