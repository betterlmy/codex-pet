use std::io::BufRead as _;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use std::time::Instant;

use anyhow::Context;
use anyhow::Result;
use pet_assets::AssetStore;
use pet_assets::PetSummary;
use pet_core::BehaviorController;
use pet_core::BehaviorMode;
use pet_core::BehaviorState;
use pet_core::DISABLED_PET_ID;
use pet_core::Pet;
use pet_core::PetNotification;
use pet_core::PetNotificationKind;
use pet_core::RuntimeConfig;
use pet_core::app_home;
use serde::Deserialize;
use serde::Serialize;

mod selection;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ClientCommand {
    Hello,
    SelectPet {
        pet_id: String,
    },
    SetBehaviorMode {
        mode: BehaviorMode,
    },
    SetState {
        state: BehaviorState,
    },
    SetPaused {
        paused: bool,
    },
    Advance,
    CaptureSelection {
        request_id: u64,
    },
    PreviewPet {
        request_id: u64,
        pet_id: String,
    },
    SetProxy {
        proxy_url: Option<String>,
    },
    SetPetNotification {
        kind: Option<PetNotificationKind>,
        body: Option<String>,
    },
    Shutdown,
}

#[derive(Debug)]
enum InputMessage {
    Command(ClientCommand),
    Invalid(String),
    Closed,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServerEvent<'a> {
    Ready {
        home: &'a std::path::Path,
        catalog: &'a [PetSummary],
        snapshot: Option<RuntimeSnapshot<'a>>,
    },
    Snapshot {
        snapshot: RuntimeSnapshot<'a>,
    },
    Error {
        message: String,
    },
    SelectionCaptured {
        request_id: u64,
        text: &'a str,
        method: &'static str,
    },
    SelectionFailed {
        request_id: u64,
        message: String,
    },
    PetPreview {
        request_id: u64,
        pet: &'a Pet,
    },
    PetPreviewFailed {
        request_id: u64,
        message: String,
    },
    Bye,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot<'a> {
    revision: u64,
    pet: &'a Pet,
    behavior_mode: BehaviorMode,
    state: BehaviorState,
    state_label: &'static str,
    animation: &'static str,
    paused: bool,
    notification_kind: Option<PetNotificationKind>,
    notification_body: Option<&'a str>,
    enabled: bool,
}

struct Runtime {
    home: PathBuf,
    store: AssetStore,
    config: RuntimeConfig,
    behavior: BehaviorController,
    pet: Option<Pet>,
    catalog: Vec<PetSummary>,
    revision: u64,
    notification: Option<PetNotification>,
}

impl Runtime {
    fn load() -> Result<Self> {
        let home = app_home()?;
        let proxy_url = std::env::var("CODEX_PET_PROXY_URL").ok();
        let store = AssetStore::with_proxy(home.clone(), proxy_url)?;
        let config = RuntimeConfig::load(&home)?;
        let behavior = BehaviorController::new(config.behavior_mode, config.paused);
        let catalog = store.available_pets();
        let pet = store.load_pet(&config.selected_pet).ok();
        Ok(Self {
            home,
            store,
            config,
            behavior,
            pet,
            catalog,
            revision: 1,
            notification: None,
        })
    }

