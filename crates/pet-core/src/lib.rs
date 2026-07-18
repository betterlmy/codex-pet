//! Shared pet definitions, animation selection, and autonomous behavior.

mod behavior;
mod catalog;
mod config;
mod model;
mod notification;

pub use behavior::BehaviorController;
pub use behavior::BehaviorMode;
pub use behavior::BehaviorState;
pub use catalog::BUILTIN_PETS;
pub use catalog::BuiltinPet;
pub use catalog::DEFAULT_FRAME_COLUMNS;
pub use catalog::DEFAULT_FRAME_HEIGHT;
pub use catalog::DEFAULT_FRAME_ROWS;
pub use catalog::DEFAULT_FRAME_WIDTH;
pub use catalog::SPRITESHEET_HEIGHT;
pub use catalog::SPRITESHEET_WIDTH;
pub use catalog::builtin_pet;
pub use config::RuntimeConfig;
pub use config::app_home;
pub use model::Animation;
pub use model::AnimationFrame;
pub use model::CUSTOM_PET_PREFIX;
pub use model::FrameTick;
pub use model::Pet;
pub use model::custom_pet_selector;
pub use notification::PetNotification;
pub use notification::PetNotificationKind;

pub const DEFAULT_PET_ID: &str = "codex";
pub const DISABLED_PET_ID: &str = "disabled";
