use std::fs;

use pretty_assertions::assert_eq;

use super::*;

#[test]
fn protocol_selection_parses_all_explicit_modes() {
    assert_eq!(
        "auto".parse::<ProtocolSelection>().unwrap(),
        ProtocolSelection::Auto
    );
    assert_eq!(
        "kitty".parse::<ProtocolSelection>().unwrap(),
        ProtocolSelection::Kitty
    );
    assert_eq!(
        "kitty-file".parse::<ProtocolSelection>().unwrap(),
        ProtocolSelection::KittyFile
    );
    assert_eq!(
        "sixel".parse::<ProtocolSelection>().unwrap(),
        ProtocolSelection::Sixel
    );
}

#[test]
fn kitty_inline_transmission_contains_geometry_and_payload() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("frame.png");
    fs::write(&path, b"png").unwrap();

    let command = kitty_transmit_png(&path, 4, 3, 7).unwrap();

    assert!(command.starts_with("\x1b_Ga=T,t=d,f=100,c=4,r=3,q=2,i=7,m=0;"));
    assert!(command.contains("cG5n"));
    assert!(command.ends_with("\x1b\\"));
}
