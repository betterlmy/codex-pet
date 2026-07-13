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
