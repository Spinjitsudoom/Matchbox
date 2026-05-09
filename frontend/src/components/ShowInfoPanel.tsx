import { Star, Calendar, Layers } from 'lucide-react';
import { imgUrl } from '../api/client';
import type { ShowDetails, SeasonInfo } from '../api/client';
import { Poster } from './Poster';

interface Props {
  showDetails: ShowDetails | null;
  seasons: SeasonInfo[];
  selectedSeason: number | null;
  onSelectSeason: (num: number) => void;
}

export function ShowInfoPanel({ showDetails, seasons, selectedSeason, onSelectSeason }: Props) {
  if (!showDetails) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 px-4">
        <Layers size={32} />
        <p className="text-sm text-center">Search for a show and select it to see details</p>
      </div>
    );
  }

  const currentSeason = seasons.find(s => s.num === selectedSeason);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Show poster + info */}
      <div className="p-4">
        <div className="flex gap-3">
          <Poster
            src={imgUrl(showDetails.poster_path, 'w185')}
            alt={showDetails.name}
            className="w-20 shrink-0"
            aspectRatio="2/3"
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white leading-tight">{showDetails.name}</h3>
            <div className="flex items-center gap-1.5 mt-1">
              <Calendar size={11} className="text-slate-500" />
              <span className="text-xs text-slate-500">{showDetails.first_air_date?.slice(0, 4) || '—'}</span>
            </div>
            {showDetails.vote_average != null && (
              <div className="flex items-center gap-1 mt-1">
                <Star size={11} className="text-yellow-400 fill-yellow-400" />
                <span className="text-xs text-yellow-400 font-medium">
                  {showDetails.vote_average.toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>

        {showDetails.overview && (
          <p className="mt-3 text-xs text-slate-400 leading-relaxed line-clamp-4">
            {showDetails.overview}
          </p>
        )}
      </div>

      {/* Season artwork highlight */}
      {currentSeason && (
        <div className="px-4 pb-3">
          <div className="relative rounded-xl overflow-hidden">
            <Poster
              src={imgUrl(currentSeason.poster_path, 'w342')}
              alt={currentSeason.name}
              className="w-full"
              aspectRatio="2/3"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3">
              <p className="text-white font-semibold text-sm">{currentSeason.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-300">{currentSeason.episode_count} episodes</span>
                {currentSeason.air_date && currentSeason.air_date !== 'N/A' && (
                  <span className="text-xs text-slate-400">{currentSeason.air_date.slice(0, 4)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Season list */}
      <div className="border-t border-surface-600">
        <p className="px-4 py-2 text-xs font-semibold tracking-widest text-slate-500 uppercase">Seasons</p>
        <div className="pb-2">
          {seasons.filter(s => s.num > 0).map(s => (
            <button
              key={s.num}
              onClick={() => onSelectSeason(s.num)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-700 transition-colors group ${
                selectedSeason === s.num ? 'bg-brand-600/20' : ''
              }`}
            >
              <Poster
                src={imgUrl(s.poster_path, 'w92')}
                alt={s.name}
                className="w-8 shrink-0"
                aspectRatio="2/3"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate transition-colors ${
                  selectedSeason === s.num ? 'text-brand-400' : 'text-slate-300 group-hover:text-white'
                }`}>
                  {s.name}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {s.episode_count} eps · {s.air_date?.slice(0, 4) || '—'}
                </p>
              </div>
              {selectedSeason === s.num && (
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
