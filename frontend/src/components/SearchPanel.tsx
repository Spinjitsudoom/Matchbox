import { useState, useRef, useEffect } from 'react';
import { Search, Calendar, Loader2 } from 'lucide-react';
import { searchShows, searchMovies, getShow, getMovie, imgUrl } from '../api/client';
import type { SearchResult, ShowDetails, SeasonInfo, MovieDetails } from '../api/client';

import { Poster } from './Poster';

interface Props {
  mediaType: 'tv' | 'movie';
  onSelectShow: (id: number, details: ShowDetails, seasons: SeasonInfo[]) => void;
  onSelectMovie: (id: number, details: MovieDetails) => void;
  autoQuery?: string;
}

function normalizeTitle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function SearchPanel({ mediaType, onSelectShow, onSelectMovie, autoQuery }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (q: string, type = mediaType) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const fn = type === 'movie' ? searchMovies : searchShows;
    fn(q).then(setResults).catch(() => setResults([])).finally(() => setLoading(false));
  };

  // Clear results when mode changes
  useEffect(() => {
    setResults([]);
    setSelectedId(null);
    setQuery('');
  }, [mediaType]);

  // Debounced search on manual query change
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(query), 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-search when parent fires a name (TV mode)
  useEffect(() => {
    if (!autoQuery || mediaType !== 'tv') return;
    setSelectedId(null);
    setQuery(autoQuery);
    searchShows(autoQuery).then(async found => {
      setResults(found);
      if (found.length === 0) return;
      const normQ = normalizeTitle(autoQuery);
      const normF = normalizeTitle(found[0].title);
      if (normF === normQ || normF.startsWith(normQ) || normQ.startsWith(normF)) {
        setSelectedId(found[0].id);
        const data = await getShow(found[0].id).catch(() => null);
        if (data) onSelectShow(found[0].id, data.details, data.seasons);
      }
    }).catch(() => {});
  }, [autoQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-search when parent fires a name (Movie mode)
  useEffect(() => {
    if (!autoQuery || mediaType !== 'movie') return;
    setSelectedId(null);
    setQuery(autoQuery);
    searchMovies(autoQuery).then(async found => {
      setResults(found);
      if (found.length === 0) return;
      const normQ = normalizeTitle(autoQuery);
      const normF = normalizeTitle(found[0].title);
      if (normF === normQ || normF.startsWith(normQ) || normQ.startsWith(normF)) {
        setSelectedId(found[0].id);
        const data = await getMovie(found[0].id).catch(() => null);
        if (data) onSelectMovie(found[0].id, data);
      }
    }).catch(() => {});
  }, [autoQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = async (r: SearchResult) => {
    setSelectedId(r.id);
    if (mediaType === 'movie') {
      const data = await getMovie(r.id).catch(() => null);
      if (data) onSelectMovie(r.id, data);
    } else {
      const data = await getShow(r.id).catch(() => null);
      if (data) onSelectShow(r.id, data.details, data.seasons);
    }
  };

  const placeholder = mediaType === 'movie' ? 'Search movies…' : 'Search TV shows…';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
          {mediaType === 'movie' ? 'Movie Search' : 'TV Show Search'}
        </span>
      </div>

      <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors"
          style={{ background: 'var(--bg-700)', borderColor: 'var(--bg-400)' }}>
          {loading
            ? <Loader2 size={14} className="shrink-0 animate-spin" style={{ color: 'var(--accent-400)' }} />
            : <Search size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
          }
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {results.map(r => (
          <button
            key={r.id}
            onClick={() => select(r)}
            className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left"
            style={{
              background: selectedId === r.id
                ? 'color-mix(in srgb, var(--accent-600) 15%, transparent)'
                : 'transparent',
              borderRight: selectedId === r.id ? '2px solid var(--accent-500)' : '2px solid transparent',
            }}
            onMouseEnter={e => { if (selectedId !== r.id) (e.currentTarget as HTMLElement).style.background = 'var(--bg-700)'; }}
            onMouseLeave={e => { if (selectedId !== r.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Poster src={imgUrl(r.poster_path, 'w92')} alt={r.title} className="w-9 h-14 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate font-medium"
                style={{ color: selectedId === r.id ? 'var(--accent-400)' : 'var(--text-primary)' }}>
                {r.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <Calendar size={10} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.year || '—'}</span>
              </div>
            </div>
            {selectedId === r.id && (
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent-400)' }} />
            )}
          </button>
        ))}

        {!loading && query && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 text-xs gap-1" style={{ color: 'var(--text-muted)' }}>
            <Search size={20} />
            <span>No results</span>
          </div>
        )}
      </div>
    </div>
  );
}
