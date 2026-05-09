import os
import re
from functools import lru_cache
from tmdbv3api import TMDb, TV, Season, Movie
from thefuzz import process, fuzz

class TMDBEngine:
    def __init__(self, api_key):
        self.tmdb = TMDb()
        self.tmdb.api_key = api_key
        self.tmdb.language = 'en'
        self.tv = TV()
        self.season = Season()
        self.movie = Movie()
        # Simple in-memory caches — keyed by (show_id) or (show_id, season_num)
        self._show_cache: dict = {}
        self._season_cache: dict = {}

    def search_shows(self, query):
        try:
            results = self.tv.search(query)
            return [{"title": s.name, "id": s.id, "year": getattr(s, 'first_air_date', 'N/A')[:4], "poster_path": getattr(s, 'poster_path', None)} for s in results]
        except Exception:
            return []

    def get_show_full(self, show_id):
        """Returns (details, seasons) in one API call, cached."""
        if show_id in self._show_cache:
            return self._show_cache[show_id]
        try:
            d = self.tv.details(show_id)
            details = {
                "name": getattr(d, 'name', ''),
                "first_air_date": getattr(d, 'first_air_date', 'N/A'),
                "vote_average": getattr(d, 'vote_average', None),
                "poster_path": getattr(d, 'poster_path', None),
                "backdrop_path": getattr(d, 'backdrop_path', None),
                "overview": getattr(d, 'overview', ''),
            }
            seasons = []
            if hasattr(d, 'seasons'):
                for s in d.seasons:
                    seasons.append({
                        "name": s.name,
                        "num": s.season_number,
                        "episode_count": s.episode_count,
                        "air_date": getattr(s, 'air_date', 'N/A'),
                        "poster_path": getattr(s, 'poster_path', None),
                    })
        except Exception:
            details, seasons = {}, []
        self._show_cache[show_id] = (details, seasons)
        return details, seasons

    def get_season_full(self, show_id, season_num):
        """Returns (details, episodes) in one API call, cached."""
        key = (show_id, season_num)
        if key in self._season_cache:
            return self._season_cache[key]
        try:
            d = self.season.details(show_id, season_num)
            eps_raw = getattr(d, 'episodes', []) or []
            details = {
                "name": getattr(d, 'name', ''),
                "air_date": getattr(d, 'air_date', 'N/A'),
                "episode_count": len(eps_raw),
                "overview": getattr(d, 'overview', ''),
                "poster_path": getattr(d, 'poster_path', None),
                "season_number": getattr(d, 'season_number', season_num),
            }
            episodes = sorted(
                [{"name": ep.name, "num": ep.episode_number} for ep in eps_raw],
                key=lambda e: e["num"]
            )
        except Exception:
            details, episodes = {}, []
        self._season_cache[key] = (details, episodes)
        return details, episodes

    # Keep these for backward-compat with generate_preview / generate_title_match_preview
    def get_show_details(self, show_id):
        details, _ = self.get_show_full(show_id)
        return details

    def get_seasons(self, show_id):
        _, seasons = self.get_show_full(show_id)
        return seasons

    def get_season_details(self, show_id, season_num):
        details, _ = self.get_season_full(show_id, season_num)
        return details

    def get_episodes(self, show_id, season_num):
        _, episodes = self.get_season_full(show_id, season_num)
        return episodes

    def search_movies(self, query):
        try:
            results = self.movie.search(query)
            return [
                {
                    "title": getattr(r, "title", ""),
                    "id": r.id,
                    "year": getattr(r, "release_date", "")[:4],
                    "poster_path": getattr(r, "poster_path", None),
                }
                for r in list(results)
            ]
        except Exception:
            return []

    def get_movie_details(self, movie_id):
        try:
            d = self.movie.details(movie_id)
            return {
                "title": getattr(d, "title", ""),
                "release_date": getattr(d, "release_date", ""),
                "vote_average": getattr(d, "vote_average", None),
                "poster_path": getattr(d, "poster_path", None),
                "backdrop_path": getattr(d, "backdrop_path", None),
                "overview": getattr(d, "overview", ""),
            }
        except Exception:
            return {}

    def _sanitize_title(self, title):
        return "".join(c for c in title if c not in r'\/*?:"<>|').strip()

    def generate_preview(self, show_id, season_num, f_start, f_offset, pattern, season_path):
        try:
            episodes = self.get_episodes(show_id, season_num)
            files = sorted([f for f in os.listdir(season_path) if os.path.isfile(os.path.join(season_path, f))])
        except Exception as e:
            return [], f"Error: {str(e)}"

        ep_data, log = [], "NUMERIC MATCHING LOG:\n"
        for i, f in enumerate(files):
            meta_idx = i + f_offset
            if 0 <= meta_idx < len(episodes):
                ep_info = episodes[meta_idx]
                clean_title = self._sanitize_title(ep_info['name'])
                display_num = str(i + f_start).zfill(2)
                new_name = f"{display_num}{pattern}{clean_title}{os.path.splitext(f)[1]}"
                ep_data.append((f, new_name))
                log += f"MATCH: {f} -> {new_name}\n"
        return ep_data, log

    def generate_title_match_preview(self, show_id, season_num, f_offset, season_path):
        try:
            episodes = self.get_episodes(show_id, season_num)
            files = [f for f in os.listdir(season_path) if os.path.isfile(os.path.join(season_path, f))]
            f_start = 1
        except Exception as e:
            return [], f"Error: {str(e)}"

        tmdb_map = {ep['name']: ep for ep in episodes}
        tmdb_titles = list(tmdb_map.keys())
        temp_matches = []
        log = "TITLE MATCHING LOG (Fuzzy Logic):\n"

        for f in files:
            fn_base = os.path.splitext(f)[0].replace(".", " ").replace("_", " ")
            fn_base = re.sub(r'(1080p|720p|x264|x265|HEVC|WEB-DL|BluRay)', '', fn_base, flags=re.I)
            match_result = process.extractOne(fn_base, tmdb_titles, scorer=fuzz.token_set_ratio)
            if match_result and match_result[1] > 55:
                matched_title, score = match_result
                matched_ep = tmdb_map[matched_title]
                temp_matches.append({"old_name": f, "tmdb_ep_num": matched_ep['num'], "title": matched_ep['name'], "score": score})
            else:
                log += f"FAILED: {f} (No match found)\n\n"

        temp_matches.sort(key=lambda x: x['tmdb_ep_num'])
        ep_data = []
        for i, match in enumerate(temp_matches):
            clean_title = self._sanitize_title(match['title'])
            ext = os.path.splitext(match['old_name'])[1]
            display_num = str(i + f_start + f_offset).zfill(2)
            new_name = f"{display_num} - {clean_title}{ext}"
            ep_data.append((match['old_name'], new_name))
            log += f"[{match['score']}%] {match['old_name']} \n      -> {new_name}\n\n"

        if not ep_data:
            log = "No title matches found."
        return ep_data, log
