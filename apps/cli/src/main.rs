use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use clap::Subcommand;
use pet_assets::AssetStore;
use pet_core::app_home;
use pet_terminal::ProtocolSelection;
use pet_terminal::TerminalOptions;

#[derive(Debug, Parser)]
#[command(name = "codex-pet", version, about = "独立的 Codex 风格桌宠原型")]
struct Cli {
    #[arg(long, global = true)]
    home: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// 在当前终端中运行宠物。
    Terminal {
        #[arg(long, default_value = "codex")]
        pet: String,

        #[arg(long, default_value = "auto")]
        protocol: ProtocolSelection,

        #[arg(long, default_value_t = 144)]
        height_px: u16,
    },

    /// 列出内置和本地自定义宠物。
    List,

    /// 下载并校验宠物资源。
    Prepare {
        #[arg(default_value = "codex")]
        pet: String,
    },

    /// 输出规范化后的宠物定义。
    Inspect {
        #[arg(default_value = "codex")]
        pet: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let home = cli.home.map_or_else(app_home, Ok)?;
    let store = AssetStore::new(home);
    match cli.command {
        Command::Terminal {
            pet,
            protocol,
            height_px,
        } => pet_terminal::run(
            &store,
            &TerminalOptions {
                pet,
                protocol,
                height_px,
            },
        ),
        Command::List => {
            for pet in store.available_pets() {
                let source = if pet.builtin { "内置" } else { "自定义" };
                println!("{:<18} {:<14} {source}", pet.id, pet.display_name);
            }
            Ok(())
        }
        Command::Prepare { pet } => {
            let pet = store.load_pet(&pet)?;
            println!(
                "已准备 {}：{}",
                pet.display_name,
                pet.spritesheet_path.display()
            );
            Ok(())
        }
        Command::Inspect { pet } => {
            let pet = store.load_pet(&pet)?;
            println!("{}", serde_json::to_string_pretty(&pet)?);
            Ok(())
        }
    }
}
