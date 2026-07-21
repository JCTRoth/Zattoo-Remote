//! MX3 → Zattoo key mapping with user-customizable configuration.
//!
//! Loads a default mapping and allows overriding via JSON configuration.
//! Maps physical remote keys to Zattoo web-app actions.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a single key mapping entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMapping {
    /// Rdev/Raw key identifier (e.g., "UpArrow", "Return", "Key1")
    pub key: String,
    /// Action identifier sent to the frontend (e.g., "up", "ok", "digit_1")
    pub action: String,
    /// Display label for OSD
    pub label: String,
    /// Optional: Zattoo-specific DOM action (e.g., "click:#search-button")
    pub zattoo_action: Option<String>,
}

/// Configuration for channel favorites assigned to color keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteChannel {
    /// Display name
    pub name: String,
    /// Channel name / search term for Zattoo (fallback)
    pub channel: String,
    /// Channel slug for URL-based navigation (e.g. "zdf", "daserste")
    pub slug: Option<String>,
    /// Color key this favorite is bound to (red, green, yellow, blue)
    pub color: String,
}

/// Maps a digit sequence (e.g. "1", "25", "100") to a Zattoo channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMapEntry {
    /// Display name shown in OSD
    pub name: String,
    /// Search term used in Zattoo's search field (fallback)
    pub search: String,
    /// Channel slug for URL-based navigation (e.g. "daserste", "zdf")
    pub slug: Option<String>,
}

/// Full key mapping configuration, loadable from JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMappingConfig {
    pub version: String,
    /// Base URL for Zattoo or white-label portal (e.g. "https://zattoo.com")
    pub base_url: Option<String>,
    /// Region prefix ("de", "at", "ch", "int")
    pub region: Option<String>,
    pub mappings: Vec<KeyMapping>,
    pub favorites: Vec<FavoriteChannel>,
    /// Maps digit sequences → channel info (e.g. "1" → { name: "Das Erste", search: "Das Erste" })
    pub channel_map: HashMap<String, ChannelMapEntry>,
    /// Timeout in milliseconds for channel digit input (default 2000)
    pub channel_input_timeout_ms: u64,
    /// Volume step as a percentage (default 5)
    pub volume_step: u8,
}

/// Runtime key mapper that resolves raw key events to Zattoo actions.
pub struct KeyMapper {
    config: KeyMappingConfig,
    /// Fast lookup map: raw key name → (action, label, zattoo_action)
    lookup: HashMap<String, (String, String, Option<String>)>,
}

impl KeyMapper {
    pub fn new() -> Self {
        Self {
            config: KeyMappingConfig {
                version: "1.0".into(),
                base_url: None,
                region: None,
                mappings: Vec::new(),
                favorites: Vec::new(),
                channel_map: HashMap::new(),
                channel_input_timeout_ms: 2000,
                volume_step: 5,
            },
            lookup: HashMap::new(),
        }
    }

    /// Load the built-in default MX3 mapping.
    pub fn load_default_mapping(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let defaults = include_str!("../../src/key-config.json");
        self.load_custom_mapping(defaults)
    }

    /// Load mapping from a JSON string (user-provided or default).
    pub fn load_custom_mapping(
        &mut self,
        json: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let config: KeyMappingConfig = serde_json::from_str(json)?;
        self.config = config;
        self.rebuild_lookup();
        Ok(())
    }

    /// Rebuild the fast lookup hashmap from the current config.
    fn rebuild_lookup(&mut self) {
        self.lookup.clear();
        for mapping in &self.config.mappings {
            self.lookup.insert(
                mapping.key.clone(),
                (
                    mapping.action.clone(),
                    mapping.label.clone(),
                    mapping.zattoo_action.clone(),
                ),
            );
        }
    }

    /// Look up the action for a given raw key name.
    /// Returns (action, label, zattoo_action) if found.
    pub fn lookup_key(&self, raw_key: &str) -> Option<&(String, String, Option<String>)> {
        self.lookup.get(raw_key)
    }

    /// Get all configured favorites.
    pub fn get_favorites(&self) -> &[FavoriteChannel] {
        &self.config.favorites
    }

    /// Get the channel input timeout.
    pub fn channel_input_timeout_ms(&self) -> u64 {
        self.config.channel_input_timeout_ms
    }

    /// Get the volume step.
    pub fn volume_step(&self) -> u8 {
        self.config.volume_step
    }

    /// Export the current mapping as a JSON string.
    pub fn export_mapping_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(&self.config)
    }

    /// Get a favorite channel by color key.
    pub fn get_favorite_by_color(&self, color: &str) -> Option<&FavoriteChannel> {
        self.config
            .favorites
            .iter()
            .find(|f| f.color.eq_ignore_ascii_case(color))
    }
}

impl Serialize for KeyMapper {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.config.serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_mapping_loads() {
        let mut mapper = KeyMapper::new();
        assert!(mapper.load_default_mapping().is_ok());
        assert!(!mapper.lookup.is_empty());
    }

    #[test]
    fn test_lookup_key() {
        let mut mapper = KeyMapper::new();
        mapper.load_default_mapping().unwrap();
        let result = mapper.lookup_key("UpArrow");
        assert!(result.is_some());
        let (action, label, _) = result.unwrap();
        assert_eq!(action, "up");
        assert_eq!(label, "▲ Up");
    }
}
