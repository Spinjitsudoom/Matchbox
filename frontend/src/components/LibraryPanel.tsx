import { useEffect, useState } from 'react';
import { FolderOpen, ChevronRight, Film, RefreshCw, Shuffle } from 'lucide-react';
import { getLibrary, getSeasonFolders, getFiles } from '../api/client';
import type { LibraryEntry, SeasonFolder } from '../api/client';
import { OrganizeModal } from './OrganizeModal';

type SortField = 'name' | 'year' | 'count' | 'franchise';
type SortDir   = 'asc' | 'desc';

interface Props {
  onSelectFolder: (path: string) => void;
  onSelectFile?: (filename: string, folderPath: string) => void;
  onShowExpanded: (name: string, path: string) => void;
  onSeasonFoldersLoaded: (folders: SeasonFolder[]) => void;
  selectedPath: string | null;
  selectedFile?: string | null;
  rootPath: string;
  mediaType?: 'tv' | 'movie';
}

// ── helpers ───────────────────────────────────────────────────────────────────

function extractYear(filename: string): number {
  const m = filename.match(/\b((?:19|20)\d{2})\b/);
  return m ? parseInt(m[1]) : 0;
}

function extractFranchise(filename: string): string {
  const stem = filename
    .replace(/\.[^/.]+$/, '')
    .replace(/\s*\((?:19|20)\d{2}\).*$/, '')
    .replace(/\s*[-–]\s*(?:19|20)\d{2}.*$/, '')
    .trim();
  // Strip leading numbered prefix: "01 - Title" → "Title"
  const noPrefix = stem.replace(/^\d+\s*[-–.]\s*/, '').trim();
  const noSubtitle = noPrefix.replace(/\s*:.*$/, '').trim();
  const base = noSubtitle.replace(/\s+(?:[IVX]+|\d+)$/i, '').trim();
  return base || noPrefix || stem;
}

