use anyhow::Result;
#[cfg(any(target_os = "windows", test))]
use anyhow::bail;

#[cfg(any(target_os = "windows", test))]
const MAX_SELECTION_CHARS: usize = 20_000;

#[derive(Debug)]
pub struct SelectionCapture {
    pub text: String,
    pub method: &'static str,
}

pub fn capture() -> Result<SelectionCapture> {
    platform::capture()
}

#[cfg(any(target_os = "windows", test))]
fn validated_text(value: String) -> Result<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        bail!("没有检测到选中的文本");
    }
    if value.chars().count() > MAX_SELECTION_CHARS {
        bail!("选中文本超过 {MAX_SELECTION_CHARS} 个字符");
    }
    Ok(value)
}

#[cfg(target_os = "windows")]
mod platform {
    use std::cell::RefCell;
    use std::thread;
    use std::time::Duration;
    use std::time::SystemTime;
    use std::time::UNIX_EPOCH;

    use anyhow::Context;
    use anyhow::Result;
    use anyhow::bail;
    use uiautomation::UIAutomation;
    use uiautomation::clipboards::Clipboard;
    use uiautomation::inputs::Keyboard;
    use uiautomation::patterns::UITextPattern;

    use super::MAX_SELECTION_CHARS;
    use super::SelectionCapture;
    use super::validated_text;

    thread_local! {
        static AUTOMATION: RefCell<Option<UIAutomation>> = const { RefCell::new(None) };
    }

    pub fn capture() -> Result<SelectionCapture> {
        if let Ok(text) = capture_with_uiautomation() {
            return Ok(SelectionCapture {
                text,
                method: "uiAutomation",
            });
        }

        Ok(SelectionCapture {
            text: capture_with_copy()?,
            method: "clipboardCopy",
        })
    }

    fn capture_with_uiautomation() -> Result<String> {
        AUTOMATION.with(|slot| {
            if slot.borrow().is_none() {
                *slot.borrow_mut() =
                    Some(UIAutomation::new().context("初始化 Windows UI Automation")?);
            }
            let slot = slot.borrow();
            let automation = slot.as_ref().context("Windows UI Automation 尚未初始化")?;
            let focused = automation
                .get_focused_element()
                .context("获取当前焦点控件")?;
            let pattern = focused
                .get_pattern::<UITextPattern>()
                .context("当前控件不支持文本选区")?;
            let ranges = pattern.get_selection().context("读取当前文本选区")?;
            let mut parts = Vec::with_capacity(ranges.len());
            for range in ranges {
                let text = range
                    .get_text((MAX_SELECTION_CHARS + 1) as i32)
                    .context("读取选区文本")?;
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }
            validated_text(parts.join("\n"))
        })
    }

    fn capture_with_copy() -> Result<String> {
        let snapshot = {
            let clipboard = Clipboard::open().context("打开 Windows 剪贴板")?;
            clipboard.snapshot(false).context("暂存剪贴板")?
        };
        let sentinel = format!(
            "codex-pet-selection-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        {
            let clipboard = Clipboard::open().context("准备选区复制")?;
            clipboard.set_text(&sentinel).context("写入选区复制标记")?;
        }

        thread::sleep(Duration::from_millis(160));
        let capture_result = (|| {
            Keyboard::new()
                .interval(0)
                .send_keys("{ctrl}c")
                .context("模拟 Ctrl+C")?;

            for _ in 0..20 {
                thread::sleep(Duration::from_millis(25));
                let value = {
                    let clipboard = Clipboard::open().context("读取复制结果")?;
                    clipboard.get_text().context("解析复制结果")?
                };
                if value != sentinel {
                    return validated_text(value);
                }
            }
            bail!("无法从当前应用复制选中文本")
        })();

        if let Ok(clipboard) = Clipboard::open() {
            let _ = clipboard.restore(snapshot);
        }
        capture_result
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use anyhow::Result;
    use anyhow::bail;

    use super::SelectionCapture;

    pub fn capture() -> Result<SelectionCapture> {
        bail!("当前平台应由 Electron 读取系统 Selection Clipboard")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_text_is_trimmed() {
        assert_eq!(validated_text("  hello\n".into()).unwrap(), "hello");
    }

    #[test]
    fn empty_selection_is_rejected() {
        assert!(validated_text(" \n\t".into()).is_err());
    }

    #[test]
    fn oversized_selection_is_rejected() {
        assert!(validated_text("x".repeat(MAX_SELECTION_CHARS + 1)).is_err());
    }
}
