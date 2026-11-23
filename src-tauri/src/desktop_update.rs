/** Portable executables cannot replace themselves while running. Open the verified release
 * in the system browser, where the player can download it and replace the EXE after exit.
 */
fn valid_release_tag(tag: &str) -> bool {
    let Some((run, attempt)) = tag.strip_prefix("android-build-").and_then(|value| value.split_once('-')) else {
        return false;
    };
    !run.is_empty() && run.len() <= 12 && run.bytes().all(|b| b.is_ascii_digit()) &&
        !attempt.is_empty() && attempt.len() <= 12 && attempt.bytes().all(|b| b.is_ascii_digit())
}

#[tauri::command]
pub fn desktop_download_update(tag: String) -> Result<(), String> {
    if !valid_release_tag(&tag) {
        return Err("Invalid TrackForge release identifier".to_owned());
    }
    let url = format!(
        "https://github.com/Unschoolers/track-forge/releases/download/{tag}/TrackForge.exe"
    );
    std::process::Command::new("explorer.exe")
        .arg(url)
        .spawn()
        .map_err(|error| format!("Could not open the Windows browser: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_release_tag;

    #[test]
    fn accepts_only_official_numeric_release_identifiers() {
        assert!(valid_release_tag("android-build-1437-1"));
        for tag in ["android-build-1", "v2.0", "android-build-1-2/evil",
            "android-build-1-2;foo", "android-build--1", "android-build-1-%20",
            "android-build-111111111111111-1"] {
            assert!(!valid_release_tag(tag), "{tag}");
        }
    }
}
