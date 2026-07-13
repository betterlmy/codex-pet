use std::time::Duration;
use std::time::Instant;

use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BehaviorMode {
    Automatic,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BehaviorState {
    Idle,
    MoveRight,
    Wave,
    Bounce,
    MoveLeft,
    Rest,
}

impl BehaviorState {
    #[must_use]
    pub const fn animation_name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::MoveRight => "move_right",
            Self::Wave => "wave",
            Self::Bounce => "bounce",
            Self::MoveLeft => "move_left",
            Self::Rest => "waiting",
        }
    }

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Idle => "观察中",
            Self::MoveRight => "散步中",
            Self::Wave => "打招呼",
            Self::Bounce => "活动中",
            Self::MoveLeft => "回来了",
            Self::Rest => "休息中",
        }
    }

    const fn duration(self) -> Duration {
        match self {
            Self::Idle => Duration::from_secs(12),
            Self::MoveRight | Self::MoveLeft => Duration::from_secs(7),
            Self::Wave | Self::Bounce => Duration::from_secs(4),
            Self::Rest => Duration::from_secs(10),
        }
    }
}

const AUTOMATIC_SEQUENCE: &[BehaviorState] = &[
    BehaviorState::Idle,
    BehaviorState::Wave,
    BehaviorState::MoveRight,
    BehaviorState::Idle,
    BehaviorState::Bounce,
    BehaviorState::MoveLeft,
    BehaviorState::Rest,
];

#[derive(Debug, Clone)]
pub struct BehaviorController {
    mode: BehaviorMode,
    state: BehaviorState,
    sequence_index: usize,
    state_started_at: Instant,
    paused: bool,
}

impl BehaviorController {
    #[must_use]
    pub fn new(mode: BehaviorMode, paused: bool) -> Self {
        Self {
            mode,
            state: BehaviorState::Idle,
            sequence_index: 0,
            state_started_at: Instant::now(),
            paused,
        }
    }

    #[must_use]
    pub const fn mode(&self) -> BehaviorMode {
        self.mode
    }

    #[must_use]
    pub const fn state(&self) -> BehaviorState {
        self.state
    }

    #[must_use]
    pub const fn paused(&self) -> bool {
        self.paused
    }

    #[must_use]
    pub fn state_elapsed(&self) -> Duration {
        if self.paused {
            Duration::ZERO
        } else {
            self.state_started_at.elapsed()
        }
    }

    pub fn set_mode(&mut self, mode: BehaviorMode) -> bool {
        if self.mode == mode {
            return false;
        }
        self.mode = mode;
        self.reset_clock();
        true
    }

    pub fn set_state(&mut self, state: BehaviorState) -> bool {
        self.mode = BehaviorMode::Manual;
        self.replace_state(state)
    }

    pub fn set_paused(&mut self, paused: bool) -> bool {
        if self.paused == paused {
            return false;
        }
        self.paused = paused;
        self.reset_clock();
        true
    }

    pub fn advance_if_due(&mut self) -> bool {
        if self.paused
            || self.mode == BehaviorMode::Manual
            || self.state_started_at.elapsed() < self.state.duration()
        {
            return false;
        }
        self.advance()
    }

    pub fn advance(&mut self) -> bool {
        self.mode = BehaviorMode::Automatic;
        self.sequence_index = (self.sequence_index + 1) % AUTOMATIC_SEQUENCE.len();
        self.replace_state(AUTOMATIC_SEQUENCE[self.sequence_index])
    }

    fn replace_state(&mut self, state: BehaviorState) -> bool {
        let changed = self.state != state;
        self.state = state;
        self.reset_clock();
        changed
    }

    fn reset_clock(&mut self) {
        self.state_started_at = Instant::now();
    }
}

impl Default for BehaviorController {
    fn default() -> Self {
        Self::new(BehaviorMode::Automatic, /*paused*/ false)
    }
}

#[cfg(test)]
#[path = "behavior_tests.rs"]
mod tests;
