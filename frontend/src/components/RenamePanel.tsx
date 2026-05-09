import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileEdit, Undo2, ChevronUp, ChevronDown,
  ArrowRight, ToggleLeft, ToggleRight, Loader2, AlertCircle, Film, Captions
} from 'lucide-react';
import { previewRename, doRename, undoRename, imgUrl } from '../api/client';
import type { EpisodeMatch, SeasonDetails, MovieDetails } from '../api/client';
import { Poster } from './Poster';
import { RemuxModal } from './RemuxModal';
import { SubtitleModal } from './SubtitleModal';
import toast from 'react-hot-toast';

interface Props {
  showId: number | null;
  seasonNum: number | null;
  movieId: number | null;
  seasonPath: string | null;
  seasonDetails: SeasonDetails | null;
  movieDetails: MovieDetails | null;
  pattern: string;
}

function scoreColor(score: number, hasFile: boolean): {
  row: string; badge: string; label: string;
} {
  if (!hasFile || score <= 50) return {
    row: 'border-l-2 border-red-500/70 bg-red-500/5',
    badge: 'bg-red-500/20 text-red-400',
    label: 'text-red-400',
  };
  if (score <= 90) return {
    row: 'border-l-2 border-yellow-500/70 bg-yellow-500/5',
    badge: 'bg-yellow-500/20 text-yellow-400',
    label: 'text-yellow-300',
  };
  return {
    row: 'border-l-2 border-green-500/70 bg-green-500/5',
    badge: 'bg-green-500/20 text-green-400',
    label: 'text-green-400',
  };
}

