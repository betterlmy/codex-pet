use super::*;

#[test]
fn select_pet_command_uses_camel_case_wire_fields() {
    let command: ClientCommand =
        serde_json::from_str(r#"{"type":"selectPet","petId":"dewey"}"#).unwrap();

    assert!(matches!(
        command,
        ClientCommand::SelectPet { pet_id } if pet_id == "dewey"
    ));
}

#[test]
fn capture_selection_command_uses_request_id() {
    let command: ClientCommand =
        serde_json::from_str(r#"{"type":"captureSelection","requestId":42}"#).unwrap();

    assert!(matches!(
        command,
        ClientCommand::CaptureSelection { request_id: 42 }
    ));
}

#[test]
fn set_proxy_command_accepts_authenticated_socks_url() {
    let command: ClientCommand = serde_json::from_str(
        r#"{"type":"setProxy","proxyUrl":"socks5://user:secret@127.0.0.1:1080"}"#,
    )
    .unwrap();

    assert!(matches!(
        command,
        ClientCommand::SetProxy { proxy_url: Some(value) }
            if value == "socks5://user:secret@127.0.0.1:1080"
    ));
}
