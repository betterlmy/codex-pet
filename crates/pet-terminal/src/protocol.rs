use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::str::FromStr;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use base64::Engine as _;
use base64::engine::general_purpose;
use crossterm::QueueableCommand as _;
use crossterm::cursor::MoveTo;
use crossterm::cursor::RestorePosition;
use crossterm::cursor::SavePosition;
use image::imageops::FilterType;

use crate::sixel;

const ESC: &str = "\x1b";
const ST: &str = "\x1b\\";
const KITTY_CHUNK_SIZE: usize = 4096;
const SIXEL_CACHE_VERSION: &str = "v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSelection {
    Auto,
    Kitty,
    KittyFile,
    Sixel,
}

impl ProtocolSelection {
    pub fn resolve(self) -> Result<ImageProtocol> {
        match self {
            Self::Kitty => Ok(ImageProtocol::Kitty),
            Self::KittyFile => Ok(ImageProtocol::KittyFile),
            Self::Sixel => Ok(ImageProtocol::Sixel),
            Self::Auto => detect_protocol(),
        }
    }
}

impl FromStr for ProtocolSelection {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "auto" => Ok(Self::Auto),
            "kitty" => Ok(Self::Kitty),
            "kitty-file" => Ok(Self::KittyFile),
            "sixel" => Ok(Self::Sixel),
            _ => bail!("未知协议 {value}；可选 auto、kitty、kitty-file、sixel"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageProtocol {
    Kitty,
    KittyFile,
    Sixel,
}

#[derive(Debug, Clone, Copy)]
pub struct ImagePlacement {
    pub x: u16,
    pub y: u16,
    pub columns: u16,
    pub rows: u16,
    pub height_px: u16,
}

pub struct TerminalImageRenderer {
    protocol: ImageProtocol,
    image_id: u32,
    sixel_cache: PathBuf,
    last_placement: Option<ImagePlacement>,
}

impl TerminalImageRenderer {
    pub fn new(protocol: ImageProtocol, image_id: u32, sixel_cache: PathBuf) -> Self {
        Self {
            protocol,
            image_id,
            sixel_cache,
            last_placement: None,
        }
    }

    pub fn draw(
        &mut self,
        writer: &mut impl Write,
        frame: &Path,
        placement: ImagePlacement,
    ) -> Result<()> {
        if matches!(
            self.protocol,
            ImageProtocol::Kitty | ImageProtocol::KittyFile
        ) {
            write!(writer, "{}", kitty_delete_image(self.image_id))?;
        }
        if matches!(self.protocol, ImageProtocol::Sixel)
            && let Some(previous) = self.last_placement
        {
            clear_area(writer, previous)?;
        }

        let payload = match self.protocol {
            ImageProtocol::Kitty => {
                kitty_transmit_png(frame, placement.columns, placement.rows, self.image_id)?
                    .into_bytes()
            }
            ImageProtocol::KittyFile => {
                kitty_transmit_png_file(frame, placement.columns, placement.rows, self.image_id)?
                    .into_bytes()
            }
            ImageProtocol::Sixel => {
                fs::read(sixel_frame(frame, &self.sixel_cache, placement.height_px)?)?
            }
        };

        writer.queue(SavePosition)?;
        writer.queue(MoveTo(placement.x, placement.y))?;
        writer.write_all(&payload)?;
        writer.queue(RestorePosition)?;
        writer.flush()?;
        self.last_placement = Some(placement);
        Ok(())
    }

    pub fn clear(&mut self, writer: &mut impl Write) -> Result<()> {
        match self.protocol {
            ImageProtocol::Kitty | ImageProtocol::KittyFile => {
                write!(writer, "{}", kitty_delete_image(self.image_id))?;
            }
            ImageProtocol::Sixel => {
                if let Some(placement) = self.last_placement.take() {
                    clear_area(writer, placement)?;
                }
            }
        }
        writer.flush()?;
        Ok(())
    }
}

fn detect_protocol() -> Result<ImageProtocol> {
    if env::var_os("TMUX").is_some() || env::var_os("TMUX_PANE").is_some() {
        bail!("tmux 中禁用自动桌宠协议检测；请在 tmux 外运行或显式指定协议");
    }
    if env::var_os("ZELLIJ").is_some() || env::var_os("ZELLIJ_SESSION_NAME").is_some() {
        bail!("Zellij 中禁用终端桌宠，避免图像跨 pane 残留");
    }
    if env::var_os("KITTY_WINDOW_ID").is_some()
        || env::var_os("WEZTERM_EXECUTABLE").is_some()
        || env::var_os("WEZTERM_VERSION").is_some()
    {
        return Ok(ImageProtocol::Kitty);
    }

    let term_program = env::var("TERM_PROGRAM")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let term = env::var("TERM").unwrap_or_default().to_ascii_lowercase();
    if term_program.contains("iterm") && iterm_supports_kitty_file() {
        return Ok(ImageProtocol::KittyFile);
    }
    if ["ghostty", "kitty", "wezterm"]
        .iter()
        .any(|name| term_program.contains(name) || term.contains(name))
    {
        return Ok(ImageProtocol::Kitty);
    }
    if env::var_os("WT_SESSION").is_some()
        || ["sixel", "foot", "mlterm"]
            .iter()
            .any(|name| term.contains(name))
    {
        return Ok(ImageProtocol::Sixel);
    }
    bail!("当前终端未检测到 Kitty 或 Sixel 图像协议支持")
}

fn iterm_supports_kitty_file() -> bool {
    let version = env::var("TERM_PROGRAM_VERSION").unwrap_or_default();
    let mut parts = version
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok());
    let parsed = (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    );
    parsed >= (3, 6, 0)
}

fn kitty_delete_image(image_id: u32) -> String {
    wrap_for_tmux(&format!("{ESC}_Ga=d,d=I,i={image_id},q=2;{ST}"))
}

fn kitty_transmit_png(path: &Path, columns: u16, rows: u16, image_id: u32) -> Result<String> {
    let payload = general_purpose::STANDARD
        .encode(fs::read(path).with_context(|| format!("读取 {}", path.display()))?);
    let chunks = payload
        .as_bytes()
        .chunks(KITTY_CHUNK_SIZE)
        .collect::<Vec<_>>();
    let mut command = String::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let chunk = std::str::from_utf8(chunk).context("base64 负载不是 UTF-8")?;
        let more = u8::from(index + 1 < chunks.len());
        if index == 0 {
            command.push_str(&format!(
                "{ESC}_Ga=T,t=d,f=100,c={columns},r={rows},q=2,i={image_id},m={more};{chunk}{ST}"
            ));
        } else {
            command.push_str(&format!("{ESC}_Gm={more};{chunk}{ST}"));
        }
    }
    Ok(wrap_for_tmux(&command))
}

