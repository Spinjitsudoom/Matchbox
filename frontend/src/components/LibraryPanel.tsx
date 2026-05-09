import { useEffect, useState } from 'react';
import { FolderOpen, ChevronRight, Film, RefreshCw } from 'lucide-react';
import { getLibrary, getSeasonFolders } from '../api/client';
import type { LibraryEntry, SeasonFolder } from '../api/client';

interface Props {
  onSelectFolder: (path: string) => void;
  onShowExpanded: (name: string, path: string) => void;
  onSeasonFoldersLoaded: (folders: SeasonFolder[]) => void;
  selectedPath: string | null;
}

export function LibraryPanel({ onSelectFolder, onShowExpanded, onSeasonFoldersLoaded, selectedPath }: Props) {
  const [shows, setShows] = useState<LibraryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Record<string, SeasonFolder[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    getLibrary().then(setShows).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const toggle = async (entry: LibraryEntry) => {
    if (expanded === entry.path) {
      setExpanded(null);
      onSeasonFoldersLoaded([]);
      return;
    }
    setExpanded(entry.path);
    onShowExpanded(entry.name, entry.path);
    let subs = seasons[entry.path];
    if (!subs) {
      subs = await getSeasonFolders(entry.path).catch(() => []);
      setSeasons(s => ({ ...s, [entry.path]: subs }));
    }
    onSeasonFoldersLoaded(subs);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Library</span>
        <button onClick={refresh} title="Refresh" style={{ color: 'var(--text-muted)' }} className="hover:opacity-80 transition-opacity">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {shows.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-32 text-xs gap-2" style={{ color: 'var(--text-muted)' }}>
            <FolderOpen size={24} />
            <span>No shows found</span>
          </div>
        )}

        {shows.map(show => (
          <div key={show.path}>
            <button
              onClick={() => toggle(show)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors group"
              style={{
                background: expanded === show.path ? 'var(--bg-700)' : 'transparent',
              }}
              onMouseEnter={e => { if (expanded !== show.path) (e.currentTarget as HTMLElement).style.background = 'var(--bg-700)'; }}
              onMouseLeave={e => { if (expanded !== show.path) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <ChevronRight
                size={13}
                className={`shrink-0 transition-transform ${expanded === show.path ? 'rotate-90' : ''}`}
                style={{ color: 'var(--text-muted)' }}
              />
              <Film size={13} className="shrink-0 text-brand-400" />
              <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                {show.name}
              </span>
            </button>

            {expanded === show.path && seasons[show.path] && (
              <div style={{ background: 'color-mix(in srgb, var(--bg-900) 50%, transparent)' }}>
                {seasons[show.path].map(season => {
                  const active = selectedPath === season.path;
                  return (
                    <button
                      key={season.path}
                      onClick={() => onSelectFolder(season.path)}
                      className="w-full flex items-center gap-3 pl-9 pr-4 py-2 text-left transition-colors"
                      style={{
                        background: active ? 'color-mix(in srgb, var(--accent-600) 15%, transparent)' : 'transparent',
                        borderRight: active ? '2px solid var(--accent-500)' : '2px solid transparent',
                      }}
                    >
                      <span
                        className="text-xs truncate"
                        style={{ color: active ? 'var(--accent-400)' : 'var(--text-muted)', fontWeight: active ? 500 : 400 }}
                      >
                        {season.name}
                      </span>
                      <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--bg-400)' }}>
                        {season.file_count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
