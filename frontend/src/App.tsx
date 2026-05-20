import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { Settings, Tv, Clapperboard, ArrowUpCircle } from 'lucide-react';
import { LibraryPanel } from './components/LibraryPanel';
import { SearchPanel } from './components/SearchPanel';
import { ShowInfoPanel } from './components/ShowInfoPanel';
import { MovieInfoPanel } from './components/MovieInfoPanel';
import { RenamePanel } from './components/RenamePanel';
import { SettingsModal } from './components/SettingsModal';
import { FirstRunSetup } from './components/FirstRunSetup';
import { getSeason, getConfig, saveConfig, getMatchHistory, saveMatchHistory, checkUpdates, getMovie, getShow } from './api/client';
import type { ShowDetails, SeasonInfo, SeasonDetails, SeasonFolder, MovieDetails, Config } from './api/client';
import { ThemeContext, THEMES } from './ThemeContext';
import type { Theme } from './ThemeContext';
import { injectCustomThemeCss } from './customThemes';

function parseSeasonNum(name: string): number | null {
  const m = name.match(/season[\s._-]*(\d+)/i)
    ?? name.match(/\bs(\d{1,2})\b/i)
    ?? name.match(/^(\d{1,2})$/);
  return m ? parseInt(m[1], 10) : null;
}

function folderForSeason(folders: SeasonFolder[], num: number): SeasonFolder | null {
  return folders.find(f => parseSeasonNum(f.name) === num) ?? null;
}


