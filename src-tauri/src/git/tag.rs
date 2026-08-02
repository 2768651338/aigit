use git2::{Repository, Signature};

use crate::error::{AppError, AppResult};

use super::TagInfo;

/// List all tags in the repository, sorted by name ascending.
///
/// Returns both lightweight and annotated tags. For annotated tags we read
/// the tag object to extract the tagger and annotation message; for
/// lightweight tags we fall back to the referenced commit.
pub fn list_tags(repo: &Repository) -> AppResult<Vec<TagInfo>> {
    let mut entries = Vec::new();
    let names = repo.tag_names(None)?;

    for name_opt in names.iter() {
        let Some(name) = name_opt else {
            continue;
        };
        let name = name.to_string();

        // Resolve the tag ref to a target OID.
        let ref_name = format!("refs/tags/{name}");
        let Ok(reference) = repo.find_reference(&ref_name) else {
            continue;
        };

        // Annotated tags point to a tag object; lightweight tags point
        // directly to a commit.
        let (target_oid, is_annotated, annotation, tagger) = match reference.target() {
            Some(oid) => match repo.find_tag(oid) {
                Ok(tag) => {
                    let tagger = tag.tagger().map(|s| {
                        let name = s.name().unwrap_or("").to_string();
                        let email = s.email().unwrap_or("").to_string();
                        if email.is_empty() {
                            name
                        } else {
                            format!("{name} <{email}>")
                        }
                    });
                    let annotation = tag.message().unwrap_or("").to_string();
                    (tag.target_id(), true, annotation, tagger)
                }
                Err(_) => (oid, false, String::new(), None),
            },
            None => continue,
        };

        let Ok(target_commit) = repo.find_commit(target_oid) else {
            continue;
        };

        let hash = target_commit.id().to_string();
        let short_hash = hash.get(..7).unwrap_or(&hash).to_string();
        let target_message = target_commit.summary().unwrap_or("").to_string();
        let target_date = target_commit.time().seconds();

        entries.push(TagInfo {
            name,
            target_hash: hash,
            short_hash,
            target_message,
            target_date,
            is_annotated,
            annotation,
            tagger,
        });
    }

    // Sort by name (case-insensitive).
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    Ok(entries)
}

/// Create a new tag pointing at HEAD.
///
/// - If `message` is `Some`, creates an annotated tag (signed-lightweight off).
/// - If `message` is `None`, creates a lightweight tag.
pub fn create_tag(repo: &Repository, name: &str, message: Option<&str>) -> AppResult<String> {
    // Reject existing tag names with a friendly error.
    if repo.find_reference(&format!("refs/tags/{name}")).is_ok() {
        return Err(AppError::General(format!("标签 '{name}' 已存在")));
    }

    let head = repo.head()?;
    let target = head.peel_to_commit()?;

    let oid = match message {
        Some(msg) if !msg.trim().is_empty() => {
            let sig = repo
                .signature()
                .or_else(|_| Signature::now("aigit", "aigit@local"))?;
            repo.tag(name, &target.into_object(), &sig, msg, false)?
        }
        _ => repo.tag_lightweight(name, &target.into_object(), false)?,
    };

    Ok(oid.to_string())
}

/// Delete a tag by name (local only — does not push deletions to remotes).
pub fn delete_tag(repo: &Repository, name: &str) -> AppResult<()> {
    repo.tag_delete(name)?;
    Ok(())
}
