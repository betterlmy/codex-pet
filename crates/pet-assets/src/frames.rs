use std::fs;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use image::GenericImageView as _;
use pet_core::Pet;

pub fn prepare_png_frames(pet: &Pet, frame_dir: &Path) -> Result<Vec<PathBuf>> {
    fs::create_dir_all(frame_dir).with_context(|| format!("创建 {}", frame_dir.display()))?;
    let expected = (0..pet.frame_count())
        .map(|index| frame_dir.join(format!("frame_{index:03}.png")))
        .collect::<Vec<_>>();
    if expected.iter().all(|path| path.is_file()) {
        return Ok(expected);
    }

    remove_stale_frames(frame_dir)?;
    let spritesheet = image::open(&pet.spritesheet_path)
        .with_context(|| format!("读取 {}", pet.spritesheet_path.display()))?;
    for row in 0..pet.rows {
        for column in 0..pet.columns {
            let index = row
                .checked_mul(pet.columns)
                .and_then(|offset| offset.checked_add(column))
                .context("宠物帧索引溢出")? as usize;
            let path = expected.get(index).context("宠物帧索引越界")?;
            let frame = spritesheet.try_view(
                column * pet.frame_width,
                row * pet.frame_height,
                pet.frame_width,
                pet.frame_height,
            )?;
            frame
                .to_image()
                .save_with_format(path, image::ImageFormat::Png)
                .with_context(|| format!("写入 {}", path.display()))?;
        }
    }
    Ok(expected)
}

fn remove_stale_frames(frame_dir: &Path) -> Result<()> {
    for entry in fs::read_dir(frame_dir).with_context(|| format!("读取 {}", frame_dir.display()))?
    {
        let path = entry?.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("frame_") && name.ends_with(".png"))
        {
            fs::remove_file(&path).with_context(|| format!("删除 {}", path.display()))?;
        }
    }
    Ok(())
}
