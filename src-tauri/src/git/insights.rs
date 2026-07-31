use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{Datelike, Local, TimeZone, Timelike};
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepositoryInsights {
    pub repository_name: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub total_commits: usize,
    pub contributor_count: usize,
    pub branch_count: usize,
    pub tag_count: usize,
    pub daily_contributions: Vec<DailyContribution>,
    pub contributors: Vec<AuthorActivity>,
    pub timeline: Vec<TimelineBucket>,
    pub milestones: Vec<TagMilestone>,
    pub recent_commits: Vec<CommitSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyContribution { pub date: String, pub count: usize }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorActivity {
    pub name: String,
    pub email: String,
    pub commit_count: usize,
    pub active_days: usize,
    pub first_date: String,
    pub last_date: String,
    pub activity: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineBucket {
    pub period: String,
    pub commits: usize,
    pub contributors: usize,
    pub cumulative_commits: usize,
    pub cumulative_contributors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagMilestone {
    pub name: String,
    pub hash: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitSummary {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub parent_count: usize,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone)]
struct CommitRecord {
    oid: Oid,
    author: String,
    email: String,
    timestamp: i64,
    message: String,
    parent_count: usize,
    refs: Vec<String>,
}

pub fn collect_insights(repo: &Repository) -> AppResult<RepositoryInsights> {
    let name = repo.workdir().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "repository".into());
    let mut records: HashMap<Oid, CommitRecord> = HashMap::new();
    let mut branch_count = 0;
    let mut tag_count = 0;
    let mut milestones = Vec::new();
    let refs = repo.references_glob("refs/heads/*")?.chain(repo.references_glob("refs/remotes/*")?).chain(repo.references_glob("refs/tags/*")?);
    for reference in refs.flatten() {
        let Some(name) = reference.name().map(str::to_owned) else { continue };
        if name.starts_with("refs/heads/") || name.starts_with("refs/remotes/") { branch_count += 1; }
        if name.starts_with("refs/tags/") { tag_count += 1; }
        let Ok(commit) = reference.peel_to_commit() else { continue };
        let mut stack = vec![(commit.id(), vec![name.clone()])];
        while let Some((oid, hit_refs)) = stack.pop() {
            if let Some(existing) = records.get_mut(&oid) { for r in &hit_refs { if !existing.refs.contains(r) { existing.refs.push(r.clone()); } } continue; }
            let Ok(c) = repo.find_commit(oid) else { continue };
            let mut record = CommitRecord { oid, author: c.author().name().unwrap_or("Unknown").to_owned(), email: normalize_email(c.author().email().unwrap_or("")), timestamp: c.time().seconds(), message: c.summary().unwrap_or("").to_owned(), parent_count: c.parent_count(), refs: hit_refs };
            record.refs.sort();
            records.insert(oid, record);
            for parent in c.parents() { stack.push((parent.id(), Vec::new())); }
        }
        if name.starts_with("refs/tags/") {
            if let Ok(c) = reference.peel_to_commit() { milestones.push(TagMilestone { name: name.trim_start_matches("refs/tags/").to_owned(), hash: c.id().to_string(), date: date_for(c.time().seconds()), message: c.summary().unwrap_or("").to_owned() }); }
        }
    }
    let mut records: Vec<_> = records.into_values().collect();
    records.sort_by_key(|r| (r.timestamp, r.oid));
    let mut result = aggregate(&records);
    result.repository_name = name;
    result.branch_count = branch_count;
    result.tag_count = tag_count;
    milestones.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.name.cmp(&b.name)));
    result.milestones = milestones;
    Ok(result)
}

pub fn normalize_email(email: &str) -> String { email.trim().to_lowercase() }
fn date_for(ts: i64) -> String { Local.timestamp_opt(ts, 0).single().map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default() }
fn month_for(ts: i64) -> String { Local.timestamp_opt(ts, 0).single().map(|d| d.format("%Y-%m").to_string()).unwrap_or_default() }

