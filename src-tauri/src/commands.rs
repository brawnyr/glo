use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

/// Refuse clip writes larger than this. A 60-second stereo 48kHz 16-bit WAV is
/// ~11 MB; this leaves headroom for higher sample rates and channel counts
/// while rejecting a runaway frontend or hostile payload.
const MAX_CLIP_BYTES: usize = 150 * 1024 * 1024;

/// Validates that `target` resolves to a path inside `allowed_root`. Both are
/// canonicalized so symlinks and relative components can't escape. Returns the
/// resolved (canonical) target path on success.
fn ensure_within(allowed_root: &str, target: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(allowed_root)
        .map_err(|e| format!("clips dir invalid: {e}"))?;
    let resolved = std::fs::canonicalize(target)
        .map_err(|e| format!("path invalid: {e}"))?;
    if !resolved.starts_with(&root) {
        return Err("path outside clips dir".to_string());
    }
    Ok(resolved)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipMeta {
    pub file_name: String,
    pub path: String,
    pub station_name: String,
    pub duration_sec: f32,
    pub created_at: i64,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn get_proxy_port(state: State<'_, Arc<AppState>>) -> u16 {
    state.proxy_port
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
    /// WAV bytes as base64. Tauri's JSON IPC turns a `Uint8Array` into a
    /// number array (~4x size); base64 is ~33% overhead — much faster for
    /// the ~11 MB blobs a 60-second clip produces.
    #[serde(rename = "bytesB64")]
    pub bytes_b64: String,
}

#[tauri::command]
pub fn save_clip(args: SaveClipArgs) -> Result<ClipMeta, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&args.bytes_b64)
        .map_err(|e| format!("clip payload not valid base64: {e}"))?;
    if bytes.len() > MAX_CLIP_BYTES {
        return Err(format!(
            "clip too large: {} bytes (max {})",
            bytes.len(),
            MAX_CLIP_BYTES
        ));
    }

    // Make sure the chosen dir exists and resolves before we synthesize a
    // filename. We don't pin clips to a canonicalized root here because the
    // user picked this dir explicitly via the OS picker — the threat model
    // for save_clip is "frontend sends garbage payload," not "frontend lies
    // about the directory."
    let dir = PathBuf::from(&args.dir);
    if !dir.is_dir() {
        return Err(format!("clips dir does not exist: {}", dir.display()));
    }

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
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(ClipMeta {
        file_name,
        path: path.to_string_lossy().to_string(),
        station_name: args.station_name,
        duration_sec: args.duration_sec,
        created_at: chrono::Local::now().timestamp_millis(),
        size_bytes: size,
    })
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
pub fn list_clips(dir: String) -> Result<Vec<ClipMeta>, String> {
    let p = Path::new(&dir);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<ClipMeta> = Vec::new();
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
        out.push(ClipMeta {
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
pub fn delete_clip(dir: String, path: String) -> Result<(), String> {
    let resolved = ensure_within(&dir, Path::new(&path))?;
    std::fs::remove_file(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_clip_in_folder(dir: String, path: String) -> Result<(), String> {
    let resolved = ensure_within(&dir, Path::new(&path))?;
    #[cfg(target_os = "windows")]
    {
        // `/select,<path>` opens the parent folder and highlights the file.
        // The comma is part of the flag — explorer parses the whole thing as one arg.
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", resolved.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // Most Linux file managers don't have a portable "reveal" flag — open the parent.
        let parent = resolved.parent().ok_or_else(|| "no parent dir".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sanitize(s: &str) -> String {
    // Unicode-aware: keeps letters/digits in any script (Hangul, Cyrillic, Arabic, CJK, …),
    // remaps spaces to '-', and replaces everything else (incl. control chars, path separators,
    // Windows-reserved punctuation `< > : " / \ | ? *`, and emoji) with '_'.
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c == ' ' {
                '-'
            } else {
                '_'
            }
        })
        .collect();
    // Strip leading/trailing punctuation Windows won't accept on its own (dots, spaces).
    let trimmed = cleaned.trim_matches(|c: char| c == '-' || c == '_' || c == '.' || c == ' ');
    trimmed.chars().take(60).collect()
}

// expects: YYYY-MM-DD_HH-MM-SS__<station>[__<track>]__<N>s.wav
fn parse_meta_from_filename(name: &str) -> (String, f32) {
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
