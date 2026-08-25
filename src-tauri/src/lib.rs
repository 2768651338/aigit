mod ai;
mod chat_history;
mod code_index;
mod commands;
mod config;
mod error;
mod git;
mod github;
mod review;

use chat_history::{
    clear_chat_history, delete_chat_session, load_chat_sessions, save_chat_session,
};
use commands::{ai_cmd, config_cmd, git_cmd, github_cmd, index_cmd, updater_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .manage(ai::stream::CancellationRegistry::default())
        .manage(git_cmd::GitTaskRegistry::default())
        .manage(code_index::IndexManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        // The updater plugin is registered without endpoints. Releases stay update-disabled
        // until CI injects a real HTTPS endpoint and matching public key at build time.
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            git_cmd::add_gitignore_entries,
            git_cmd::commit,
            git_cmd::amend,
            git_cmd::is_head_pushed,
            git_cmd::apply_patch_to_index,
            git_cmd::apply_patch_to_index_reverse,
            git_cmd::create_smart_commit_draft,
            git_cmd::validate_smart_commit_plan,
            git_cmd::stage_smart_commit_group,
            git_cmd::commit_smart_commit_group,
            // Git commands — branches / log
            git_cmd::list_branches,
            git_cmd::create_branch,
            git_cmd::switch_branch,
            git_cmd::delete_branch,
            git_cmd::get_log,
            git_cmd::get_commit_diff,
            git_cmd::get_commit_diff_files,
            git_cmd::list_files,
            // Git commands — remote
            git_cmd::list_remotes,
            git_cmd::add_remote,
            git_cmd::edit_remote,
            git_cmd::remove_remote,
            git_cmd::rename_remote,
            git_cmd::set_remote_url,
            git_cmd::get_tracking_info,
            git_cmd::set_upstream,
            git_cmd::fetch,
            git_cmd::push,
            git_cmd::pull,
            git_cmd::fetch_task,
            git_cmd::push_task,
            git_cmd::pull_task,
            git_cmd::cancel_git_task,
            git_cmd::create_tracking_branch,
            git_cmd::push_tag,
            git_cmd::delete_remote_tag,
            // GitHub pull request workflow
            github_cmd::github_remote,
            github_cmd::github_gh_status,
            github_cmd::github_open_compare,
            github_cmd::github_pr_list,
            github_cmd::github_pr_view,
            github_cmd::github_pr_create,
            github_cmd::github_pr_checkout,
            github_cmd::github_publish_inline_comment,
            github_cmd::set_github_pat,
            github_cmd::delete_github_pat,
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
            git_cmd::get_operation_state,
            git_cmd::list_conflict_details,
            git_cmd::save_conflict_resolution,
            git_cmd::continue_operation,
            git_cmd::skip_operation,
            git_cmd::abort_operation,
            // Git commands — history (commit-level operations)
            git_cmd::checkout_commit,
            git_cmd::revert_commit,
            git_cmd::cherry_pick_commit,
            git_cmd::reset_to_commit,
            // AI commands
            ai_cmd::generate_smart_commit_plan,
            ai_cmd::generate_commit_message,
            ai_cmd::generate_pull_request_draft,
            ai_cmd::generate_commit_message_stream,
            ai_cmd::review_code,
            ai_cmd::review_code_stream,
            ai_cmd::update_review_finding,
            ai_cmd::load_review_report,
            ai_cmd::repo_chat,
            ai_cmd::repo_chat_stream,
            ai_cmd::cancel_ai_request,
            ai_cmd::get_default_prompts,
            ai_cmd::analyze_git_error,
            // Local code index
            index_cmd::get_code_index_status,
            index_cmd::rebuild_code_index,
            index_cmd::cancel_code_index,
            index_cmd::delete_code_index,
            index_cmd::search_code_index,
            // Local chat history (stored separately from credentials/config)
            load_chat_sessions,
            save_chat_session,
            delete_chat_session,
            clear_chat_history,
            // Config commands
            config_cmd::get_config,
            config_cmd::save_config,
            config_cmd::set_api_key,
            config_cmd::delete_api_key,
            config_cmd::add_recent_repo,
            config_cmd::set_open_repos,
            updater_cmd::updater_availability,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aigit application");
}
