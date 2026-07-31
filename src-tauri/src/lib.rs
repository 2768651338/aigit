mod ai;
mod commands;
mod config;
mod error;
mod git;

use commands::{ai_cmd, config_cmd, git_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // Git commands — repo / status / diff / commit
            git_cmd::discover_repo,
            git_cmd::init_repo,
            git_cmd::clone_repo,
            git_cmd::get_repo_info,
            git_cmd::get_repository_insights,
            git_cmd::get_status,
            git_cmd::get_workdir_diff,
            git_cmd::get_staged_diff,
            git_cmd::stage_files,
            git_cmd::stage_all,
            git_cmd::unstage_files,
            git_cmd::commit,
            git_cmd::amend_message,
            git_cmd::apply_patch_to_index,
            git_cmd::apply_patch_to_index_reverse,
            // Git commands — branches / log
            git_cmd::list_branches,
            git_cmd::create_branch,
            git_cmd::switch_branch,
            git_cmd::delete_branch,
            git_cmd::get_log,
            git_cmd::get_commit_diff,
            git_cmd::list_files,
            // Git commands — remote
            git_cmd::push,
            git_cmd::pull,
            git_cmd::discard_files,
            // Git commands — stash
            git_cmd::list_stashes,
            git_cmd::stash_save,
            git_cmd::stash_apply,
            git_cmd::stash_pop,
            git_cmd::stash_drop,
            // Git commands — tags
            git_cmd::list_tags,
            git_cmd::create_tag,
            git_cmd::delete_tag,
            // Git commands — submodules
            git_cmd::list_submodules,
            git_cmd::update_submodule,
            git_cmd::add_submodule,
            git_cmd::remove_submodule,
            // Git commands — merge / rebase
            git_cmd::merge_branch,
            git_cmd::rebase_branch,
            git_cmd::abort_merge,
            git_cmd::abort_rebase,
            git_cmd::continue_merge,
            git_cmd::continue_rebase,
            git_cmd::skip_rebase,
            git_cmd::is_merging,
            git_cmd::is_rebasing,
            git_cmd::resolve_ours,
            git_cmd::resolve_theirs,
            git_cmd::list_conflicted_files,
            // Git commands — history (commit-level operations)
            git_cmd::checkout_commit,
            git_cmd::revert_commit,
            git_cmd::cherry_pick_commit,
            git_cmd::reset_to_commit,
            // AI commands
            ai_cmd::generate_commit_message,
            ai_cmd::review_code,
            ai_cmd::repo_chat,
            ai_cmd::get_default_prompts,
            // Config commands
            config_cmd::get_config,
            config_cmd::save_config,
            config_cmd::add_recent_repo,
            config_cmd::set_open_repos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aigit application");
}
