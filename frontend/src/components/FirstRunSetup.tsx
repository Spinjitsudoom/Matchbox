import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, Settings2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { checkFFmpeg, saveConfig } from '../api/client';

const BASE_URL = 'http://127.0.0.1:8765';

interface Props {
  initialApiKey: string;
  initialTvPath: string;
  initialMoviePath: string;
  initialPattern: string;
  onComplete: () => void;
  onSkip: () => void;
}

type FFmpegStatus = 'checking' | 'available' | 'missing';

export function FirstRunSetup({ initialApiKey, initialTvPath, initialMoviePath, initialPattern, onComplete, onSkip }: Props) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [tvPath, setTvPath] = useState(initialTvPath === '/' ? '' : initialTvPath);
  const [moviePath, setMoviePath] = useState(initialMoviePath === '/' ? '' : initialMoviePath);
  const [pattern, setPattern] = useState(initialPattern || ' - ');
  const [ffmpegStatus, setFfmpegStatus] = useState<FFmpegStatus>('checking');
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    checkFFmpeg()
      .then(result => setFfmpegStatus(result.available ? 'available' : 'missing'))
      .catch(() => setFfmpegStatus('missing'));
  }, []);

  const installFFmpeg = async () => {
    setFfmpegInstallProgress(0);
    try {
      const resp = await fetch(`${BASE_URL}/api/ffmpeg/install`);
      if (!resp.ok) throw new Error('Request failed');
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.status === 'error') throw new Error(ev.error || 'Install failed');
            if (ev.progress != null) setFfmpegInstallProgress(ev.progress);
            if (ev.status === 'done') {
              setFfmpegStatus('available');
              toast.success('FFmpeg installed');
            }
          } catch (e: any) {
            if (e?.message) { toast.error(e.message); setFfmpegStatus('missing'); }
          }
        }
      }
    } catch {
      toast.error('FFmpeg download failed');
      setFfmpegStatus('missing');
    } finally {
      setFfmpegInstallProgress(null);
    }
  };

  const save = async () => {
    if (!apiKey.trim()) {
      toast.error('Add a TMDB API key first');
      return;
    }
    if (!tvPath.trim() && !moviePath.trim()) {
      toast.error('Set at least one library path');
      return;
    }

    setSaving(true);
    try {
      await saveConfig({ api_key: apiKey.trim(), tv_path: tvPath.trim(), movie_path: moviePath.trim(), pattern });
      toast.success('Setup saved');
      onComplete();
    } catch {
      toast.error('Failed to save setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-800)', borderColor: 'var(--border)' }}
      >
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-600)', color: 'var(--accent-400)' }}>
              <Settings2 size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>First-run setup</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Connect Matchbox to your media library.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>TMDB API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
              style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
              placeholder="Paste your TMDB API key"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>TV Shows Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tvPath}
                onChange={event => setTvPath(event.target.value)}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
                style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
                placeholder="/path/to/tv/shows"
              />
              {window.electronAPI && (
                <button
                  onClick={async () => { const f = await window.electronAPI?.selectFolder(); if (f) setTvPath(f); }}
                  className="px-3 rounded-lg border transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-muted)' }}
                  title="Browse for folder"
                >
                  <FolderOpen size={16} />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Movies Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={moviePath}
                onChange={event => setMoviePath(event.target.value)}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
                style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
                placeholder="/path/to/movies"
              />
              {window.electronAPI && (
                <button
                  onClick={async () => { const f = await window.electronAPI?.selectFolder(); if (f) setMoviePath(f); }}
                  className="px-3 rounded-lg border transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-muted)' }}
                  title="Browse for folder"
                >
                  <FolderOpen size={16} />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Rename Separator</label>
            <input
              type="text"
              value={pattern}
              onChange={event => setPattern(event.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
              style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
              placeholder=" - "
            />
          </div>

          {ffmpegStatus !== 'available' && (
            <div className="rounded-lg border px-3 py-2.5 flex flex-col gap-2" style={{ borderColor: 'var(--bg-400)', background: 'var(--bg-700)' }}>
              <div className="flex items-center gap-2">
                {ffmpegStatus === 'checking' && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
                {ffmpegStatus === 'missing' && ffmpegInstallProgress === null && <XCircle size={16} className="text-amber-400" />}
                {ffmpegStatus === 'missing' && ffmpegInstallProgress !== null && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
                <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {ffmpegStatus === 'checking' && 'Checking for FFmpeg…'}
                  {ffmpegStatus === 'missing' && ffmpegInstallProgress === null && 'FFmpeg not found — required for splitting & remuxing'}
                  {ffmpegStatus === 'missing' && ffmpegInstallProgress !== null && `Installing FFmpeg… ${ffmpegInstallProgress}%`}
                </span>
                {ffmpegStatus === 'missing' && ffmpegInstallProgress === null && (
                  <button
                    onClick={installFFmpeg}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                    style={{ background: 'var(--accent-600)', color: '#fff' }}
                  >
                    <Download size={12} />
                    Download & Install
                  </button>
                )}
              </div>
              {ffmpegStatus === 'missing' && ffmpegInstallProgress !== null && (
                <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--bg-500)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${ffmpegInstallProgress}%`, background: 'var(--accent-500)' }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-3" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg border text-sm transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--bg-400)', color: 'var(--text-secondary)' }}
            disabled={saving}
          >
            Skip
          </button>
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg text-white font-medium text-sm transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent-600)' }}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Finish Setup'}
          </button>
        </div>
      </div>
    </div>
  );
}