function sortFiles(files: string[], field: SortField, dir: SortDir): string[] {
  return [...files].sort((a, b) => {
    const cmp = field === 'year'
      ? extractYear(a) - extractYear(b)
      : a.localeCompare(b, undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

function sortFolders(folders: LibraryEntry[], fileCounts: Record<string, number>, field: SortField, dir: SortDir): LibraryEntry[] {
  return [...folders].sort((a, b) => {
    let cmp = 0;
    if (field === 'count') {
      cmp = (fileCounts[a.path] ?? 0) - (fileCounts[b.path] ?? 0);
    } else {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export function LibraryPanel({ onSelectFolder, onSelectFile, onShowExpanded, onSeasonFoldersLoaded, selectedPath, selectedFile, rootPath, mediaType }: Props) {
  const [shows, setShows] = useState<LibraryEntry[]>([]);
  const [seasons, setSeasons] = useState<Record<string, SeasonFolder[]>>({});
  const [movieFiles, setMovieFiles] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOrganize, setShowOrganize] = useState(false);

  // Sort state — persists while the panel is mounted
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');

  const isMovieMode = mediaType === 'movie';

  // File counts per folder, used for count sort
  const fileCounts: Record<string, number> = {};
  Object.entries(movieFiles).forEach(([path, files]) => { fileCounts[path] = files.length; });

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'year' ? 'desc' : 'asc');
    }
  };

  const refresh = async (path: string, currentExpanded: string | null = null) => {
    if (!path) return;
    setLoading(true);
    setSeasons({});
    setMovieFiles({});
    try {
      const entries = await getLibrary(path || undefined);
      setShows(entries);
      if (currentExpanded) {
        if (isMovieMode) {
          const files = await getFiles(currentExpanded).catch(() => []);
          setMovieFiles({ [currentExpanded]: files });
        } else {
          const subs = await getSeasonFolders(currentExpanded).catch(() => []);
          setSeasons({ [currentExpanded]: subs });
          onSeasonFoldersLoaded(subs);
        }
      } else {
        onSeasonFoldersLoaded([]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpanded(null);
    setSeasons({});
    setMovieFiles({});
    setShows([]);
    onSeasonFoldersLoaded([]);
    refresh(rootPath);
  }, [rootPath, mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (entry: LibraryEntry) => {
    if (expanded === entry.path) {
      setExpanded(null);
      onSeasonFoldersLoaded([]);
      return;
    }
    setExpanded(entry.path);
    if (isMovieMode) {
      if (!movieFiles[entry.path]) {
        const files = await getFiles(entry.path).catch(() => []);
        setMovieFiles(m => ({ ...m, [entry.path]: files }));
      }
    } else {
      onShowExpanded(entry.name, entry.path);
      let subs = seasons[entry.path];
      if (!subs) {
        subs = await getSeasonFolders(entry.path).catch(() => []);
        setSeasons(s => ({ ...s, [entry.path]: subs }));
      }
      onSeasonFoldersLoaded(subs);
    }
  };

  // Derive sorted lists for rendering
  const visibleFolders = isMovieMode
    ? sortFolders(shows, fileCounts, sortField === 'count' ? 'count' : 'name', sortField === 'count' ? sortDir : 'asc')
    : shows;

  // ── sort button helper ─────────────────────────────────────────────────────
  const SortBtn = ({ field, label }: { field: SortField; label: string }) => {
    const active = sortField === field;
    const arrow  = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <button
        onClick={() => handleSortClick(field)}
        className="px-1.5 py-0.5 rounded text-xs transition-colors"
        style={{
          background: active ? 'var(--accent-600)' : 'var(--bg-600)',
          color: active ? '#fff' : 'var(--text-muted)',
          fontWeight: active ? 500 : 400,
        }}
        title={`Sort by ${label}`}
      >
        {label}{arrow}
      </button>
    );
  };

  // ── shared file button ─────────────────────────────────────────────────────
  const FileBtn = ({ filename, folderPath, indent = 'pl-9' }: { filename: string; folderPath: string; indent?: string }) => {
    const active = selectedPath === folderPath && selectedFile === filename;
    return (
      <button
        onClick={() => onSelectFile?.(filename, folderPath)}
        className={`w-full flex items-center gap-3 ${indent} pr-4 py-2 text-left`}
        style={{
          background: active ? 'color-mix(in srgb, var(--accent-600) 15%, transparent)' : 'transparent',
          borderRight: active ? '2px solid var(--accent-500)' : '2px solid transparent',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-700)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span className="text-xs truncate" style={{ color: active ? 'var(--accent-400)' : 'var(--text-muted)', fontWeight: active ? 500 : 400 }}>
          {filename}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Library</span>
        <div className="flex items-center gap-2">
          {isMovieMode && (
            <button
              onClick={() => setShowOrganize(true)}
              title="Organize library"
              style={{ color: 'var(--text-muted)' }}
              className="hover:opacity-80 transition-opacity"
            >
              <Shuffle size={13} />
            </button>
          )}
          <button
            onClick={() => refresh(rootPath, expanded)}
            title="Refresh"
            style={{ color: 'var(--text-muted)' }}
            className="hover:opacity-80 transition-opacity"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── sort bar (movie mode only) ───────────────────────────────────────── */}
      {isMovieMode && (
        <div
          className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-800)' }}
        >
          <span className="text-xs mr-1" style={{ color: 'var(--text-muted)' }}>Sort:</span>
          <SortBtn field="name"      label="Name"      />
          <SortBtn field="year"      label="Year"      />
          <SortBtn field="count"     label="Count"     />
          <SortBtn field="franchise" label="Franchise" />
        </div>
      )}

      {/* ── list ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {shows.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-32 text-xs gap-2" style={{ color: 'var(--text-muted)' }}>
            <FolderOpen size={24} />
            <span>{isMovieMode ? 'No movies found' : 'No shows found'}</span>
          </div>
        )}

        {visibleFolders.map(show => (
          <div key={show.path}>
            <button
              onClick={() => toggle(show)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors group"
              style={{ background: expanded === show.path ? 'var(--bg-700)' : 'transparent' }}
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
              {isMovieMode && movieFiles[show.path] !== undefined && (
                <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--bg-400)' }}>
                  {movieFiles[show.path].length}
                </span>
              )}
            </button>

            {/* ── Movie mode: sorted file list ──────────────────────────── */}
            {isMovieMode && expanded === show.path && movieFiles[show.path] && (
              <div style={{ background: 'color-mix(in srgb, var(--bg-900) 50%, transparent)' }}>
                {movieFiles[show.path].length === 0 && (
                  <p className="pl-9 pr-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>No video files</p>
                )}

                {sortField === 'franchise' ? (() => {
                  const groups: Record<string, string[]> = {};
                  for (const f of movieFiles[show.path]) {
                    const key = extractFranchise(f);
                    (groups[key] ??= []).push(f);
                  }
                  const multi = Object.entries(groups)
                    .filter(([, fs]) => fs.length > 1)
                    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                  const solo = Object.entries(groups)
                    .filter(([, fs]) => fs.length === 1)
                    .flatMap(([, fs]) => fs)
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                  return (
                    <>
                      {multi.map(([name, files]) => (
                        <div key={name}>
                          <div className="px-9 py-1 text-xs font-medium" style={{ color: 'var(--accent-400)', borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent-600) 6%, transparent)' }}>
                            {name}
                          </div>
                          {files.slice().sort((a, b) => extractYear(a) - extractYear(b))
                            .map(f => <FileBtn key={f} filename={f} folderPath={show.path} indent="pl-11" />)}
                        </div>
                      ))}
                      {solo.length > 0 && (
                        <div>
                          {multi.length > 0 && (
                            <div className="px-9 py-1 text-xs font-medium" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-600) 20%, transparent)' }}>
                              Other
                            </div>
                          )}
                          {solo.map(f => <FileBtn key={f} filename={f} folderPath={show.path} indent="pl-11" />)}
                        </div>
                      )}
                    </>
                  );
                })() : sortFiles(movieFiles[show.path], sortField === 'count' ? 'name' : sortField, sortField === 'count' ? 'asc' : sortDir)
                    .map(f => <FileBtn key={f} filename={f} folderPath={show.path} />)}
              </div>
            )}

            {/* ── TV mode: season list ───────────────────────────────────── */}
            {!isMovieMode && expanded === show.path && seasons[show.path] && (
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

      {showOrganize && (
        <OrganizeModal
          moviePath={rootPath}
          onClose={() => setShowOrganize(false)}
          onApplied={() => { setShowOrganize(false); refresh(rootPath); }}
        />
      )}
    </div>
  );
}
