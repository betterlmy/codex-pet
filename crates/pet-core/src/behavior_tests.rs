use super::*;

#[test]
fn manual_state_disables_automatic_behavior() {
    let mut controller = BehaviorController::default();

    assert!(controller.set_state(BehaviorState::Wave));

    assert_eq!(controller.mode(), BehaviorMode::Manual);
    assert_eq!(controller.state(), BehaviorState::Wave);
    assert!(!controller.advance_if_due());
}

#[test]
fn explicit_advance_restores_automatic_behavior() {
    let mut controller = BehaviorController::new(BehaviorMode::Manual, /*paused*/ false);

    controller.advance();

    assert_eq!(controller.mode(), BehaviorMode::Automatic);
    assert_eq!(controller.state(), BehaviorState::Wave);
}
