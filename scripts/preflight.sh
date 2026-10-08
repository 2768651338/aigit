#!/usr/bin/env bash
# 分支预检：改动先推 origin/preflight 跑 CI，绿了再快进合入 main。
# 本机没有 MSVC，无法本地 cargo check/test，CI 是唯一的编译验证环境；
# 该流程保证 main 只接收 CI 通过的提交，commit SHA 与历史形状保持不变。
#
# 用法（每个克隆先执行一次 `git preflight setup` 安装 alias）：
#   git preflight        推当前 HEAD 到 origin/preflight 触发 CI 并盯到结束
#   git land [--force]   把本地 main 快进推到 origin/main；要求该提交有通过的预检记录
#   git preflight setup  （重新）安装 preflight / land 两个本地 alias
#   git preflight help   显示本帮助
set -euo pipefail

BRANCH=preflight
REMOTE=origin
WORKFLOW=ci.yml
POLL_SECONDS=30
TIMEOUT_SECONDS=$((45 * 60))
REPO_URL=$(git remote get-url "$REMOTE" 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)([^/]+/[^.]+)(\.git)?#https://github.com/\2#' || true)

die() { printf '✗ %s\n' "$1" >&2; exit 1; }
info() { printf '→ %s\n' "$1"; }
actions_url() { printf '%s/actions' "${REPO_URL:-https://github.com}"; }

require_gh() { command -v gh >/dev/null 2>&1 || die '未找到 gh CLI，请先安装：https://cli.github.com'; }

cmd=${1:-push}
case $cmd in
  land) shift ;;
  setup|help|-h|--help) cmd=setup_or_help ;;
  *) cmd=push ;;
esac

case $cmd in
  setup_or_help)
    if [ "${1:-}" = "setup" ]; then
      git config --local alias.preflight '!bash scripts/preflight.sh'
      git config --local alias.land '!bash scripts/preflight.sh land'
      info '已安装本地 alias：git preflight / git land'
    else
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | tail -n +2
    fi
    ;;

  push)
    require_gh
    sha=$(git rev-parse HEAD)
    short=${sha:0:7}
    git fetch -q "$REMOTE" main || die "无法从 $REMOTE 拉取 main"
    main_sha=$(git rev-parse "$REMOTE/main")
    if [ "$sha" = "$main_sha" ]; then
      info "HEAD ($short) 已在 origin/main 上，没有需要预检的提交"
      exit 0
    fi
    if ! git merge-base --is-ancestor "$main_sha" "$sha"; then
      printf '✗ origin/main (%s) 不在当前提交的祖先链上（本地与远端分叉）。\n' "${main_sha:0:7}" >&2
      printf '  请先 git pull --rebase 对齐，再重新 git preflight。\n' >&2
      exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      printf '⚠ 工作区有未提交改动，预检只测试已提交内容。\n' >&2
    fi
    cur_branch=$(git rev-parse --abbrev-ref HEAD)
    [ "$cur_branch" = "main" ] || printf 'ℹ 当前在 %s 分支；land 需要切回 main。\n' "$cur_branch"

    info "推送 $short 到 $REMOTE/$BRANCH ..."
    git push --force-with-lease=refs/heads/$BRANCH "$REMOTE" "HEAD:refs/heads/$BRANCH"

    run_id=''
    for _ in $(seq 1 30); do
      run_id=$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --commit "$sha" \
        --limit 1 --json databaseId -q '.[0].databaseId // empty' 2>/dev/null || true)
      if [ -n "$run_id" ]; then break; fi
      sleep 4
    done
    if [ -z "$run_id" ]; then
      die "2 分钟内未见 CI 启动，请到 $(actions_url) 手动检查"
    fi
    info "CI 已启动（run $run_id），每 ${POLL_SECONDS}s 轮询一次 ..."

    state='unknown -'
    deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
    while :; do
      state=$(gh run view "$run_id" --json status,conclusion \
        -q '.status + " " + (.conclusion // "-")' 2>/dev/null || echo 'unknown -')
      status=${state%% *}
      if [ "$status" = "completed" ]; then break; fi
      if [ "$(date +%s)" -ge "$deadline" ]; then
        die "等待超时（45 分钟），CI 可能仍在跑：$(actions_url)/runs/$run_id"
      fi
      sleep "$POLL_SECONDS"
    done
    conclusion=${state#* }

    if [ "$conclusion" = "success" ]; then
      printf '✓ 预检通过（%s）\n' "$short"
      if [ -t 0 ]; then
        printf '合入 main 并推送? [y/N] '
        read -r ans
        case $ans in y|Y|yes|Yes|YES) exec bash "$0" land ;; esac
        info '已跳过合入；确认后运行 git land'
      else
        info '非交互环境：确认后运行 git land 合入 main'
      fi
    else
      printf '✗ 预检失败（%s），失败日志尾部：\n\n' "$conclusion" >&2
      gh run view "$run_id" --log-failed 2>/dev/null | tail -60 || true
      printf '\n修复后在 main 上继续提交，然后重新运行 git preflight\n完整日志：%s/actions/runs/%s\n' "$(actions_url)" "$run_id" >&2
      exit 1
    fi
    ;;

  land)
    force=0
    if [ "${1:-}" = "--force" ]; then force=1; fi
    require_gh
    cur_branch=$(git rev-parse --abbrev-ref HEAD)
    [ "$cur_branch" = "main" ] || die "当前在 $cur_branch 分支，请切到 main 再 land"
    sha=$(git rev-parse HEAD)
    short=${sha:0:7}
    git fetch -q "$REMOTE" main || die "无法从 $REMOTE 拉取 main"
    main_sha=$(git rev-parse "$REMOTE/main")
    if [ "$sha" = "$main_sha" ]; then
      info 'origin/main 已与 HEAD 一致，无需推送'
      exit 0
    fi
    git merge-base --is-ancestor "$main_sha" "$sha" || \
      die "origin/main (${main_sha:0:7}) 不是 HEAD 的祖先，无法快进；请 git pull --rebase 后重新 git preflight"
    if [ "$force" -ne 1 ]; then
      ok=$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --commit "$sha" \
        --status success --limit 1 --json databaseId -q '.[0].databaseId // empty' 2>/dev/null || true)
      if [ -z "$ok" ]; then
        die "$short 没有通过的预检记录；请先 git preflight，或确认绕过时用 git land --force"
      fi
    else
      printf '⚠ --force：跳过预检记录校验，直接推送未经 CI 验证的提交。\n' >&2
    fi
    if [ -n "$(git status --porcelain)" ]; then
      printf '⚠ 工作区有未提交改动（推送不含未提交内容）。\n' >&2
    fi
    info "快进推送 main → $REMOTE ($short) ..."
    git push "$REMOTE" main
    printf '✓ origin/main 已更新到 %s\n' "$short"
    ;;
esac
