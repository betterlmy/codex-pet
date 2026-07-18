use std::collections::BTreeMap;
use std::fs;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest as _;
use sha2::Sha256;

use crate::BuiltinPet;
use crate::DEFAULT_FRAME_COLUMNS;
use crate::DEFAULT_FRAME_HEIGHT;
use crate::DEFAULT_FRAME_ROWS;
use crate::DEFAULT_FRAME_WIDTH;

const MAX_PET_FRAMES: usize = 256;
const MAX_ANIMATION_FPS: f64 = 60.0;

pub const CUSTOM_PET_PREFIX: &str = "custom:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationFrame {
    pub sprite_index: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    pub frames: Vec<AnimationFrame>,
    pub loop_start: Option<usize>,
    pub fallback: String,
}

impl Animation {
    fn total_duration_ms(&self) -> u64 {
        self.frames.iter().map(|frame| frame.duration_ms).sum()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameTick {
    pub sprite_index: usize,
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pet {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: PathBuf,
    pub frame_width: u32,
    pub frame_height: u32,
    pub columns: u32,
    pub rows: u32,
    pub frame_count: usize,
    pub animations: BTreeMap<String, Animation>,
}

impl Pet {
    pub fn from_builtin(definition: BuiltinPet, spritesheet_path: PathBuf) -> Result<Self> {
        ensure_grid_dimensions(
            &spritesheet_path,
            DEFAULT_FRAME_WIDTH,
            DEFAULT_FRAME_HEIGHT,
            DEFAULT_FRAME_COLUMNS,
            DEFAULT_FRAME_ROWS,
        )?;
        Ok(Self {
            id: definition.id.to_string(),
            display_name: definition.display_name.to_string(),
            description: definition.description.to_string(),
            spritesheet_path,
            frame_width: DEFAULT_FRAME_WIDTH,
            frame_height: DEFAULT_FRAME_HEIGHT,
            columns: DEFAULT_FRAME_COLUMNS,
            rows: DEFAULT_FRAME_ROWS,
            frame_count: (DEFAULT_FRAME_COLUMNS * DEFAULT_FRAME_ROWS) as usize,
            animations: default_animations(),
        })
    }

    pub fn load_custom(selector: &str, home: &Path) -> Result<Self> {
        if path_like(selector) {
            return load_pet_path(selector);
        }
        let id = selector.strip_prefix(CUSTOM_PET_PREFIX).unwrap_or(selector);
        let pet_dir = home.join("pets").join(id);
        if pet_dir.join("pet.json").is_file() {
            return load_manifest(&pet_dir, "pet.json", id);
        }
        let avatar_dir = home.join("avatars").join(id);
        if avatar_dir.join("avatar.json").is_file() {
            return load_manifest(&avatar_dir, "avatar.json", id);
        }
        bail!("未知宠物 {selector}")
    }

    #[must_use]
    pub fn frame_at(&self, animation_name: &str, elapsed_ms: u64) -> Option<FrameTick> {
        let mut name = animation_name;
        let mut elapsed_ms = elapsed_ms;
        for _ in 0..8 {
            let animation = self
                .animations
                .get(name)
                .or_else(|| self.animations.get("idle"))?;
            let total_ms = animation.total_duration_ms();
            if animation.loop_start.is_none() && elapsed_ms >= total_ms {
                elapsed_ms = elapsed_ms.saturating_sub(total_ms);
                name = &animation.fallback;
                continue;
            }
            return frame_at_elapsed(animation, elapsed_ms);
        }
        None
    }

    #[must_use]
    pub const fn frame_count(&self) -> usize {
        self.frame_count
    }

    pub fn frame_cache_key(&self) -> Result<String> {
        let bytes = fs::read(&self.spritesheet_path)
            .with_context(|| format!("读取 {}", self.spritesheet_path.display()))?;
        let digest = Sha256::digest(&bytes);
        Ok(format!(
            "sha256-{digest:x}-{}x{}-{}x{}",
            self.frame_width, self.frame_height, self.columns, self.rows
        ))
    }
}

#[derive(Debug, Deserialize)]
struct PetFile {
    id: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    description: Option<String>,
    #[serde(rename = "spritesheetPath")]
    spritesheet_path: Option<String>,
    frame: Option<FrameSpec>,
    #[serde(default)]
    animations: BTreeMap<String, AnimationSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
struct FrameSpec {
    width: u32,
    height: u32,
    columns: u32,
    rows: u32,
}

impl Default for FrameSpec {
    fn default() -> Self {
        Self {
            width: DEFAULT_FRAME_WIDTH,
            height: DEFAULT_FRAME_HEIGHT,
            columns: DEFAULT_FRAME_COLUMNS,
            rows: DEFAULT_FRAME_ROWS,
        }
    }
}

#[derive(Debug, Deserialize)]
struct AnimationSpec {
    frames: Vec<usize>,
    fps: Option<f64>,
    #[serde(rename = "loop")]
    loop_animation: Option<bool>,
    fallback: Option<String>,
}

#[must_use]
pub fn custom_pet_selector(id: &str) -> String {
    format!("{CUSTOM_PET_PREFIX}{id}")
}

fn load_pet_path(value: &str) -> Result<Pet> {
    let path = expand_path(value)?;
    let metadata =
        fs::metadata(&path).with_context(|| format!("读取宠物路径 {}", path.display()))?;
    let directory = if metadata.is_dir() {
        path
    } else {
        path.parent().context("宠物清单没有父目录")?.to_path_buf()
    };
    let directory = directory
        .canonicalize()
        .with_context(|| format!("解析 {}", directory.display()))?;
    let manifest = if directory.join("pet.json").is_file() {
        "pet.json"
    } else if directory.join("avatar.json").is_file() {
        "avatar.json"
    } else {
        bail!("{} 中缺少 pet.json 或 avatar.json", directory.display());
    };
    let fallback_id = directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("pet");
    load_manifest(&directory, manifest, fallback_id)
}

fn load_manifest(directory: &Path, manifest: &str, fallback_id: &str) -> Result<Pet> {
    let path = directory.join(manifest);
    let raw = fs::read_to_string(&path).with_context(|| format!("读取 {}", path.display()))?;
    let file: PetFile =
        serde_json::from_str(&raw).with_context(|| format!("解析 {}", path.display()))?;
    let frame = file.frame.unwrap_or_default();
    let relative_spritesheet = file
        .spritesheet_path
        .as_deref()
        .unwrap_or("spritesheet.webp");
    let spritesheet_path = resolve_child_path(directory, relative_spritesheet)?;
    let frame_count = ensure_grid_dimensions(
        &spritesheet_path,
        frame.width,
        frame.height,
        frame.columns,
        frame.rows,
    )?;
    let animations = load_animations(file.animations, frame_count)?;
    let manifest_id = file
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    Ok(Pet {
        id: manifest_id.unwrap_or(fallback_id).to_string(),
        display_name: file
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .or(manifest_id)
            .unwrap_or(fallback_id)
            .to_string(),
        description: file.description.unwrap_or_default().trim().to_string(),
        spritesheet_path,
        frame_width: frame.width,
        frame_height: frame.height,
        columns: frame.columns,
        rows: frame.rows,
        frame_count,
        animations,
    })
}

fn resolve_child_path(directory: &Path, value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        bail!("spritesheetPath 必须位于 {} 内", directory.display());
    }
    Ok(directory.join(path))
}

fn ensure_grid_dimensions(
    path: &Path,
    frame_width: u32,
    frame_height: u32,
    columns: u32,
    rows: u32,
) -> Result<usize> {
    if frame_width == 0 || frame_height == 0 || columns == 0 || rows == 0 {
        bail!("帧尺寸和网格数量必须大于零");
    }
    let expected_width = frame_width.checked_mul(columns).context("精灵图宽度溢出")?;
    let expected_height = frame_height.checked_mul(rows).context("精灵图高度溢出")?;
    let (width, height) =
        image::image_dimensions(path).with_context(|| format!("读取精灵图 {}", path.display()))?;
    if (width, height) != (expected_width, expected_height) {
        bail!("精灵图尺寸应为 {expected_width}x{expected_height}，实际为 {width}x{height}");
    }
    let count = columns.checked_mul(rows).context("宠物帧数量溢出")? as usize;
    if count > MAX_PET_FRAMES {
        bail!("宠物帧数量 {count} 超过上限 {MAX_PET_FRAMES}");
    }
    Ok(count)
}

fn load_animations(
    specs: BTreeMap<String, AnimationSpec>,
    frame_count: usize,
) -> Result<BTreeMap<String, Animation>> {
    let mut animations = if frame_count >= (DEFAULT_FRAME_COLUMNS * DEFAULT_FRAME_ROWS) as usize {
        default_animations()
    } else {
        BTreeMap::new()
    };
    for (name, spec) in specs {
        if spec.frames.is_empty() {
            bail!("动画 {name} 至少需要一帧");
        }
        if let Some(index) = spec.frames.iter().find(|index| **index >= frame_count) {
            bail!("动画 {name} 引用了越界帧 {index}");
        }
        let fps = spec.fps.unwrap_or(8.0);
        if !fps.is_finite() || fps <= 0.0 || fps > MAX_ANIMATION_FPS {
            bail!("动画 {name} 的 fps 必须在 0 到 {MAX_ANIMATION_FPS} 之间");
        }
        let duration_ms = u64::try_from(std::time::Duration::from_secs_f64(1.0 / fps).as_millis())
            .unwrap_or(u64::MAX)
            .max(1);
        animations.insert(
            name,
            Animation {
                frames: spec
                    .frames
                    .into_iter()
                    .map(|sprite_index| AnimationFrame {
                        sprite_index,
                        duration_ms,
                    })
                    .collect(),
                loop_start: spec.loop_animation.unwrap_or(true).then_some(0),
                fallback: spec.fallback.unwrap_or_else(|| "idle".to_string()),
            },
        );
    }
    animations
        .entry("idle".to_string())
        .or_insert_with(|| Animation {
            frames: vec![AnimationFrame {
                sprite_index: 0,
                duration_ms: 1000,
            }],
            loop_start: Some(0),
            fallback: "idle".to_string(),
        });
    validate_animations(&animations, frame_count)?;
    Ok(animations)
}

fn validate_animations(animations: &BTreeMap<String, Animation>, frame_count: usize) -> Result<()> {
    for (name, animation) in animations {
        if animation.frames.is_empty() {
            bail!("动画 {name} 至少需要一帧");
        }
        if let Some(frame) = animation
            .frames
            .iter()
            .find(|frame| frame.sprite_index >= frame_count)
        {
            bail!("动画 {name} 引用了越界帧 {}", frame.sprite_index);
        }
        if !animations.contains_key(&animation.fallback) {
            bail!("动画 {name} 的回退动画 {} 不存在", animation.fallback);
        }
    }
    Ok(())
}

fn frame_at_elapsed(animation: &Animation, elapsed_ms: u64) -> Option<FrameTick> {
    let total_ms = animation.total_duration_ms();
    let effective_elapsed = if let Some(loop_start) = animation
        .loop_start
        .filter(|index| *index < animation.frames.len())
    {
        let prefix_ms: u64 = animation.frames[..loop_start]
            .iter()
            .map(|frame| frame.duration_ms)
            .sum();
        let loop_ms = total_ms.saturating_sub(prefix_ms);
        if elapsed_ms >= total_ms && loop_ms > 0 {
            prefix_ms + elapsed_ms.saturating_sub(prefix_ms) % loop_ms
        } else {
            elapsed_ms
        }
    } else {
        elapsed_ms.min(total_ms.saturating_sub(1))
    };

    let mut remaining = effective_elapsed;
    for frame in &animation.frames {
        let duration = frame.duration_ms.max(1);
        if remaining < duration {
            return Some(FrameTick {
                sprite_index: frame.sprite_index,
                delay_ms: Some(duration - remaining),
            });
        }
        remaining = remaining.saturating_sub(duration);
    }
    animation.frames.last().map(|frame| FrameTick {
        sprite_index: frame.sprite_index,
        delay_ms: None,
    })
}

fn default_animations() -> BTreeMap<String, Animation> {
    [
        ("idle", idle_animation()),
        ("running-right", app_state_animation(1, 8, 120, 220)),
        ("running-left", app_state_animation(2, 8, 120, 220)),
        ("waving", app_state_animation(3, 4, 140, 280)),
        ("jumping", app_state_animation(4, 5, 140, 280)),
        ("failed", app_state_animation(5, 8, 140, 240)),
        ("waiting", app_state_animation(6, 6, 150, 260)),
        ("running", app_state_animation(7, 6, 120, 220)),
        ("review", app_state_animation(8, 6, 150, 280)),
        ("move_right", app_state_animation(1, 8, 120, 220)),
        ("move_left", app_state_animation(2, 8, 120, 220)),
        ("wave", app_state_animation(3, 4, 140, 280)),
        ("bounce", app_state_animation(4, 5, 140, 280)),
        ("sad", app_state_animation(5, 8, 140, 240)),
    ]
    .into_iter()
    .map(|(name, animation)| (name.to_string(), animation))
    .collect()
}

fn idle_animation() -> Animation {
    Animation {
        frames: [(0, 1680), (1, 660), (2, 660), (3, 840), (4, 840), (5, 1920)]
            .into_iter()
            .map(|(sprite_index, duration_ms)| AnimationFrame {
                sprite_index,
                duration_ms,
            })
            .collect(),
        loop_start: Some(0),
        fallback: "idle".to_string(),
    }
}

fn app_state_animation(
    row: usize,
    frame_count: usize,
    duration_ms: u64,
    final_duration_ms: u64,
) -> Animation {
    let primary_frames = (0..frame_count)
        .map(|column| AnimationFrame {
            sprite_index: row * DEFAULT_FRAME_COLUMNS as usize + column,
            duration_ms: if column + 1 == frame_count {
                final_duration_ms
            } else {
                duration_ms
            },
        })
        .collect::<Vec<_>>();
    let primary_frame_count = primary_frames.len() * 3;
    let frames = primary_frames
        .iter()
        .chain(primary_frames.iter())
        .chain(primary_frames.iter())
        .cloned()
        .chain(idle_animation().frames)
        .collect();
    Animation {
        frames,
        loop_start: Some(primary_frame_count),
        fallback: "idle".to_string(),
    }
}

fn path_like(value: &str) -> bool {
    value == "."
        || value == ".."
        || value == "~"
        || value.starts_with("~/")
        || value.starts_with("./")
        || value.starts_with("../")
        || Path::new(value).is_absolute()
        || value.contains('/')
        || value.contains('\\')
}

fn expand_path(value: &str) -> Result<PathBuf> {
    if value == "~" || value.starts_with("~/") {
        let home = std::env::var_os("HOME").context("HOME 未设置")?;
        if value == "~" {
            return Ok(PathBuf::from(home));
        }
        return Ok(PathBuf::from(home).join(&value[2..]));
    }
    Ok(PathBuf::from(value))
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