fn aggregate(records: &[CommitRecord]) -> RepositoryInsights {
    let mut unique = HashMap::new();
    for record in records { unique.entry(record.oid).or_insert_with(|| record.clone()); }
    let mut records: Vec<_> = unique.into_values().collect();
    records.sort_by_key(|record| (record.timestamp, record.oid));
    let records = records.as_slice();
    let mut daily = BTreeMap::<String, usize>::new();
    let mut daily_authors = BTreeMap::<String, HashSet<String>>::new();
    let mut author_map: HashMap<String, AuthorActivity> = HashMap::new();
    let mut month_map: BTreeMap<String, (usize, HashSet<String>)> = BTreeMap::new();
    for r in records {
        let date = date_for(r.timestamp);
        let dt = Local.timestamp_opt(r.timestamp, 0).single();
        *daily.entry(date.clone()).or_default() += 1;
        let key = if r.email.is_empty() { r.author.to_lowercase() } else { r.email.clone() };
        daily_authors.entry(date.clone()).or_default().insert(key.clone());
        let a = author_map.entry(key.clone()).or_insert_with(|| AuthorActivity { name: r.author.clone(), email: r.email.clone(), commit_count: 0, active_days: 0, first_date: date.clone(), last_date: date.clone(), activity: vec![0; 168] });
        a.commit_count += 1; a.first_date = a.first_date.clone().min(date.clone()); a.last_date = a.last_date.clone().max(date.clone());
        if let Some(dt) = dt { a.activity[dt.weekday().num_days_from_monday() as usize * 24 + dt.hour() as usize] += 1; }
        month_map.entry(month_for(r.timestamp)).or_default().0 += 1;
        month_map.entry(month_for(r.timestamp)).or_default().1.insert(key);
    }
    for a in author_map.values_mut() {
        let key = if a.email.is_empty() { a.name.to_lowercase() } else { a.email.clone() };
        a.active_days = daily_authors.values().filter(|authors| authors.contains(&key)).count();
    }
    let mut cumulative = 0; let mut cumulative_authors = HashSet::new();
    let timeline = month_map.into_iter().map(|(period, (commits, authors))| { cumulative += commits; cumulative_authors.extend(authors.iter().cloned()); TimelineBucket { period, commits, contributors: authors.len(), cumulative_commits: cumulative, cumulative_contributors: cumulative_authors.len() } }).collect();
    let daily_contributions = daily.into_iter().map(|(date, count)| DailyContribution { date, count }).collect();
    let mut contributors: Vec<_> = author_map.into_values().collect(); contributors.sort_by(|a,b| b.commit_count.cmp(&a.commit_count).then_with(|| a.email.cmp(&b.email)));
    let recent_commits = records.iter().rev().take(20).map(|r| CommitSummary { hash: r.oid.to_string(), author: r.author.clone(), email: r.email.clone(), date: date_for(r.timestamp), message: r.message.clone(), parent_count: r.parent_count, refs: r.refs.clone() }).collect();
    RepositoryInsights { start_date: records.first().map(|r| date_for(r.timestamp)), end_date: records.last().map(|r| date_for(r.timestamp)), total_commits: records.len(), contributor_count: contributors.len(), daily_contributions, contributors, timeline, milestones: Vec::new(), recent_commits, ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(n: u8, email: &str, ts: i64, parents: usize) -> CommitRecord { CommitRecord { oid: Oid::from_bytes(&[n; 20]).unwrap(), author: "Alice".into(), email: normalize_email(email), timestamp: ts, message: "commit".into(), parent_count: parents, refs: vec![] } }
    #[test] fn normalizes_email_and_deduplicates_records() { let r = vec![record(1, " Alice@EXAMPLE.COM ", 0, 0), record(1, "alice@example.com", 0, 0), record(2, "bob@example.com", 86400, 2)]; let x = aggregate(&r); assert_eq!(normalize_email(" A@B.COM "), "a@b.com"); assert_eq!(x.total_commits, 2, "caller supplies unique OIDs"); assert_eq!(x.contributors.len(), 2); assert_eq!(x.recent_commits[0].parent_count, 2); }
    #[test] fn empty_repository_is_safe() { let x = aggregate(&[]); assert_eq!(x.total_commits, 0); assert!(x.daily_contributions.is_empty()); assert!(x.timeline.is_empty()); }
    #[test] fn timeline_and_timezone_buckets_are_stable() { let x = aggregate(&[record(1, "a@x", 0, 0), record(2, "a@x", 2678400, 0)]); assert_eq!(x.daily_contributions.len(), 2); assert_eq!(x.timeline[0].cumulative_commits, 1); assert_eq!(x.timeline[1].cumulative_commits, 2); }
}