export function RenamePanel({ showId, seasonNum, movieId, seasonPath, seasonDetails, movieDetails, pattern }: Props) {
  const isMovie = movieId !== null;
  const [episodes, setEpisodes] = useState<EpisodeMatch[]>([]);
  const [mode, setMode] = useState<'numeric' | 'title'>('numeric');
  const [fOffset, setFOffset] = useState(0);
  const [customPattern, setCustomPattern] = useState(pattern);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingRename, setLoadingRename] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [showRemux, setShowRemux] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [subtitlesVisible, setSubtitlesVisible] = useState(false);

  useEffect(() => { setCustomPattern(pattern); }, [pattern]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchPreview = useCallback(async () => {
    if (!seasonPath) return;
    if (isMovie && !movieId) return;
    if (!isMovie && (!showId || !seasonNum)) return;
    setLoadingPreview(true);
    try {
      const result = await previewRename(isMovie
        ? { season_path: seasonPath, mode: 'movie', movie_id: movieId! }
        : { season_path: seasonPath, mode, show_id: showId!, season_num: seasonNum!, f_offset: fOffset, pattern: customPattern }
      );
      setEpisodes(result.episodes);
    } catch (e: any) {
      toast.error('Preview failed: ' + (e?.response?.data?.detail || 'Unknown error'));
    } finally {
      setLoadingPreview(false);
    }
  }, [showId, seasonNum, movieId, seasonPath, mode, fOffset, customPattern]);

  // Auto-trigger when the required combination of keys is present
  useEffect(() => {
    const tvReady = !!showId && seasonNum !== null && !!seasonPath;
    const movieReady = !!movieId && !!seasonPath;
    if (tvReady || movieReady) fetchPreview();
    else setEpisodes([]);
  }, [showId, seasonNum, movieId, seasonPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run preview when controls change, but skip the initial render
  const controlsInitRef = useRef(false);
  useEffect(() => {
    if (!controlsInitRef.current) { controlsInitRef.current = true; return; }
    if (episodes.length > 0) fetchPreview();
  }, [mode, fOffset, customPattern]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRename = async () => {
    if (!seasonPath) return;
    const pairs = episodes
      .filter(e => e.old_file && e.new_file && e.changed)
      .map(e => ({ old: e.old_file!, new: e.new_file! }));
    if (pairs.length === 0) { toast('No changes to apply'); return; }
    setLoadingRename(true);
    try {
      const result = await doRename(seasonPath, pairs);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} error(s): ${result.errors[0]}`);
      } else {
        toast.success(`Renamed ${result.renamed.length} file(s)`);
      }
      if (result.can_undo) setCanUndo(true);
      fetchPreview();
    } catch {
      toast.error('Rename failed');
    } finally {
      setLoadingRename(false);
    }
  };

  const handleUndo = async () => {
    try {
      const result = await undoRename();
      toast.success(`Restored ${result.restored.length} file(s)`);
      setCanUndo(false);
      fetchPreview();
    } catch {
      toast.error('Nothing to undo');
    }
  };

  const greenCount = episodes.filter(e => e.score > 90 && e.old_file).length;
  const yellowCount = episodes.filter(e => e.score > 50 && e.score <= 90 && e.old_file).length;
  const redCount = episodes.filter(e => !e.old_file || e.score <= 50).length;
  const changedCount = episodes.filter(e => e.changed).length;

  const ready = seasonPath && (isMovie ? movieId : (showId && seasonNum));
  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-muted)' }}>
        <FileEdit size={40} />
        <p className="text-sm">
          {isMovie
            ? 'Select a folder and search for a movie to rename'
            : 'Select a show, season, and local folder to start renaming'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Movie artwork header */}
      {isMovie && movieDetails && (
        <div className="relative overflow-hidden border-b shrink-0" style={{ borderColor: 'var(--border)', minHeight: 96 }}>
          {movieDetails.backdrop_path && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-10 blur-sm scale-110"
              style={{ backgroundImage: `url(/api/image?path=${encodeURIComponent(movieDetails.backdrop_path)}&size=w780)` }}
            />
          )}
          <div className="relative flex items-center gap-4 p-4">
            <Poster
              src={imgUrl(movieDetails.poster_path, 'w185')}
              alt={movieDetails.title}
              className="w-14 shrink-0 shadow-2xl"
              aspectRatio="2/3"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Now Renaming</p>
              <h2 className="font-semibold text-base leading-tight" style={{ color: 'var(--text-primary)' }}>{movieDetails.title}</h2>
              <div className="flex items-center gap-3 mt-1">
                {movieDetails.release_date && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{movieDetails.release_date.slice(0, 4)}</span>}
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">100% match</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Season artwork header */}
      {!isMovie && seasonDetails && (
        <div className="relative overflow-hidden border-b shrink-0" style={{ borderColor: 'var(--border)', minHeight: 96 }}>
          {seasonDetails.poster_path && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-10 blur-sm scale-110"
              style={{ backgroundImage: `url(/api/image?path=${encodeURIComponent(seasonDetails.poster_path)}&size=w342)` }}
            />
          )}
          <div className="relative flex items-center gap-4 p-4">
            <Poster
              src={imgUrl(seasonDetails.poster_path, 'w185')}
              alt={seasonDetails.name}
              className="w-14 shrink-0 shadow-2xl"
              aspectRatio="2/3"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Now Renaming</p>
              <h2 className="font-semibold text-base leading-tight" style={{ color: 'var(--text-primary)' }}>{seasonDetails.name}</h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{seasonDetails.episode_count} episodes on TMDB</span>
                {seasonDetails.air_date && seasonDetails.air_date !== 'N/A' && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{seasonDetails.air_date.slice(0, 4)}</span>
                )}
              </div>
            </div>
            {/* Match summary badges */}
            {episodes.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">{greenCount} ✓</span>
                {yellowCount > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">{yellowCount} ~</span>}
                {redCount > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">{redCount} ✗</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls — hidden in movie mode */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-wrap shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-800)' }}>
        {!isMovie && <button
          onClick={() => setMode(m => m === 'numeric' ? 'title' : 'numeric')}
          className="flex items-center gap-1.5 text-xs transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          {mode === 'numeric'
            ? <ToggleLeft size={16} style={{ color: 'var(--text-muted)' }} />
            : <ToggleRight size={16} style={{ color: 'var(--accent-400)' }} />}
          {mode === 'numeric' ? 'Numeric' : 'Title Match'}
        </button>}

        {!isMovie && <div className="w-px h-4" style={{ background: 'var(--bg-400)' }} />}

        {!isMovie && <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Pattern</span>
          <input
            value={customPattern}
            onChange={e => setCustomPattern(e.target.value)}
            className="w-14 rounded px-2 py-0.5 text-xs border focus:outline-none"
            style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)', color: 'var(--text-primary)' }}
          />
        </div>}

        {!isMovie && mode === 'numeric' && (
          <>
            <div className="w-px h-4" style={{ background: 'var(--bg-400)' }} />
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Offset</span>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setFOffset(n => n - 1)} style={{ color: 'var(--text-muted)' }} className="hover:text-white"><ChevronDown size={14} /></button>
                <span className="text-xs w-5 text-center" style={{ color: 'var(--text-primary)' }}>{fOffset}</span>
                <button onClick={() => setFOffset(n => n + 1)} style={{ color: 'var(--text-muted)' }} className="hover:text-white"><ChevronUp size={14} /></button>
              </div>
            </div>
          </>
        )}

        <div className="ml-auto">
          {loadingPreview && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-400)' }} />}
        </div>
      </div>

      {/* Episode table */}
      <div className="flex-1 overflow-y-auto">
        {loadingPreview && episodes.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
          </div>
        )}

        {!loadingPreview && episodes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: 'var(--text-muted)' }}>
            <AlertCircle size={24} />
            <span className="text-sm">No TMDB episodes found for this season</span>
          </div>
        )}

        {[...episodes].sort((a, b) => a.tmdb_num - b.tmdb_num).map((ep) => {
          const colors = scoreColor(ep.score, !!ep.old_file);
          return (
            <div
              key={ep.tmdb_num}
              className={`flex items-center gap-3 px-4 py-2 border-b transition-colors ${colors.row}`}
              style={{ borderBottomColor: 'var(--border)' }}
            >
              {/* Episode number */}
              <span className="text-xs w-6 text-right shrink-0" style={{ color: 'var(--text-muted)' }}>
                {String(ep.tmdb_num).padStart(2, '0')}
              </span>

              <div className="flex-1 min-w-0">
                {ep.old_file ? (
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={ep.old_file}>
                      {ep.old_file}
                    </p>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ArrowRight size={11} style={{ color: 'var(--accent-400)' }} className="shrink-0" />
                      <p className={`text-xs truncate font-medium ${colors.label}`} title={ep.new_file ?? ''}>
                        {ep.new_file}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      {ep.tmdb_title}
                    </p>
                    <span className="text-xs text-red-400 italic">— no local file</span>
                  </div>
                )}
              </div>

              {/* Score badge */}
              <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 font-mono ${colors.badge}`}>
                {ep.old_file ? `${ep.score}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-t shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-800)' }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {changedCount > 0
            ? <span style={{ color: 'var(--accent-400)' }}>{changedCount} file{changedCount !== 1 ? 's' : ''} will be renamed</span>
            : episodes.length > 0 ? 'No changes pending' : ''}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {canUndo && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'var(--bg-600)', color: 'var(--text-secondary)' }}
            >
              <Undo2 size={13} />
              Undo
            </button>
          )}
          <button
            onClick={() => {
              if (showSubtitles) {
                setSubtitlesVisible(true);
              } else {
                setShowSubtitles(true);
                setSubtitlesVisible(true);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: showSubtitles && !subtitlesVisible ? 'var(--accent-600)' : 'var(--bg-600)', color: showSubtitles && !subtitlesVisible ? '#fff' : 'var(--text-secondary)' }}
          >
            {showSubtitles && !subtitlesVisible
              ? <Loader2 size={13} className="animate-spin" />
              : <Captions size={13} />}
            Generate
          </button>
          <button
            onClick={() => setShowRemux(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: 'var(--bg-600)', color: 'var(--text-secondary)' }}
          >
            <Film size={13} />
            Remux
          </button>
          <button
            onClick={handleRename}
            disabled={loadingRename || changedCount === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs text-white font-medium transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent-600)' }}
          >
            {loadingRename ? <Loader2 size={13} className="animate-spin" /> : <FileEdit size={13} />}
            Rename {changedCount > 0 ? `${changedCount} Files` : 'Files'}
          </button>
        </div>
      </div>

      {showRemux && seasonPath && (
        <RemuxModal folderPath={seasonPath} onClose={() => setShowRemux(false)} />
      )}
      {showSubtitles && seasonPath && (
        <SubtitleModal
          folderPath={seasonPath}
          visible={subtitlesVisible}
          onClose={() => { setShowSubtitles(false); setSubtitlesVisible(false); }}
          onBackground={() => setSubtitlesVisible(false)}
          onComplete={(done, errors) => {
            setShowSubtitles(false);
            setSubtitlesVisible(false);
            toast.success(`Subtitles done — ${done} generated${errors ? `, ${errors} failed` : ''}`);
          }}
        />
      )}
    </div>
  );
}
