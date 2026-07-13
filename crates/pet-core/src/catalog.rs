//! Built-in catalog compatible with the Codex pet spritesheets.

use serde::Serialize;

pub const DEFAULT_FRAME_WIDTH: u32 = 192;
pub const DEFAULT_FRAME_HEIGHT: u32 = 208;
pub const DEFAULT_FRAME_COLUMNS: u32 = 8;
pub const DEFAULT_FRAME_ROWS: u32 = 9;
pub const SPRITESHEET_WIDTH: u32 = DEFAULT_FRAME_WIDTH * DEFAULT_FRAME_COLUMNS;
pub const SPRITESHEET_HEIGHT: u32 = DEFAULT_FRAME_HEIGHT * DEFAULT_FRAME_ROWS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinPet {
    pub id: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub spritesheet_file: &'static str,
}

pub const BUILTIN_PETS: &[BuiltinPet] = &[
    BuiltinPet {
        id: "codex",
        display_name: "Codex",
        description: "The original Codex companion",
        spritesheet_file: "codex-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "dewey",
        display_name: "Dewey",
        description: "A tidy duck for calm workspace days",
        spritesheet_file: "dewey-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "fireball",
        display_name: "Fireball",
        description: "Hot path energy for fast iteration",
        spritesheet_file: "fireball-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "rocky",
        display_name: "Rocky",
        description: "A steady rock when the diff gets large",
        spritesheet_file: "rocky-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "seedy",
        display_name: "Seedy",
        description: "Small green shoots for new ideas",
        spritesheet_file: "seedy-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "stacky",
        display_name: "Stacky",
        description: "A balanced stack for deep work",
        spritesheet_file: "stacky-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "bsod",
        display_name: "BSOD",
        description: "A tiny blue-screen gremlin",
        spritesheet_file: "bsod-spritesheet-v4.webp",
    },
    BuiltinPet {
        id: "null-signal",
        display_name: "Null Signal",
        description: "Quiet signal from the void",
        spritesheet_file: "null-signal-spritesheet-v4.webp",
    },
];

#[must_use]
pub fn builtin_pet(id: &str) -> Option<BuiltinPet> {
    BUILTIN_PETS.iter().copied().find(|pet| pet.id == id)
}
