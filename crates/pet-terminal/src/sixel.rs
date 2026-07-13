use anyhow::Context;
use anyhow::Result;
use anyhow::bail;

const ST: &[u8] = b"\x1b\\";
const SIXEL_BAND_HEIGHT: u32 = 6;
const PALETTE_COLOR_COUNT: usize = 256;
const TRANSPARENT_ALPHA_THRESHOLD: u8 = 128;
const TRANSPARENT_BACKGROUND_DCS: &[u8] = b"\x1bP9;1;0q";

pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    if width == 0 || height == 0 {
        bail!("Sixel 图像尺寸必须大于零");
    }
    let expected = pixel_count(width, height)?
        .checked_mul(4)
        .context("Sixel RGBA 缓冲区长度溢出")?;
    if rgba.len() != expected {
        bail!("Sixel RGBA 缓冲区长度为 {}，应为 {expected}", rgba.len());
    }
    let palette = Palette::from_rgba(rgba);
    let mut output = Vec::new();
    output.extend_from_slice(TRANSPARENT_BACKGROUND_DCS);
    output.extend_from_slice(format!("\"1;1;{width};{height}").as_bytes());
    palette.write_definitions(&mut output);
    write_pixels(&mut output, rgba, width, height, &palette)?;
    output.extend_from_slice(ST);
    Ok(output)
}

fn write_pixels(
    output: &mut Vec<u8>,
    rgba: &[u8],
    width: u32,
    height: u32,
    palette: &Palette,
) -> Result<()> {
    for band in 0..height.div_ceil(SIXEL_BAND_HEIGHT) {
        let top = band * SIXEL_BAND_HEIGHT;
        let colors = active_colors(rgba, width, height, top, palette)?;
        for (position, color) in colors.iter().enumerate() {
            output.extend_from_slice(format!("#{color}").as_bytes());
            let mut run = None;
            let mut run_length = 0;
            for x in 0..width {
                let data = column_data(rgba, width, height, top, x, *color)?;
                push_run(&mut run, &mut run_length, output, data);
            }
            flush_run(&mut run, &mut run_length, output);
            if position + 1 < colors.len() {
                output.push(b'$');
            }
        }
        if band + 1 < height.div_ceil(SIXEL_BAND_HEIGHT) {
            output.extend_from_slice(if colors.is_empty() { b"-" } else { b"$-" });
        }
    }
    Ok(())
}

fn active_colors(
    rgba: &[u8],
    width: u32,
    height: u32,
    top: u32,
    palette: &Palette,
) -> Result<Vec<u8>> {
    let mut active = [false; PALETTE_COLOR_COUNT];
    for y in top..height.min(top + SIXEL_BAND_HEIGHT) {
        for x in 0..width {
            if let Some(index) = color_at(rgba, width, x, y)? {
                active[index as usize] = true;
            }
        }
    }
    Ok(palette
        .indices()
        .filter(|index| active[*index as usize])
        .collect())
}

fn column_data(rgba: &[u8], width: u32, height: u32, top: u32, x: u32, color: u8) -> Result<u8> {
    let mut mask = 0;
    for bit in 0..SIXEL_BAND_HEIGHT {
        let y = top + bit;
        if y < height && color_at(rgba, width, x, y)? == Some(color) {
            mask |= 1 << bit;
        }
    }
    Ok(b'?' + mask)
}

fn color_at(rgba: &[u8], width: u32, x: u32, y: u32) -> Result<Option<u8>> {
    let offset = pixel_offset(width, x, y)?;
    if rgba[offset + 3] < TRANSPARENT_ALPHA_THRESHOLD {
        return Ok(None);
    }
    Ok(Some(rgb332(
        rgba[offset],
        rgba[offset + 1],
        rgba[offset + 2],
    )))
}

fn push_run(run: &mut Option<u8>, length: &mut usize, output: &mut Vec<u8>, byte: u8) {
    if *run == Some(byte) {
        *length += 1;
        return;
    }
    flush_run(run, length, output);
    *run = Some(byte);
    *length = 1;
}

fn flush_run(run: &mut Option<u8>, length: &mut usize, output: &mut Vec<u8>) {
    let Some(byte) = run.take() else {
        return;
    };
    if *length > 3 {
        output.extend_from_slice(format!("!{}", *length).as_bytes());
        output.push(byte);
    } else {
        output.extend(std::iter::repeat_n(byte, *length));
    }
    *length = 0;
}

fn pixel_offset(width: u32, x: u32, y: u32) -> Result<usize> {
    let offset = u64::from(y)
        .checked_mul(u64::from(width))
        .and_then(|row| row.checked_add(u64::from(x)))
        .and_then(|pixel| pixel.checked_mul(4))
        .context("Sixel 像素索引溢出")?;
    usize::try_from(offset).context("Sixel 像素索引无法转换为 usize")
}

fn pixel_count(width: u32, height: u32) -> Result<usize> {
    usize::try_from(
        u64::from(width)
            .checked_mul(u64::from(height))
            .context("Sixel 像素数量溢出")?,
    )
    .context("Sixel 像素数量无法转换为 usize")
}

const fn rgb332(red: u8, green: u8, blue: u8) -> u8 {
    ((red >> 5) << 5) | ((green >> 5) << 2) | (blue >> 6)
}

fn rgb332_color(index: u8) -> (u8, u8, u8) {
    (
        scale(index >> 5, 7),
        scale((index >> 2) & 0b111, 7),
        scale(index & 0b11, 3),
    )
}

fn scale(value: u8, maximum: u8) -> u8 {
    ((u16::from(value) * 255) / u16::from(maximum)) as u8
}

fn percent(value: u8) -> u8 {
    ((u16::from(value) * 100) / 255) as u8
}

struct Palette {
    used: [bool; PALETTE_COLOR_COUNT],
}

impl Palette {
    fn from_rgba(rgba: &[u8]) -> Self {
        let mut used = [false; PALETTE_COLOR_COUNT];
        for pixel in rgba.chunks_exact(4) {
            if pixel[3] >= TRANSPARENT_ALPHA_THRESHOLD {
                used[rgb332(pixel[0], pixel[1], pixel[2]) as usize] = true;
            }
        }
        Self { used }
    }

    fn indices(&self) -> impl Iterator<Item = u8> + '_ {
        (0..=u8::MAX).filter(|index| self.used[*index as usize])
    }

    fn write_definitions(&self, output: &mut Vec<u8>) {
        for index in self.indices() {
            let (red, green, blue) = rgb332_color(index);
            output.extend_from_slice(
                format!(
                    "#{index};2;{};{};{}",
                    percent(red),
                    percent(green),
                    percent(blue)
                )
                .as_bytes(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn red_pixel_has_palette_and_data() {
        let sixel = encode_rgba(&[255, 0, 0, 255], 1, 1).unwrap();
        assert_eq!(
            String::from_utf8(sixel).unwrap(),
            "\x1bP9;1;0q\"1;1;1;1#224;2;100;0;0#224@\x1b\\"
        );
    }
}
