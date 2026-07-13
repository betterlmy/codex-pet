use std::collections::BTreeMap;
use std::fs;

use image::Rgba;
use image::RgbaImage;
use pet_core::Animation;

use super::*;

#[test]
fn frame_cache_slices_custom_spritesheet() {
    let dir = tempfile::tempdir().unwrap();
    let sheet_path = dir.path().join("sheet.png");
    let sheet = RgbaImage::from_fn(2, 1, |x, _| {
        if x == 0 {
            Rgba([255, 0, 0, 255])
        } else {
            Rgba([0, 255, 0, 255])
        }
    });
    sheet.save(&sheet_path).unwrap();
    let pet = Pet {
        id: "tiny".to_string(),
        display_name: "Tiny".to_string(),
        description: String::new(),
        spritesheet_path: sheet_path,
        frame_width: 1,
        frame_height: 1,
        columns: 2,
        rows: 1,
        frame_count: 2,
        animations: BTreeMap::<String, Animation>::new(),
    };

    let frames = prepare_png_frames(&pet, &dir.path().join("frames")).unwrap();

    assert_eq!(frames.len(), 2);
    assert_eq!(
        *image::open(&frames[0]).unwrap().to_rgba8().get_pixel(0, 0),
        Rgba([255, 0, 0, 255])
    );
    assert_eq!(
        *image::open(&frames[1]).unwrap().to_rgba8().get_pixel(0, 0),
        Rgba([0, 255, 0, 255])
    );
}

#[test]
fn available_pets_include_valid_custom_manifests() {
    let dir = tempfile::tempdir().unwrap();
    let pet_dir = dir.path().join("pets").join("tiny");
    fs::create_dir_all(&pet_dir).unwrap();
    RgbaImage::new(1, 1)
        .save(pet_dir.join("sheet.png"))
        .unwrap();
    fs::write(
        pet_dir.join("pet.json"),
        r#"{
            "displayName": "Tiny",
            "spritesheetPath": "sheet.png",
            "frame": {"width":1,"height":1,"columns":1,"rows":1},
            "animations": {"idle":{"frames":[0],"fps":1}}
        }"#,
    )
    .unwrap();
    let store = AssetStore::new(dir.path().to_path_buf());

    let pets = store.available_pets();

    assert!(pets.iter().any(|pet| pet.id == "custom:tiny"));
}
