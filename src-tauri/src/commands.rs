use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClipMeta {
    pub file_name: String,
    pub path: String,
    pub station_name: String,
    pub duration_sec: f32,
    pub created_at: i64,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipMetaJs {
    pub file_name: String,
    pub path: String,
    pub station_name: String,
    pub duration_sec: f32,
    pub created_at: i64,
    pub size_bytes: u64,
}

impl From<ClipMeta> for ClipMetaJs {
    fn from(m: ClipMeta) -> Self {
        ClipMetaJs {
            file_name: m.file_name,
            path: m.path,
            station_name: m.station_name,
            duration_sec: m.duration_sec,
            created_at: m.created_at,
            size_bytes: m.size_bytes,
        }
    }
}

#[tauri::command]
pub fn get_proxy_port(state: State<'_, Arc<AppState>>) -> u16 {
    state.proxy_port
}

#[tauri::command]
pub fn default_clips_dir() -> Result<String, String> {
    let dir = dirs::audio_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "no audio/home dir".to_string())?
        .join("RadioSampler");
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_clips_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a folder for your clips")
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    let chosen = rx.await.map_err(|e| e.to_string())?;
    Ok(chosen.and_then(|p| p.into_path().ok().map(|pb| pb.to_string_lossy().to_string())))
}

#[derive(Deserialize)]
pub struct SaveClipArgs {
    pub dir: String,
    #[serde(rename = "stationName")]
    pub station_name: String,
    #[serde(rename = "trackTitle", default)]
    pub track_title: String,
    #[serde(rename = "durationSec")]
    pub duration_sec: f32,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn save_clip(args: SaveClipArgs) -> Result<ClipMetaJs, String> {
    let dir = PathBuf::from(&args.dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let safe_station = sanitize(&args.station_name);
    let file_name = if args.track_title.trim().is_empty() {
        format!("{ts}__{safe_station}__{:.0}s.wav", args.duration_sec)
    } else {
        let safe_track = sanitize(&args.track_title);
        format!(
            "{ts}__{safe_station}__{safe_track}__{:.0}s.wav",
            args.duration_sec
        )
    };
    let path = dir.join(&file_name);
    std::fs::write(&path, &args.bytes).map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(ClipMeta {
        file_name,
        path: path.to_string_lossy().to_string(),
        station_name: args.station_name,
        duration_sec: args.duration_sec,
        created_at: chrono::Local::now().timestamp_millis(),
        size_bytes: size,
    }
    .into())
}

#[tauri::command]
pub fn count_clips(dir: String) -> Result<usize, String> {
    let p = Path::new(&dir);
    if !p.exists() {
        return Ok(0);
    }
    let n = std::fs::read_dir(p)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s == "wav")
                .unwrap_or(false)
        })
        .count();
    Ok(n)
}

#[tauri::command]
pub fn list_clips(dir: String) -> Result<Vec<ClipMetaJs>, String> {
    let p = Path::new(&dir);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<ClipMetaJs> = Vec::new();
    for entry in std::fs::read_dir(p).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("wav") {
            continue;
        }
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let size = meta.len();
        let created = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let (station_name, duration_sec) = parse_meta_from_filename(&file_name);
        out.push(ClipMetaJs {
            file_name,
            path: path.to_string_lossy().to_string(),
            station_name,
            duration_sec,
            created_at: created,
            size_bytes: size,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub fn delete_clip(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_clip_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let parent = p.parent().ok_or_else(|| "no parent dir".to_string())?;
    open_path(parent.to_str().unwrap_or("."))
}

fn open_path(p: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(p).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(p).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(p).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c == ' ' {
                '-'
            } else {
                '_'
            }
        })
        .collect();
    cleaned.trim_matches('-').chars().take(60).collect()
}

fn parse_meta_from_filename(name: &str) -> (String, f32) {
    // expected: YYYY-MM-DD_HH-MM-SS__<station>[__<track>]__<N>s.wav
    let stem = name.strip_suffix(".wav").unwrap_or(name);
    let parts: Vec<&str> = stem.split("__").collect();
    if parts.len() >= 3 {
        let dur_str = parts[parts.len() - 1].trim_end_matches('s');
        let dur: f32 = dur_str.parse().unwrap_or(0.0);
        let station = parts[1].replace('-', " ");
        let display = if parts.len() >= 4 {
            let track = parts[2..parts.len() - 1].join("__").replace('-', " ");
            format!("{station} — {track}")
        } else {
            station
        };
        return (display, dur);
    }
    (stem.to_string(), 0.0)
}
