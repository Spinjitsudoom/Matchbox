import axios from 'axios';

const api = axios.create({ baseURL: 'http://127.0.0.1:8765/api' });

export interface LibraryEntry { name: string; path: string }
export interface SeasonFolder { name: string; path: string; file_count: number }
export interface SearchResult { title: string; id: number; year: string; poster_path: string | null }
export interface ShowDetails {
  name: string; first_air_date: string; vote_average: number | null;
  poster_path: string | null; overview: string; backdrop_path?: string | null;
}
export interface SeasonInfo {
  name: string; num: number; episode_count: number;
  air_date: string; poster_path: string | null;
}
export interface SeasonDetails {
  name: string; air_date: string; episode_count: number;
  overview: string; poster_path: string | null; season_number: number;
}
export interface Episode { name: string; num: number }
export interface RenamePair { old: string; new: string }
export interface Config { api_key: string; path: string; pattern: string; theme: string }

/** One row in the preview — always one per TMDB episode */
export interface EpisodeMatch {
  tmdb_num: number;
  tmdb_title: string;
  old_file: string | null;   // null = no local file found
  new_file: string | null;
  score: number;             // 0–100
  changed: boolean;
}

export const getConfig = () => api.get<Config>('/config').then(r => r.data);
export const saveConfig = (data: Partial<Config>) => api.post<Config>('/config', data).then(r => r.data);

export const getLibrary = () => api.get<LibraryEntry[]>('/library').then(r => r.data);
export const getSeasonFolders = (folder: string) =>
  api.get<SeasonFolder[]>('/library/seasons', { params: { folder } }).then(r => r.data);
export const getFiles = (folder: string) =>
  api.get<string[]>('/library/files', { params: { folder } }).then(r => r.data);

export const searchShows = (q: string) => api.get<SearchResult[]>('/search', { params: { q } }).then(r => r.data);
export const getShow = (id: number) =>
  api.get<{ details: ShowDetails; seasons: SeasonInfo[] }>(`/show/${id}`).then(r => r.data);
export const getSeason = (showId: number, seasonNum: number) =>
  api.get<{ details: SeasonDetails; episodes: Episode[] }>(`/show/${showId}/season/${seasonNum}`).then(r => r.data);

export interface MovieDetails {
  title: string; release_date: string; vote_average: number | null;
  poster_path: string | null; backdrop_path: string | null; overview: string;
}

export const searchMovies = (q: string) => api.get<SearchResult[]>('/search/movies', { params: { q } }).then(r => r.data);
export const getMovie = (id: number) => api.get<MovieDetails>(`/movie/${id}`).then(r => r.data);

export const previewRename = (payload: {
  season_path: string; mode?: string;
  show_id?: number; season_num?: number; f_start?: number; f_offset?: number; pattern?: string;
  movie_id?: number;
}) => api.post<{ episodes: EpisodeMatch[] }>('/preview', payload).then(r => r.data);

export const doRename = (season_path: string, pairs: RenamePair[]) =>
  api.post<{ renamed: string[]; errors: string[]; can_undo: boolean }>('/rename', { season_path, pairs }).then(r => r.data);

export const undoRename = () =>
  api.post<{ restored: string[]; errors: string[] }>('/undo').then(r => r.data);

export const checkFFmpeg = () =>
  api.get<{ available: boolean }>('/remux/check').then(r => r.data);

export const checkWhisper = () =>
  api.get<{ available: boolean; models: string[] }>('/whisper/check').then(r => r.data);

export const imgUrl = (path: string | null, size = 'w342') =>
  path ? `http://127.0.0.1:8765/api/image?path=${encodeURIComponent(path)}&size=${size}` : null;
