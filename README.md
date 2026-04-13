# 📺 Media Manager Ultimate v1.9.6
**Automated TV Show Renaming for Plex, Jellyfin, and Emby**

Media Manager Ultimate is a Python-based GUI utility that organizes your media library by syncing your local files with **The Movie Database (TMDb)**. It ensures your shows are named perfectly so that media servers like Plex and Jellyfin can fetch metadata, posters, and episode summaries without errors.

---

## ✨ Key Features
* **Fuzzy Title Matching:** Automatically pairs messy filenames with official episode titles using string similarity scoring.
* **Sequential Numeric Matching:** Quickly renames files based on their directory order—perfect for new season rips.
* **TMDb Integration:** Pulls real-time data from the official TMDb API.
* **Dynamic Theme Engine:** Supports 9 visual styles (Slate, Emerald, Midnight, etc.) with a zero-glare dark mode.
* **Safety First:** Interactive "Preview" mode lets you see exactly what will happen before a single file is renamed.

---

## 🚀 How to Run

### 📂 Option A: Running from a ZIP Download
1.  **Extract the ZIP:** Right-click the downloaded file and select **Extract All**.
2.  **Open Terminal:** Open the folder, right-click in the empty space, and select **Open in Terminal** (or type `cmd` in the address bar on Windows).
3.  **Install Dependencies:** Run the following command:
    ```bash
    pip install -r requirements.txt
    ```
4.  **Launch the App:**
    ```bash
    python media_dashboard.py
    ```

### 💻 Option B: Cloning the Repository
```bash
git clone [https://github.com/yourusername/media-manager-ultimate.git](https://github.com/yourusername/media-manager-ultimate.git)
cd media-manager-ultimate
pip install -r requirements.txt
python media_dashboard.py
````

-----

## 📋 Requirements

The following Python libraries are required to run the application. Ensure your `requirements.txt` file contains:

```text
tmdbv3api==1.7.7
thefuzz==0.20.0
python-Levenshtein==0.23.0
```

> **Note for Linux Users:** If the app fails to open, you may need to install the Tkinter system package:
> `sudo apt install python3-tk` (Ubuntu/Debian) or `sudo dnf install python3-tkinter` (Fedora/Bazzite).

-----

## ⚙️ First-Time Setup

1. **Directory:** Select your media folder, choose your preferred theme, and you're ready to organize\!

-----

## 🛠 Project Structure

  * `media_dashboard.py`: The main GUI and user interface controller.
  * `tmdb_engine.py`: The core logic for API communication and fuzzy matching.
  * `themes.py`: The styling engine for recursive UI painting.
  * `settings_manager.py`: Handles configuration persistence and the settings window.

<!-- end list -->  
