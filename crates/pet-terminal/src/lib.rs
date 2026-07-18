//! Standalone terminal frontend using the same image protocols as Codex TUI pets.

mod protocol;
mod sixel;

use std::io::Write as _;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use crossterm::ExecutableCommand as _;
use crossterm::cursor::Hide;
use crossterm::cursor::MoveTo;
use crossterm::cursor::Show;
use crossterm::event;
use crossterm::event::Event;
use crossterm::event::KeyCode;
use crossterm::event::KeyEventKind;
use crossterm::style::Print;
use crossterm::terminal::Clear;
use crossterm::terminal::ClearType;
use crossterm::terminal::EnterAlternateScreen;
use crossterm::terminal::LeaveAlternateScreen;
use crossterm::terminal::disable_raw_mode;
use crossterm::terminal::enable_raw_mode;
use pet_assets::AssetStore;
use pet_assets::prepare_png_frames;
use pet_core::BehaviorController;
use pet_core::BehaviorMode;

pub use protocol::ProtocolSelection;

const IMAGE_ID: u32 = 0xC0DE;
const AMBIENT_COMPOSER_GAP_PX: u16 = 10;
const TERMINAL_ROW_HEIGHT_PX: u16 = 15;

#[derive(Debug, Clone)]
pub struct TerminalOptions {
    pub pet: String,
    pub protocol: ProtocolSelection,
    pub height_px: u16,
    /// 将宠物锚定在终端内容区右下方，复用 Codex TUI 的 ambient 布局语义。
    pub ambient: bool,
}

pub fn run(store: &AssetStore, options: &TerminalOptions) -> Result<()> {
    let protocol = options.protocol.resolve()?;
    let pet = store.load_pet(&options.pet)?;
    let cache = store.frame_cache_dir(&pet)?;
    let frames = prepare_png_frames(&pet, &cache.join("png"))?;
    if frames.is_empty() {
        bail!("宠物没有可渲染帧");
    }

    let mut terminal = TerminalSession::start()?;
    let mut behavior = BehaviorController::default();
    let mut renderer =
        protocol::TerminalImageRenderer::new(protocol, IMAGE_ID, cache.join("sixel"));
    let mut last_frame = None;

    loop {
        if behavior.advance_if_due() {
            last_frame = None;
        }
        let tick = pet
            .frame_at(
                behavior.state().animation_name(),
                behavior.state_elapsed().as_millis() as u64,
            )
            .context("当前动画没有帧")?;
        if last_frame != Some(tick.sprite_index) {
            let frame = frames
                .get(tick.sprite_index)
                .or_else(|| frames.first())
                .context("宠物帧索引越界")?;
            let (terminal_columns, terminal_rows) = crossterm::terminal::size()?;
            let image_rows = (options.height_px / 15).max(1);
            let aspect = f64::from(pet.frame_height) / f64::from(pet.frame_width) * 0.52;
            let image_columns = (f64::from(image_rows) / aspect).round().max(1.0) as u16;
            let (x, y) = image_position(
                terminal_columns,
                terminal_rows.saturating_sub(2),
                image_columns,
                image_rows,
                options.ambient,
            );
            renderer.draw(
                terminal.writer(),
                frame,
                protocol::ImagePlacement {
                    x,
                    y,
                    columns: image_columns,
                    rows: image_rows,
                    height_px: options.height_px,
                },
            )?;
            draw_status(
                terminal.writer(),
                terminal_rows,
                &pet.display_name,
                behavior.state().label(),
                behavior.mode(),
                behavior.paused(),
            )?;
            last_frame = Some(tick.sprite_index);
        }

        let wait = Duration::from_millis(tick.delay_ms.unwrap_or(100).min(100));
        if !event::poll(wait)? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => break,
            KeyCode::Char(' ') => {
                behavior.set_paused(!behavior.paused());
                last_frame = None;
            }
            KeyCode::Char('n') => {
                behavior.advance();
                last_frame = None;
            }
            KeyCode::Char('a') => {
                let mode = if behavior.mode() == BehaviorMode::Automatic {
                    BehaviorMode::Manual
                } else {
                    BehaviorMode::Automatic
                };
                behavior.set_mode(mode);
                last_frame = None;
            }
            _ => {}
        }
    }

    renderer.clear(terminal.writer())?;
    Ok(())
}

fn image_position(
    area_columns: u16,
    content_bottom: u16,
    image_columns: u16,
    image_rows: u16,
    ambient: bool,
) -> (u16, u16) {
    if !ambient {
        return (
            area_columns.saturating_sub(image_columns) / 2,
            content_bottom.saturating_sub(image_rows) / 2,
        );
    }
    let gap_rows = AMBIENT_COMPOSER_GAP_PX.div_ceil(TERMINAL_ROW_HEIGHT_PX);
    (
        area_columns.saturating_sub(image_columns),
        content_bottom
            .saturating_sub(gap_rows)
            .saturating_sub(image_rows),
    )
}

fn draw_status(
    writer: &mut std::io::Stdout,
    terminal_rows: u16,
    pet_name: &str,
    state: &str,
    mode: BehaviorMode,
    paused: bool,
) -> Result<()> {
    let mode = if mode == BehaviorMode::Automatic {
        "自动"
    } else {
        "手动"
    };
    let paused = if paused { " · 已暂停" } else { "" };
    writer.execute(MoveTo(0, terminal_rows.saturating_sub(2)))?;
    writer.execute(Clear(ClearType::CurrentLine))?;
    writer.execute(Print(format!("  {pet_name} · {state} · {mode}{paused}")))?;
    writer.execute(MoveTo(0, terminal_rows.saturating_sub(1)))?;
    writer.execute(Clear(ClearType::CurrentLine))?;
    writer.execute(Print("  q 退出   Space 暂停   n 下一个行为   a 自动/手动"))?;
    writer.flush()?;
    Ok(())
}

struct TerminalSession {
    stdout: std::io::Stdout,
}

impl TerminalSession {
    fn start() -> Result<Self> {
        enable_raw_mode().context("启用终端原始模式")?;
        let mut stdout = std::io::stdout();
        if let Err(error) = stdout
            .execute(EnterAlternateScreen)
            .and_then(|writer| writer.execute(Hide))
        {
            let _ = disable_raw_mode();
            return Err(error).context("进入终端宠物界面");
        }
        Ok(Self { stdout })
    }

    fn writer(&mut self) -> &mut std::io::Stdout {
        &mut self.stdout
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = self.stdout.execute(Show);
        let _ = self.stdout.execute(LeaveAlternateScreen);
        let _ = disable_raw_mode();
    }
}

#[cfg(test)]
mod tests {
    use super::image_position;

    #[test]
    fn ambient_layout_anchors_above_bottom_right_content() {
        assert_eq!(image_position(100, 40, 12, 5, true), (88, 34));
    }

    #[test]
    fn centered_layout_remains_available() {
        assert_eq!(image_position(100, 40, 12, 6, false), (44, 17));
    }
}
