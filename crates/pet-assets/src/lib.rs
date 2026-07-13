//! Asset acquisition, local pet discovery, and spritesheet frame preparation.

mod frames;

use std::fs;
use std::io::Read as _;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use pet_core::BUILTIN_PETS;
use pet_core::BuiltinPet;
use pet_core::Pet;
use pet_core::SPRITESHEET_HEIGHT;
use pet_core::SPRITESHEET_WIDTH;
use pet_core::builtin_pet;
use pet_core::custom_pet_selector;
use serde::Serialize;

pub use frames::prepare_png_frames;

const PACK_VERSION: &str = "v1";
const CDN_BASE_URL: &str = "https://persistent.oaistatic.com/codex/pets/v1";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DOWNLOAD_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSummary {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub builtin: bool,
}

#[derive(Debug, Clone)]
pub struct AssetStore {
    home: PathBuf,
}

impl AssetStore {
    #[must_use]
    pub fn new(home: PathBuf) -> Self {
        Self { home }
    }

    #[must_use]
    pub fn home(&self) -> &Path {
        &self.home
    }

    pub fn load_pet(&self, selector: &str) -> Result<Pet> {
        if let Some(definition) = builtin_pet(selector) {
            self.ensure_builtin(definition)?;
            return Pet::from_builtin(definition, self.builtin_spritesheet_path(definition));
        }
        Pet::load_custom(selector, &self.home)
    }

    pub fn ensure_builtin(&self, pet: BuiltinPet) -> Result<PathBuf> {
        let destination = self.builtin_spritesheet_path(pet);
        if validate_builtin_spritesheet(&destination).is_ok() {
            return Ok(destination);
        }

        let bytes = download_with_limit(&builtin_url(pet), MAX_DOWNLOAD_BYTES)?;
        let parent = destination.parent().context("内置资源路径没有父目录")?;
        fs::create_dir_all(parent).with_context(|| format!("创建 {}", parent.display()))?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let staging = parent.join(format!(".{}.download-{nonce}.webp", pet.spritesheet_file));
        fs::write(&staging, bytes).with_context(|| format!("写入 {}", staging.display()))?;
        if let Err(error) = validate_builtin_spritesheet(&staging) {
            let _ = fs::remove_file(&staging);
            return Err(error).with_context(|| format!("下载的宠物资源无效：{}", pet.id));
        }
        if destination.exists() {
            fs::remove_file(&destination)
                .with_context(|| format!("替换 {}", destination.display()))?;
        }
        fs::rename(&staging, &destination)
            .with_context(|| format!("安装 {}", destination.display()))?;
        Ok(destination)
    }

    #[must_use]
    pub fn builtin_spritesheet_path(&self, pet: BuiltinPet) -> PathBuf {
        self.home
            .join("cache")
            .join("pet-assets")
            .join(PACK_VERSION)
            .join(pet.spritesheet_file)
    }

    pub fn frame_cache_dir(&self, pet: &Pet) -> Result<PathBuf> {
        Ok(self
            .home
            .join("cache")
            .join("frames")
            .join(&pet.id)
            .join(pet.frame_cache_key()?))
    }

    pub fn available_pets(&self) -> Vec<PetSummary> {
        let mut pets = BUILTIN_PETS
            .iter()
            .map(|pet| PetSummary {
                id: pet.id.to_string(),
                display_name: pet.display_name.to_string(),
                description: pet.description.to_string(),
                builtin: true,
            })
            .collect::<Vec<_>>();

        let directory = self.home.join("pets");
        if let Ok(children) = fs::read_dir(directory) {
            for child in children.flatten() {
                let Some(id) = child.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                let selector = custom_pet_selector(&id);
                let Ok(pet) = Pet::load_custom(&selector, &self.home) else {
                    continue;
                };
                pets.push(PetSummary {
                    id: selector,
                    display_name: pet.display_name,
                    description: pet.description,
                    builtin: false,
                });
            }
        }
        pets.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        pets
    }
}

fn builtin_url(pet: BuiltinPet) -> String {
    format!("{CDN_BASE_URL}/{}", pet.spritesheet_file)
}

fn download_with_limit(url: &str, max_bytes: u64) -> Result<Vec<u8>> {
    if !url.starts_with("https://persistent.oaistatic.com/") {
        bail!("拒绝非官方 HTTPS 宠物资源地址");
    }
    let mut response = reqwest::blocking::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .context("创建宠物资源下载客户端")?
        .get(url)
        .send()
        .with_context(|| format!("下载宠物资源 {url}"))?
        .error_for_status()
        .with_context(|| format!("下载宠物资源 {url}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        bail!("宠物资源超过 {max_bytes} 字节限制");
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .context("读取宠物资源响应")?;
    if bytes.len() as u64 > max_bytes {
        bail!("宠物资源超过 {max_bytes} 字节限制");
    }
    Ok(bytes)
}

fn validate_builtin_spritesheet(path: &Path) -> Result<()> {
    let (width, height) =
        image::image_dimensions(path).with_context(|| format!("读取 {}", path.display()))?;
    if (width, height) != (SPRITESHEET_WIDTH, SPRITESHEET_HEIGHT) {
        bail!("精灵图尺寸应为 {SPRITESHEET_WIDTH}x{SPRITESHEET_HEIGHT}，实际为 {width}x{height}");
    }
    Ok(())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