    fn ready(&self) -> ServerEvent<'_> {
        ServerEvent::Ready {
            home: &self.home,
            catalog: &self.catalog,
            snapshot: self.snapshot(),
        }
    }

    fn snapshot_event(&self) -> Option<ServerEvent<'_>> {
        self.snapshot()
            .map(|snapshot| ServerEvent::Snapshot { snapshot })
    }

    fn snapshot(&self) -> Option<RuntimeSnapshot<'_>> {
        let notification = self.notification.as_ref();
        Some(RuntimeSnapshot {
            revision: self.revision,
            pet: self.pet.as_ref()?,
            behavior_mode: self.behavior.mode(),
            state: self.behavior.state(),
            state_label: notification.map_or_else(
                || self.behavior.state().label(),
                |value| value.kind().label(),
            ),
            animation: notification.map_or_else(
                || self.behavior.state().animation_name(),
                |value| value.kind().animation_name(),
            ),
            paused: self.behavior.paused(),
            notification_kind: notification.map(PetNotification::kind),
            notification_body: notification.map(PetNotification::body),
            enabled: self.config.pet_enabled,
        })
    }

    fn handle(&mut self, command: ClientCommand) -> Result<HandleResult> {
        match command {
            ClientCommand::Hello => Ok(HandleResult::Ready),
            ClientCommand::SelectPet { pet_id } => {
                if pet_id == DISABLED_PET_ID {
                    self.config.pet_enabled = false;
                    self.persist()?;
                    self.bump();
                    return Ok(HandleResult::Snapshot);
                }
                let pet = self.store.load_pet(&pet_id)?;
                self.pet = Some(pet);
                self.config.selected_pet = pet_id;
                self.config.pet_enabled = true;
                self.persist()?;
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::SetBehaviorMode { mode } => {
                self.behavior.set_mode(mode);
                self.config.behavior_mode = mode;
                self.persist()?;
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::SetState { state } => {
                self.behavior.set_state(state);
                self.config.behavior_mode = BehaviorMode::Manual;
                self.persist()?;
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::SetPaused { paused } => {
                self.behavior.set_paused(paused);
                self.config.paused = paused;
                self.persist()?;
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::Advance => {
                self.behavior.advance();
                self.config.behavior_mode = BehaviorMode::Automatic;
                self.persist()?;
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::CaptureSelection { request_id } => match selection::capture() {
                Ok(capture) => Ok(HandleResult::SelectionCaptured {
                    request_id,
                    capture,
                }),
                Err(error) => Ok(HandleResult::SelectionFailed {
                    request_id,
                    message: format!("{error:#}"),
                }),
            },
            ClientCommand::PreviewPet { request_id, pet_id } => {
                match self.store.load_pet(&pet_id) {
                    Ok(pet) => Ok(HandleResult::PetPreview { request_id, pet }),
                    Err(error) => Ok(HandleResult::PetPreviewFailed {
                        request_id,
                        message: format!("{error:#}"),
                    }),
                }
            }
            ClientCommand::SetProxy { proxy_url } => {
                self.store.set_proxy_url(proxy_url)?;
                Ok(HandleResult::None)
            }
            ClientCommand::SetPetNotification { kind, body } => {
                self.notification = kind.map(|kind| PetNotification::new(kind, body));
                self.bump();
                Ok(HandleResult::Snapshot)
            }
            ClientCommand::Shutdown => Ok(HandleResult::Shutdown),
        }
    }

    fn tick(&mut self) -> bool {
        if self
            .notification
            .as_ref()
            .is_some_and(|notification| notification.is_expired(Instant::now()))
        {
            self.notification = None;
            self.bump();
            return true;
        }
        if self.behavior.advance_if_due() {
            self.bump();
            return true;
        }
        false
    }

    fn bump(&mut self) {
        self.revision = self.revision.wrapping_add(1);
    }

    fn persist(&self) -> Result<()> {
        self.config.save(&self.home)
    }
}

enum HandleResult {
    None,
    Ready,
    Snapshot,
    SelectionCaptured {
        request_id: u64,
        capture: selection::SelectionCapture,
    },
    SelectionFailed {
        request_id: u64,
        message: String,
    },
    PetPreview {
        request_id: u64,
        pet: Pet,
    },
    PetPreviewFailed {
        request_id: u64,
        message: String,
    },
    Shutdown,
}

fn main() {
    if let Err(error) = run() {
        let _ = emit(&ServerEvent::Error {
            message: format!("{error:#}"),
        });
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut runtime = Runtime::load()?;
    emit(&runtime.ready())?;
    if runtime.pet.is_none() {
        emit(&ServerEvent::Error {
            message: format!(
                "无法加载默认宠物 {}。请检查网络或 CODEX_PET_HOME。",
                runtime.config.selected_pet
            ),
        })?;
    }

    let receiver = spawn_input_reader();
    loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(InputMessage::Command(command)) => match runtime.handle(command) {
                Ok(HandleResult::None) => {}
                Ok(HandleResult::Ready) => emit(&runtime.ready())?,
                Ok(HandleResult::Snapshot) => {
                    if let Some(event) = runtime.snapshot_event() {
                        emit(&event)?;
                    }
                }
                Ok(HandleResult::SelectionCaptured {
                    request_id,
                    capture,
                }) => emit(&ServerEvent::SelectionCaptured {
                    request_id,
                    text: &capture.text,
                    method: capture.method,
                })?,
                Ok(HandleResult::SelectionFailed {
                    request_id,
                    message,
                }) => emit(&ServerEvent::SelectionFailed {
                    request_id,
                    message,
                })?,
                Ok(HandleResult::PetPreview { request_id, pet }) => {
                    emit(&ServerEvent::PetPreview {
                        request_id,
                        pet: &pet,
                    })?
                }
                Ok(HandleResult::PetPreviewFailed {
                    request_id,
                    message,
                }) => emit(&ServerEvent::PetPreviewFailed {
                    request_id,
                    message,
                })?,
                Ok(HandleResult::Shutdown) => break,
                Err(error) => emit(&ServerEvent::Error {
                    message: format!("{error:#}"),
                })?,
            },
            Ok(InputMessage::Invalid(message)) => emit(&ServerEvent::Error { message })?,
            Ok(InputMessage::Closed) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if runtime.tick()
                    && let Some(event) = runtime.snapshot_event()
                {
                    emit(&event)?;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    emit(&ServerEvent::Bye)
}

fn spawn_input_reader() -> mpsc::Receiver<InputMessage> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let message = match line {
                Ok(line) => match serde_json::from_str(&line) {
                    Ok(command) => InputMessage::Command(command),
                    Err(error) => InputMessage::Invalid(format!("无效 IPC 命令：{error}")),
                },
                Err(error) => InputMessage::Invalid(format!("读取 IPC 命令失败：{error}")),
            };
            if sender.send(message).is_err() {
                return;
            }
        }
        let _ = sender.send(InputMessage::Closed);
    });
    receiver
}

fn emit(event: &ServerEvent<'_>) -> Result<()> {
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    serde_json::to_writer(&mut writer, event).context("序列化 IPC 事件")?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