fn kitty_transmit_png_file(path: &Path, columns: u16, rows: u16, image_id: u32) -> Result<String> {
    let path = path
        .canonicalize()
        .with_context(|| format!("解析 {}", path.display()))?;
    let payload = general_purpose::STANDARD.encode(path.to_string_lossy().as_bytes());
    Ok(wrap_for_tmux(&format!(
        "{ESC}_Ga=T,t=f,f=100,c={columns},r={rows},q=2,i={image_id};{payload}{ST}"
    )))
}

fn wrap_for_tmux(command: &str) -> String {
    if env::var_os("TMUX").is_none() {
        return command.to_string();
    }
    format!("{ESC}Ptmux;{}{ST}", command.replace(ESC, "\x1b\x1b"))
}

fn sixel_frame(frame_path: &Path, cache_dir: &Path, height_px: u16) -> Result<PathBuf> {
    fs::create_dir_all(cache_dir).with_context(|| format!("创建 {}", cache_dir.display()))?;
    let stem = frame_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .context("宠物帧文件名无效")?;
    let path = cache_dir.join(format!("{stem}_h{height_px}_{SIXEL_CACHE_VERSION}.six"));
    if path.exists() {
        return Ok(path);
    }
    let frame =
        image::open(frame_path).with_context(|| format!("读取 {}", frame_path.display()))?;
    let height = u32::from(height_px).max(1);
    let width = ((u64::from(frame.width()) * u64::from(height)) / u64::from(frame.height()))
        .try_into()
        .unwrap_or(u32::MAX)
        .max(1);
    let rgba = frame.resize(width, height, FilterType::Lanczos3).to_rgba8();
    let (width, height) = rgba.dimensions();
    fs::write(&path, sixel::encode_rgba(&rgba.into_raw(), width, height)?)
        .with_context(|| format!("写入 {}", path.display()))?;
    Ok(path)
}

fn clear_area(writer: &mut impl Write, placement: ImagePlacement) -> Result<()> {
    writer.queue(SavePosition)?;
    let blank = " ".repeat(placement.columns as usize);
    for row in placement.y..placement.y.saturating_add(placement.rows) {
        writer.queue(MoveTo(placement.x, row))?;
        write!(writer, "{blank}")?;
    }
    writer.queue(RestorePosition)?;
    Ok(())
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
