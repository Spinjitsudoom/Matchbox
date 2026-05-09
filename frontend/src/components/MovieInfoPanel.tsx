import { Star, Calendar, Clapperboard } from 'lucide-react';
import { imgUrl } from '../api/client';
import type { MovieDetails } from '../api/client';
import { Poster } from './Poster';

interface Props {
  movie: MovieDetails | null;
}

export function MovieInfoPanel({ movie }: Props) {
  if (!movie) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4" style={{ color: 'var(--text-muted)' }}>
        <Clapperboard size={32} />
        <p className="text-sm text-center">Search for a movie and select it</p>
      </div>
    );
  }

  const year = movie.release_date?.slice(0, 4);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Backdrop + poster */}
      <div className="relative">
        {movie.backdrop_path ? (
          <div
            className="w-full h-24 bg-cover bg-center"
            style={{ backgroundImage: `url(/api/image?path=${encodeURIComponent(movie.backdrop_path)}&size=w780)` }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--bg-800)]" />
          </div>
        ) : (
          <div className="h-8" />
        )}
        <div className="relative px-4 pb-3" style={{ marginTop: movie.backdrop_path ? -40 : 0 }}>
          <div className="flex gap-3 items-end">
            <Poster
              src={imgUrl(movie.poster_path, 'w185')}
              alt={movie.title}
              className="w-16 shrink-0 shadow-2xl"
              aspectRatio="2/3"
            />
            <div className="pb-1 min-w-0">
              <h3 className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                {movie.title}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {year && (
                  <div className="flex items-center gap-1">
                    <Calendar size={11} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{year}</span>
                  </div>
                )}
                {movie.vote_average != null && movie.vote_average > 0 && (
                  <div className="flex items-center gap-1">
                    <Star size={11} className="text-yellow-400 fill-yellow-400" />
                    <span className="text-xs text-yellow-400 font-medium">
                      {movie.vote_average.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Overview */}
      {movie.overview && (
        <div className="px-4 pb-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {movie.overview}
          </p>
        </div>
      )}

      {/* Rename preview hint */}
      <div className="mt-auto px-4 py-3 border-t mx-4 mb-4 rounded-lg" style={{ borderColor: 'var(--border)', background: 'var(--bg-700)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Will rename to</p>
        <p className="text-xs font-mono" style={{ color: 'var(--accent-400)' }}>
          {movie.title}{year ? ` - ${year}` : ''}.ext
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Multiple files → Part 01, Part 02…
        </p>
      </div>
    </div>
  );
}
