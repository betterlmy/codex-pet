use std::fs;

use image::RgbaImage;
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn idle_animation_loops_with_original_timing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sheet.webp");
    RgbaImage::new(
        DEFAULT_FRAME_WIDTH * DEFAULT_FRAME_COLUMNS,
        DEFAULT_FRAME_HEIGHT * DEFAULT_FRAME_ROWS,
    )
    .save(&path)
    .unwrap();
    let pet = Pet::from_builtin(crate::builtin_pet("codex").unwrap(), path).unwrap();

    assert_eq!(pet.frame_at("idle", 0).unwrap().sprite_index, 0);
    assert_eq!(pet.frame_at("idle", 1680).unwrap().sprite_index, 1);
    assert_eq!(pet.frame_at("idle", 6600).unwrap().sprite_index, 0);
}

#[test]
fn app_state_animation_repeats_three_times_then_loops_idle() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sheet.webp");
    RgbaImage::new(
        DEFAULT_FRAME_WIDTH * DEFAULT_FRAME_COLUMNS,
        DEFAULT_FRAME_HEIGHT * DEFAULT_FRAME_ROWS,
    )
    .save(&path)
    .unwrap();
    let pet = Pet::from_builtin(crate::builtin_pet("codex").unwrap(), path).unwrap();
    let animation = pet.animations.get("running").unwrap();

    assert_eq!(animation.loop_start, Some(18));
    assert_eq!(animation.frames.len(), 24);
    assert_eq!(animation.frames[0].sprite_index, 56);
    assert_eq!(animation.frames[17].sprite_index, 61);
    assert_eq!(animation.frames[18].sprite_index, 0);
}

#[test]
fn custom_manifest_cannot_escape_pet_directory() {
    let dir = tempfile::tempdir().unwrap();
    let pet_dir = dir.path().join("pets").join("escape");
    fs::create_dir_all(&pet_dir).unwrap();
    fs::write(
        pet_dir.join("pet.json"),
        r#"{"spritesheetPath":"../outside.webp"}"#,
    )
    .unwrap();

    let error = Pet::load_custom("escape", dir.path()).unwrap_err();

    assert!(error.to_string().contains("必须位于"));
}
