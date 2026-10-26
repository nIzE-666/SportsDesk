//! Shared TS/Rust fixture contract: explicit aliases and exact status tokens.
use serde::Deserialize;
use std::sync::OnceLock;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
#[derive(Deserialize)]
struct Team {
    name: String,
    aliases: Vec<String>,
}
#[derive(Deserialize)]
struct Contract {
    teams: Vec<Team>,
    statuses: std::collections::HashMap<String, Vec<String>>,
}
fn contract() -> &'static Contract {
    static VALUE: OnceLock<Contract> = OnceLock::new();
    VALUE.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/shared/sportsContracts.json"))
            .expect("sports contract must be valid")
    })
}
fn name_key(name: &str) -> String {
    name.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c == 'ё' { 'е' } else { c })
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn canonical_name(name: &str) -> String {
    let key = name_key(name);
    for team in &contract().teams {
        if name_key(&team.name) == key || team.aliases.iter().any(|a| name_key(a) == key) {
            return name_key(&team.name);
        }
    }
    key
}
pub fn favorite_name(team: &str, favorites: &[String]) -> bool {
    let key = canonical_name(team);
    !key.is_empty() && favorites.iter().any(|name| canonical_name(name) == key)
}
pub fn status(values: &[&str]) -> &'static str {
    let keys: Vec<String> = values
        .iter()
        .map(|v| {
            v.to_ascii_lowercase()
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .collect()
        })
        .collect();
    for state in ["finished", "cancelled", "postponed", "live", "scheduled"] {
        if contract().statuses[state]
            .iter()
            .any(|alias| keys.contains(alias))
        {
            return state;
        }
    }
    "unknown"
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_favorite_alias_cases_match() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../../src/shared/sportsContracts.json")).unwrap();
        for case in value["favoriteCases"].as_array().unwrap() {
            assert_eq!(
                favorite_name(
                    case["team"].as_str().unwrap(),
                    &[case["favorite"].as_str().unwrap().into()]
                ),
                case["matches"].as_bool().unwrap(),
                "{case}"
            );
        }
    }
    #[test]
    fn shared_status_cases_match() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../../src/shared/sportsContracts.json")).unwrap();
        for case in value["statusCases"].as_array().unwrap() {
            assert_eq!(
                status(&[
                    case["status"].as_str().unwrap(),
                    case["text"].as_str().unwrap()
                ]),
                case["expected"].as_str().unwrap(),
                "{case}"
            );
        }
    }
}
