import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { getConfig, saveConfig } from '../api/client';
import type { Config } from '../api/client';
import { THEMES } from '../ThemeContext';
import type { Theme } from '../ThemeContext';
import { useTheme } from '../ThemeContext';
import toast from 'react-hot-toast';

interface Props { onClose: () => void }

const THEME_COLORS: Record<Theme, string> = {
  Slate: '#3b82f6', Dark: '#6366f1', Midnight: '#6366f1',
  Emerald: '#10b981', Amethyst: '#a855f7', Crimson: '#ef4444',
  Forest: '#4ade80', Ocean: '#0ea5e9', Light: '#2563eb',
};

export function SettingsModal({ onClose }: Props) {
  const [cfg, setCfg] = useState<Config>({ api_key: '', path: '/', pattern: ' - ', theme: 'Slate' });
  const [showKey, setShowKey] = useState(false);
  const { theme: currentTheme, setTheme } = useTheme();

  useEffect(() => {
    getConfig().then(setCfg).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await saveConfig(cfg);
      if (cfg.theme && THEMES.includes(cfg.theme as Theme)) {
        setTheme(cfg.theme as Theme);
      }
      toast.success('Settings saved');
      onClose();
    } catch {
      toast.error('Failed to save settings');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="rounded-2xl w-full max-w-md p-6 shadow-2xl border"
        style={{ background: 'var(--bg-800)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
          <button onClick={onClose} className="transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>TMDB API Key</label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={cfg.api_key}
                onChange={e => setCfg(p => ({ ...p, api_key: e.target.value }))}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
                style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
                placeholder="Enter your TMDB API key"
              />
              <button
                onClick={() => setShowKey(s => !s)}
                className="px-3 rounded-lg border transition-colors hover:opacity-80"
                style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-muted)' }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Media Library Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={cfg.path}
                onChange={e => setCfg(p => ({ ...p, path: e.target.value }))}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none border transition-colors"
                style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
                placeholder="/path/to/tv/shows"
              />
              {window.electronAPI && (
                <button
                  onClick={async () => {
                    const folder = await window.electronAPI!.selectFolder();
                    if (folder) setCfg(p => ({ ...p, path: folder }));
                  }}
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Rename Pattern (separator)</label>
            <input
              type="text"
              value={cfg.pattern}
              onChange={e => setCfg(p => ({ ...p, pattern: e.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none border"
              style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
              placeholder=" - "
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              e.g. <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>" - "</span> → <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>01 - Episode Title.mkv</span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Theme</label>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map(t => (
                <button
                  key={t}
                  onClick={() => { setCfg(p => ({ ...p, theme: t })); setTheme(t); }}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs border transition-colors"
                  style={{
                    background: currentTheme === t ? 'var(--bg-500)' : 'var(--bg-700)',
                    borderColor: currentTheme === t ? 'var(--accent-400)' : 'var(--bg-400)',
                    color: currentTheme === t ? 'var(--accent-400)' : 'var(--text-secondary)',
                  }}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: THEME_COLORS[t] }} />
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border text-sm transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--bg-400)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex-1 py-2 rounded-lg text-white font-medium text-sm transition-colors"
            style={{ background: 'var(--accent-600)' }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
