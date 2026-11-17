//! Project sync planner — pure, deterministic, unit-tested.
//!
//! Three snapshots go in, a list of actions comes out. No I/O here: the engine in
//! `cloud.rs` gathers the snapshots and executes the plan. Keeping the decision logic pure is
//! what lets every edge case below be tested in isolation.
//!
//! Model (three-way, per project — the classic "base / mine / theirs"):
//!   * `local`  — what is on this computer now (content hash)
//!   * `remote` — what the server has now (revision number; tombstoned or not)
//!   * `known`  — the common base: the revision + content hash both sides agreed on at the
//!                last successful sync
//! A side "changed" if it differs from the base. Writes to the server are compare-and-swap
//! on the base revision, so a plan made from a stale view fails safely instead of
//! overwriting someone else's newer version (the executor then re-plans that project).

use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq)]
pub struct LocalDoc {
    pub hash: String,
    /// last modification time of the local file (ms) — only used to pick a winner
    pub mtime: u64,
    /// a project with no items: never worth creating in the cloud
    pub empty: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteMeta {
    pub rev: i64,
    pub deleted: bool,
    pub updated_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Known {
    pub rev: i64,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Create or update the server copy from ours. `base` = the revision our change is based
    /// on (CAS); `None` = the row must not exist yet (insert).
    Push { id: String, base: Option<i64> },
    /// Take the server copy (it changed, ours didn't).
    Pull { id: String },
    /// Both sides changed (or we have no common base): fetch the server copy and decide by
    /// content — identical → just record it; different → newest edit wins, the other is
    /// kept in local version history.
    Resolve { id: String },
    /// Deleted on another computer and untouched here → remove the local file.
    DeleteLocal { id: String },
    /// Deleted here and untouched on the server since → tombstone it (CAS on `rev`).
    DeleteRemote { id: String, rev: i64 },
    /// Both sides agree it's gone → drop the bookkeeping.
    Forget { id: String },
}

pub fn plan(local: &HashMap<String, LocalDoc>, remote: &HashMap<String, RemoteMeta>, known: &HashMap<String, Known>) -> Vec<Action> {
    let ids: BTreeSet<&String> = local.keys().chain(remote.keys()).chain(known.keys()).collect();
    let mut out = Vec::new();

    for id in ids {
        let id_s = id.clone();
        let l = local.get(id);
        let r = remote.get(id);
        let live = r.filter(|r| !r.deleted);
        let k = known.get(id).filter(|k| k.rev > 0);

        match (l, live, k) {
            // ---- exists on both sides
            (Some(l), Some(r), Some(k)) => {
                let mine = l.hash != k.hash;
                let theirs = r.rev != k.rev;
                match (mine, theirs) {
                    (false, false) => {}
                    (true, false) => out.push(Action::Push { id: id_s, base: Some(r.rev) }),
                    (false, true) => out.push(Action::Pull { id: id_s }),
                    (true, true) => out.push(Action::Resolve { id: id_s }),
                }
            }
            (Some(_), Some(_), None) => out.push(Action::Resolve { id: id_s }),

            // ---- only here (never on the server, or tombstoned there)
            (Some(l), None, k) => {
                let tomb = r.filter(|r| r.deleted);
                let edited_since = k.map(|k| k.hash != l.hash).unwrap_or(true);
                match (k, edited_since) {
                    // we had it in sync and the server deleted it → follow the deletion
                    (Some(_), false) => out.push(Action::DeleteLocal { id: id_s }),
                    // new here, or edited after the other computer deleted it → (re)publish
                    _ if !l.empty => out.push(Action::Push { id: id_s, base: tomb.map(|t| t.rev) }),
                    _ => {}
                }
            }

            // ---- only on the server
            (None, Some(r), k) => match k {
                // deleted here, and nobody touched it on the server since → delete there too
                Some(k) if k.rev == r.rev => out.push(Action::DeleteRemote { id: id_s, rev: r.rev }),
                // new on the server, or edited there after we deleted it → bring it back
                _ => out.push(Action::Pull { id: id_s }),
            },

            // ---- gone everywhere
            (None, None, Some(_)) => out.push(Action::Forget { id: id_s }),
            (None, None, None) => {}
        }
    }
    out
}

/// Conflict winner: the newer edit. Ties go to the server copy (it's already shared).
pub fn remote_wins(local_mtime: u64, remote_updated_ms: u64) -> bool {
    remote_updated_ms >= local_mtime
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(hash: &str) -> LocalDoc {
        LocalDoc { hash: hash.into(), mtime: 1000, empty: false }
    }
    fn r(rev: i64) -> RemoteMeta {
        RemoteMeta { rev, deleted: false, updated_ms: 1000 }
    }
    fn tomb(rev: i64) -> RemoteMeta {
        RemoteMeta { rev, deleted: true, updated_ms: 1000 }
    }
    fn k(rev: i64, hash: &str) -> Known {
        Known { rev, hash: hash.into() }
    }
    fn one(local: Option<LocalDoc>, remote: Option<RemoteMeta>, known: Option<Known>) -> Vec<Action> {
        let id = "p".to_string();
        let mut lm = HashMap::new();
        let mut rm = HashMap::new();
        let mut km = HashMap::new();
        if let Some(x) = local {
            lm.insert(id.clone(), x);
        }
        if let Some(x) = remote {
            rm.insert(id.clone(), x);
        }
        if let Some(x) = known {
            km.insert(id.clone(), x);
        }
        plan(&lm, &rm, &km)
    }
    fn p() -> String {
        "p".into()
    }

    #[test]
    fn in_sync_does_nothing() {
        assert!(one(Some(l("a")), Some(r(3)), Some(k(3, "a"))).is_empty());
    }

    #[test]
    fn local_edit_pushes_with_cas_on_server_rev() {
        assert_eq!(one(Some(l("b")), Some(r(3)), Some(k(3, "a"))), vec![Action::Push { id: p(), base: Some(3) }]);
    }

    #[test]
    fn remote_edit_pulls() {
        assert_eq!(one(Some(l("a")), Some(r(4)), Some(k(3, "a"))), vec![Action::Pull { id: p() }]);
    }

    #[test]
    fn both_edited_resolves() {
        assert_eq!(one(Some(l("b")), Some(r(4)), Some(k(3, "a"))), vec![Action::Resolve { id: p() }]);
    }

    #[test]
    fn first_sign_in_with_both_sides_present_resolves_by_content() {
        assert_eq!(one(Some(l("a")), Some(r(7)), None), vec![Action::Resolve { id: p() }]);
    }

    #[test]
    fn new_local_project_is_inserted() {
        assert_eq!(one(Some(l("a")), None, None), vec![Action::Push { id: p(), base: None }]);
    }

    #[test]
    fn empty_new_project_is_not_published() {
        let empty = LocalDoc { empty: true, ..l("a") };
        assert!(one(Some(empty), None, None).is_empty());
    }

    #[test]
    fn deleted_elsewhere_and_untouched_here_is_deleted_here() {
        assert_eq!(one(Some(l("a")), Some(tomb(5)), Some(k(4, "a"))), vec![Action::DeleteLocal { id: p() }]);
    }

    #[test]
    fn deleted_elsewhere_but_edited_here_is_revived_with_cas_on_tombstone() {
        assert_eq!(one(Some(l("b")), Some(tomb(5)), Some(k(4, "a"))), vec![Action::Push { id: p(), base: Some(5) }]);
    }

    #[test]
    fn new_remote_project_is_pulled() {
        assert_eq!(one(None, Some(r(1)), None), vec![Action::Pull { id: p() }]);
    }

    #[test]
    fn deleted_here_and_untouched_remotely_is_deleted_remotely() {
        assert_eq!(one(None, Some(r(3)), Some(k(3, "a"))), vec![Action::DeleteRemote { id: p(), rev: 3 }]);
    }

    #[test]
    fn deleted_here_but_edited_remotely_comes_back() {
        assert_eq!(one(None, Some(r(4)), Some(k(3, "a"))), vec![Action::Pull { id: p() }]);
    }

    #[test]
    fn gone_everywhere_is_forgotten() {
        assert_eq!(one(None, Some(tomb(9)), Some(k(8, "a"))), vec![Action::Forget { id: p() }]);
        assert_eq!(one(None, None, Some(k(8, "a"))), vec![Action::Forget { id: p() }]);
    }

    #[test]
    fn legacy_state_without_rev_is_treated_as_unknown() {
        assert_eq!(one(Some(l("a")), Some(r(2)), Some(k(0, "a"))), vec![Action::Resolve { id: p() }]);
    }

    #[test]
    fn plan_is_deterministic_and_covers_every_project() {
        let mut lm = HashMap::new();
        let mut rm = HashMap::new();
        lm.insert("b".to_string(), l("x"));
        rm.insert("a".to_string(), r(1));
        let a = plan(&lm, &rm, &HashMap::new());
        let b = plan(&lm, &rm, &HashMap::new());
        assert_eq!(a, b);
        assert_eq!(a.len(), 2);
    }

    #[test]
    fn newest_edit_wins_ties_go_to_server() {
        assert!(remote_wins(1000, 2000));
        assert!(!remote_wins(3000, 2000));
        assert!(remote_wins(2000, 2000));
    }
}
