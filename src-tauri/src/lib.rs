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
            // Git commands
            git_cmd::discover_repo,
            git_cmd::init_repo,
            git_cmd::clone_repo,
            git_cmd::get_repo_info,
            git_cmd::get_status,
            git_cmd::get_workdir_diff,
            git_cmd::get_staged_diff,
            git_cmd::stage_files,
            git_cmd::stage_all,
            git_cmd::unstage_files,
            git_cmd::commit,
            git_cmd::amend_message,
            git_cmd::list_branches,
            git_cmd::create_branch,
            git_cmd::switch_branch,
            git_cmd::delete_branch,
            git_cmd::get_log,
            git_cmd::get_commit_diff,
            git_cmd::push,
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
            git_cmd::pull,
            git_cmd::discard_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aigit application");
}