export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [pattern, setPattern] = useState(' - ');
  const [theme, setThemeState] = useState<Theme>('Slate');
  const [updateAvailable, setUpdateAvailable] = useState<{ tag: string; url: string } | null>(null);

  // Media type
  const [mediaType, setMediaType] = useState<'tv' | 'movie'>('tv');

  // Library
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [seasonFolders, setSeasonFolders] = useState<SeasonFolder[]>([]);
  const [autoQuery, setAutoQuery] = useState<string | undefined>(undefined);

  // TV show state
  const [showId, setShowId] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState<ShowDetails | null>(null);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonDetails, setSeasonDetails] = useState<SeasonDetails | null>(null);

  // Movie state
  const [movieId, setMovieId] = useState<number | null>(null);
  const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);

  const suppressFolderLink = useRef(false);
  const suppressSeasonLink = useRef(false);

  useEffect(() => {
    getConfig().then(c => {
      setConfig(c);
      setPattern(c.pattern);
      c.custom_themes?.forEach((t, i) => injectCustomThemeCss((i + 1) as 1 | 2 | 3, t));
      if (c.theme && THEMES.includes(c.theme as Theme)) applyTheme(c.theme as Theme);
      const hasPath = (c.tv_path?.trim() && c.tv_path !== '/') || (c.movie_path?.trim() && c.movie_path !== '/') || (c.path?.trim() && c.path !== '/');
      if (!c.api_key?.trim() || !hasPath) setShowFirstRun(true);
    }).catch(() => {});
    checkUpdates().then(u => {
      // Only show update badge on stable builds, not test/dev builds
      if (u.latest_tag && u.url && !__APP_VERSION__.includes('test') && !__APP_VERSION__.includes('dev')) {
        if (u.latest_tag !== __APP_VERSION__ && u.latest_tag !== `v${__APP_VERSION__}`) {
          setUpdateAvailable({ tag: u.latest_tag, url: u.url });
        }
      }
    }).catch(() => {});
  }, []);

  const applyTheme = (t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    setThemeState(t);
  };

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
    saveConfig({ theme: t }).catch(() => {});
  }, []);

  const switchMediaType = (type: 'tv' | 'movie') => {
    setMediaType(type);
    // Clear selections when switching mode
    setShowId(null); setShowDetails(null); setSeasons([]);
    setSelectedSeason(null); setSeasonDetails(null);
    setMovieId(null); setMovieDetails(null);
    setSelectedFolder(null); setAutoQuery(undefined);
  };

  // ── Folder → TMDB season (TV mode) ────────────────────────────────────────
  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path);
    // Try to restore a previously saved match for this folder
    getMatchHistory(path).then(h => {
      if (!h?.id) return;
      if (h.type === 'tv') {
        getShow(h.id).then(({ details, seasons: s }) => {
          setShowId(h.id); setShowDetails(details); setSeasons(s);
          setMovieId(null); setMovieDetails(null);
          if (h.season_num != null) {
            setSelectedSeason(h.season_num);
            getSeason(h.id, h.season_num).then(d => setSeasonDetails(d.details)).catch(() => {});
          }
        }).catch(() => {});
      } else if (h.type === 'movie') {
        getMovie(h.id).then(details => {
          setMovieId(h.id); setMovieDetails(details);
          setShowId(null); setShowDetails(null); setSeasons([]);
        }).catch(() => {});
      }
    }).catch(() => {});
    if (mediaType !== 'tv' || suppressFolderLink.current) return;
    const folderName = path.split('/').pop() ?? '';
    const num = parseSeasonNum(folderName);
    if (num !== null && seasons.length > 0) {
      const match = seasons.find(s => s.num === num);
      if (match && match.num !== selectedSeason) {
        suppressSeasonLink.current = true;
        handleSelectSeason(match.num);
      }
    }
  }, [mediaType, seasons, selectedSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── TMDB season → folder (TV mode) ────────────────────────────────────────
  const handleSelectSeason = useCallback(async (num: number) => {
    if (!showId) return;
    setSelectedSeason(num);
    try {
      const data = await getSeason(showId, num);
      setSeasonDetails(data.details);
    } catch {}
    if (suppressSeasonLink.current) { suppressSeasonLink.current = false; return; }
    const target = folderForSeason(seasonFolders, num);
    if (target && target.path !== selectedFolder) {
      suppressFolderLink.current = true;
      setSelectedFolder(target.path);
      setTimeout(() => { suppressFolderLink.current = false; }, 100);
    }
  }, [showId, seasonFolders, selectedFolder]);

  const handleSelectShow = (id: number, details: ShowDetails, showSeasons: SeasonInfo[]) => {
    setShowId(id); setShowDetails(details); setSeasons(showSeasons);
    setSelectedSeason(null); setSeasonDetails(null);
    if (selectedFolder) {
      const num = parseSeasonNum(selectedFolder.split('/').pop() ?? '');
      if (num !== null) {
        const match = showSeasons.find(s => s.num === num);
        if (match) {
          suppressSeasonLink.current = true;
          getSeason(id, match.num).then(data => {
            setSelectedSeason(match.num);
            setSeasonDetails(data.details);
          }).catch(() => {});
        }
      }
    }
  };

  const handleSelectMovie = (id: number, details: MovieDetails) => {
    setMovieId(id);
    setMovieDetails(details);
  };

  // Derive RenamePanel props
  const renameShowId = mediaType === 'tv' ? showId : null;
  const renameSeasonNum = mediaType === 'tv' ? selectedSeason : null;
  const renameMovieId = mediaType === 'movie' ? movieId : null;

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className="flex flex-col h-screen bg-surface-900" style={{ color: 'var(--text-primary)' }}>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: 'var(--bg-600)', color: 'var(--text-primary)', border: '1px solid var(--bg-400)', fontSize: 13 },
            success: { iconTheme: { primary: '#22c55e', secondary: 'var(--bg-600)' } },
            error: { iconTheme: { primary: '#ef4444', secondary: 'var(--bg-600)' } },
          }}
        />

        {/* Titlebar */}
        <header className="flex items-center gap-3 px-4 py-2 border-b bg-surface-800 shrink-0" style={{ borderColor: 'var(--border)' }}>
          <Tv size={16} className="text-brand-400 shrink-0" />
          <span className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>Matchbox</span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>v{__APP_VERSION__}</span>

          {/* TV / Movie toggle */}
          <div className="flex items-center gap-0.5 rounded-lg p-0.5 ml-4" style={{ background: 'var(--bg-700)' }}>
            <button
              onClick={() => switchMediaType('tv')}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                background: mediaType === 'tv' ? 'var(--accent-600)' : 'transparent',
                color: mediaType === 'tv' ? '#fff' : 'var(--text-muted)',
              }}
            >
              <Tv size={12} />
              TV Shows
            </button>
            <button
              onClick={() => switchMediaType('movie')}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                background: mediaType === 'movie' ? 'var(--accent-600)' : 'transparent',
                color: mediaType === 'movie' ? '#fff' : 'var(--text-muted)',
              }}
            >
              <Clapperboard size={12} />
              Movies
            </button>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {updateAvailable && (
              <button
                onClick={() => window.open(updateAvailable.url)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs"
                style={{ color: '#fb923c', background: 'rgba(251,146,60,0.1)' }}
                title={`Update available: ${updateAvailable.tag}`}
              >
                <ArrowUpCircle size={13} />
                {updateAvailable.tag}
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs hover:bg-surface-700"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Settings size={13} />
              Settings
            </button>
          </div>
        </header>

        {/* Main 3-column layout */}
        <div className="flex flex-1 min-h-0">
          <aside className="w-52 shrink-0 border-r bg-surface-800 flex flex-col overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <LibraryPanel
              onSelectFolder={handleSelectFolder}
              onShowExpanded={(name, path) => {
                setAutoQuery(name);
                if (mediaType === 'movie') handleSelectFolder(path);
              }}
              onSeasonFoldersLoaded={setSeasonFolders}
              selectedPath={selectedFolder}
              rootPath={config
                ? (mediaType === 'tv'
                    ? (config.tv_path || config.path || '')
                    : (config.movie_path || config.path || ''))
                : ''}
            />
          </aside>

          <main className="flex-1 min-w-0 flex flex-col bg-surface-900 overflow-hidden">
            <RenamePanel
              showId={renameShowId}
              seasonNum={renameSeasonNum}
              movieId={renameMovieId}
              seasonPath={selectedFolder}
              seasonDetails={seasonDetails}
              movieDetails={movieDetails}
              pattern={pattern}
              onRenameSuccess={() => {
                if (!selectedFolder) return;
                if (mediaType === 'tv' && showId && showDetails) {
                  saveMatchHistory({ folder_path: selectedFolder, type: 'tv', id: showId, name: showDetails.name, season_num: selectedSeason ?? undefined }).catch(() => {});
                } else if (mediaType === 'movie' && movieId && movieDetails) {
                  saveMatchHistory({ folder_path: selectedFolder, type: 'movie', id: movieId, name: movieDetails.title }).catch(() => {});
                }
              }}
            />
          </main>

          <aside className="w-96 shrink-0 border-l bg-surface-800 flex flex-col overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="h-1/2 border-b flex flex-col overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <SearchPanel
                mediaType={mediaType}
                onSelectShow={handleSelectShow}
                onSelectMovie={handleSelectMovie}
                autoQuery={autoQuery}
              />
            </div>
            <div className="h-1/2 flex flex-col overflow-hidden">
              {mediaType === 'tv'
                ? <ShowInfoPanel showDetails={showDetails} seasons={seasons} selectedSeason={selectedSeason} onSelectSeason={handleSelectSeason} />
                : <MovieInfoPanel movie={movieDetails} />
              }
            </div>
          </aside>
        </div>

        {showSettings && (
          <SettingsModal onClose={() => {
            setShowSettings(false);
            getConfig().then(c => {
              setConfig(c);
              setPattern(c.pattern);
              if (c.theme && THEMES.includes(c.theme as Theme)) applyTheme(c.theme as Theme);
            }).catch(() => {});
          }} />
        )}

        {showFirstRun && config && (
          <FirstRunSetup
            initialApiKey={config.api_key}
            initialTvPath={config.tv_path || config.path || ''}
            initialMoviePath={config.movie_path || config.path || ''}
            initialPattern={config.pattern}
            onComplete={() => {
              setShowFirstRun(false);
              getConfig().then(c => {
                setConfig(c);
                setPattern(c.pattern);
                if (c.theme && THEMES.includes(c.theme as Theme)) applyTheme(c.theme as Theme);
              }).catch(() => {});
            }}
            onSkip={() => setShowFirstRun(false)}
          />
        )}
      </div>
    </ThemeContext.Provider>
  );
}
