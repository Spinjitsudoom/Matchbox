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
export interface CustomTheme { name: string; bg: string; accent: string }

export interface Config {
  api_key: string; path: string; pattern: string; theme: string;
  whisper_model: string; whisper_language: string; whisper_beam_size: number; whisper_vad: boolean;
  custom_themes: CustomTheme[];
  tv_template: string;
  movie_template: string;
  tv_path: string;
  movie_path: string;
}

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

export const getLibrary = (path?: string) =>
  api.get<LibraryEntry[]>('/library', path ? { params: { path } } : {}).then(r => r.data);
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
  movie_id?: number; file_filter?: string;
}) => api.post<{ episodes: EpisodeMatch[] }>('/preview', payload).then(r => r.data);

export const doRename = (season_path: string, pairs: RenamePair[]) =>
  api.post<{ renamed: string[]; errors: string[]; can_undo: boolean }>('/rename', { season_path, pairs }).then(r => r.data);

export interface UndoPair { current: string; original: string }
export const getUndoPreview = () =>
  api.get<{ pairs: UndoPair[] }>('/undo/preview').then(r => r.data);

export const undoRename = () =>
  api.post<{ restored: string[]; errors: string[] }>('/undo').then(r => r.data);

export const checkFFmpeg = () =>
  api.get<{ available: boolean }>('/remux/check').then(r => r.data);

export interface AudioTrackInfo {
  position: number;
  stream_index: number | null;
  language: string | null;
  title: string | null;
}

export interface FileAudioTracks {
  file: string;
  tracks: AudioTrackInfo[];
  subtitle_tracks: AudioTrackInfo[];
}

export const getAudioTracks = (folderPath: string, files: string[]) =>
  api.post<{ files: FileAudioTracks[]; max_audio_tracks: number; max_subtitle_tracks: number }>('/remux/audio-tracks', {
    folder_path: folderPath,
    files,
  }).then(r => r.data);

export const checkWhisper = () =>
  api.get<{ available: boolean; models: string[] }>('/whisper/check').then(r => r.data);

export interface Preset {
  id: string;
  name: string;
  type: 'remux' | 'subtitles';
  settings: Record<string, unknown>;
}

export const getPresets = (type: 'remux' | 'subtitles') =>
  api.get<Preset[]>('/presets', { params: { type } }).then(r => r.data);

export const savePreset = (name: string, type: 'remux' | 'subtitles', settings: Record<string, unknown>) =>
  api.post<Preset[]>('/presets', { name, type, settings }).then(r => r.data);

export const deletePreset = (id: string) =>
  api.delete<Preset[]>(`/presets/${id}`).then(r => r.data);

export const imgUrl = (path: string | null, size = 'w342') =>
  path ? `http://127.0.0.1:8765/api/image?path=${encodeURIComponent(path)}&size=${size}` : null;

// Match history
export interface MatchHistory { type: 'tv' | 'movie'; id: number; name: string; season_num?: number }
export const getMatchHistory = (folder: string) =>
  api.get<MatchHistory>('/match-history', { params: { folder } }).then(r => r.data);
export const saveMatchHistory = (body: { folder_path: string; type: string; id: number; name: string; season_num?: number }) =>
  api.post('/match-history', body).then(r => r.data);
export const deleteMatchHistory = (folder: string) =>
  api.delete('/match-history', { params: { folder } }).then(r => r.data);

// FFmpeg validation
export interface FileValidation {
  file: string; error?: string; container?: string;
  duration?: number; size?: number;
  video?: Array<{ position: number; codec: string | null; language: string | null; title: string | null }>;
  audio?: Array<{ position: number; codec: string | null; language: string | null; title: string | null }>;
  subtitles?: Array<{ position: number; codec: string | null; language: string | null; title: string | null }>;
  warnings?: string[];
}
export const validateFiles = (folderPath: string, files: string[]) =>
  api.post<{ files: FileValidation[] }>('/remux/validate', { folder_path: folderPath, files }).then(r => r.data);

// Updates & config import/export
export const checkUpdates = () =>
  api.get<{ latest_tag: string | null; url: string | null; name: string | null }>('/updates/check').then(r => r.data);
export const importConfig = (data: Record<string, unknown>) =>
  api.post<Config>('/config/import', { data }).then(r => r.data);

// Organizer
export interface OrganizeMove {
  source: string; dest: string; source_full: string; dest_full: string;
  folder: string; changed: boolean;
}
export const organizeApply = (moves: OrganizeMove[]) =>
  api.post<{ moved: number; errors: string[] }>('/organize/apply', { moves }).then(r => r.data);

export interface OrganizeHistoryMove { source: string; dest: string }
export const getOrganizeUndoPreview = () =>
  api.get<{ moves: OrganizeHistoryMove[] }>('/organize/undo/preview').then(r => r.data);
export const organizeUndo = () =>
  api.post<{ restored: number; errors: string[] }>('/organize/undo').then(r => r.data);
