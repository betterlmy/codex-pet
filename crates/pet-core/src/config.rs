use std::fs;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;

use crate::BehaviorMode;
use crate::DEFAULT_PET_ID;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub selected_pet: String,
    pub behavior_mode: BehaviorMode,
    pub paused: bool,
    pub pet_enabled: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            selected_pet: DEFAULT_PET_ID.to_string(),
            behavior_mode: BehaviorMode::Automatic,
            paused: false,
            pet_enabled: true,
        }
    }
}

impl RuntimeConfig {
    pub fn load(home: &Path) -> Result<Self> {
        let path = home.join("config.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path).with_context(|| format!("读取 {}", path.display()))?;
        serde_json::from_str(&raw).with_context(|| format!("解析 {}", path.display()))
    }

    pub fn save(&self, home: &Path) -> Result<()> {
        fs::create_dir_all(home).with_context(|| format!("创建 {}", home.display()))?;
        let path = home.join("config.json");
        let temporary = home.join("config.json.tmp");
        let raw = serde_json::to_vec_pretty(self).context("序列化配置")?;
        fs::write(&temporary, raw).with_context(|| format!("写入 {}", temporary.display()))?;
        if path.exists() {
            fs::remove_file(&path).with_context(|| format!("替换 {}", path.display()))?;
        }
        fs::rename(&temporary, &path).with_context(|| format!("安装 {}", path.display()))
    }
}

pub fn app_home() -> Result<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_PET_HOME") {
        return Ok(PathBuf::from(home));
    }

    if cfg!(windows) {
        let local_app_data = std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA 未设置")?;
        return Ok(PathBuf::from(local_app_data).join("codex-pet"));
    }

    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(data_home).join("codex-pet"));
    }

    let home = std::env::var_os("HOME").context("HOME 未设置")?;
    Ok(PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("codex-pet"))
}
