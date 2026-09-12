import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { gitService } from "@/services/git";
import { useRepoStore } from "@/stores/repoStore";
import type {
  BlameLine,
  CodeSearchHit,
  FileContent,
  FileDiff,
  FileTreeEntry,
  LogEntry,
} from "@/types";
import { codeIndexService } from "@/services/codeIndex";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileEditIcon,
  FolderIcon,
  GitCommitIcon,
  HistoryIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/common/Icons";
import { DiffViewer } from "@/components/git/DiffViewer";
import clsx from "clsx";

type FileTab = "content" | "history" | "blame";

/** 大文件预览降级阈值：超过先渲染前缀，可一键展开（与 DiffViewer 策略一致）。 */
const CONTENT_LINE_LIMIT = 2000;
/** 搜索过滤模式的扁平结果上限，超限截断并提示（自动降级而非报错）。 */
const SEARCH_RESULT_LIMIT = 200;

const ROOT_KEY = "";

export function FilesView() {
  const { t, i18n } = useTranslation();
  const { currentPath } = useRepoStore(
    useShallow((s) => ({
      currentPath: s.currentPath,
    })),
  );

  // 树缓存：dir -> 条目列表；null 表示尚未加载。
  const [entriesByDir, setEntriesByDir] = useState<
    Record<string, FileTreeEntry[] | null>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeRefreshing, setTreeRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [allFiles, setAllFiles] = useState<string[] | null>(null);
  const [allFilesLoading, setAllFilesLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FileTab>("content");
  // 语义搜索（本地代码索引）模式下的命中结果。
  const [searchMode, setSearchMode] = useState<"name" | "semantic">("name");
  const [semanticHits, setSemanticHits] = useState<CodeSearchHit[] | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  // 从语义命中跳转到内容页的目标行。
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);

  const q = search.trim().toLowerCase();

  // 各标签页数据
  const [content, setContent] = useState<FileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [showAllLines, setShowAllLines] = useState(false);

  const [history, setHistory] = useState<LogEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyHash, setHistoryHash] = useState<string | null>(null);
  const [historyDiff, setHistoryDiff] = useState<FileDiff[] | null>(null);
  const [historyDiffLoading, setHistoryDiffLoading] = useState(false);

  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [blameError, setBlameError] = useState<string | null>(null);

  const formatTime = useCallback(
    (timestamp: number) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: "short" }).format(
        new Date(timestamp * 1000),
      ),
    [i18n.language],
  );

  const loadDir = useCallback(
    async (dir: string, force = false) => {
      if (!currentPath) return;
      if (!force && entriesByDir[dir] !== undefined) return;
      setEntriesByDir((prev) => ({ ...prev, [dir]: null }));
      setTreeError(null);
      try {
        const entries = await gitService.listTree(
          currentPath,
          dir === ROOT_KEY ? undefined : dir,
        );
        setEntriesByDir((prev) =>
          prev[dir] === null || prev[dir] === undefined || force
            ? { ...prev, [dir]: entries }
            : prev,
        );
      } catch (e) {
        console.error(e);
        // 加载失败的目录从缓存移除，允许重试。
        setEntriesByDir((prev) => {
          const next = { ...prev };
          delete next[dir];
          return next;
        });
        setTreeError(e instanceof Error ? e.message : String(e));
      }
    },
    [currentPath, entriesByDir],
  );

  useEffect(() => {
    // 切换仓库：重置全部本地状态，重新加载根目录。
    setEntriesByDir({});
    setExpanded(new Set());
    setSelectedFile(null);
    setSearch("");
    setAllFiles(null);
    setTreeError(null);
    if (currentPath) void loadDir(ROOT_KEY, true);
    // loadDir 随 entriesByDir 变化重建，这里只关心仓库切换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const handleToggleDir = (entry: FileTreeEntry) => {
    const isOpen = expanded.has(entry.path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!isOpen) void loadDir(entry.path);
  };

  const handleRefresh = async () => {
    setTreeRefreshing(true);
    try {
      setAllFiles(null);
      await loadDir(ROOT_KEY, true);
      for (const dir of expanded) await loadDir(dir, true);
    } finally {
      setTreeRefreshing(false);
    }
  };

  // 搜索模式：首次输入时拉一次全量文件清单。
  useEffect(() => {
    if (!search.trim() || !currentPath || allFiles || allFilesLoading) return;
    setAllFilesLoading(true);
    gitService
      .listFiles(currentPath)
      .then(setAllFiles)
      .catch((e) => {
        console.error(e);
        setAllFiles([]);
      })
      .finally(() => setAllFilesLoading(false));
  }, [search, currentPath, allFiles, allFilesLoading]);

  // 语义搜索：输入稳定 500ms 后自动执行（本地索引，查询本身便宜）。
  useEffect(() => {
    setSemanticHits(null);
    setSemanticError(null);
    if (searchMode !== "semantic" || !q || !currentPath) return;
    const timer = window.setTimeout(() => {
      setSemanticLoading(true);
      codeIndexService
        .search(currentPath, q.trim(), 12)
        .then(setSemanticHits)
        .catch((e) => {
          console.error(e);
          setSemanticError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setSemanticLoading(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [searchMode, q, currentPath]);

  // 选中文件变化：重置右侧全部数据。
  useEffect(() => {
    setContent(null);
    setContentError(null);
    setShowAllLines(false);
    setHistory(null);
    setHistoryError(null);
    setHistoryHash(null);
    setHistoryDiff(null);
    setBlame(null);
    setBlameError(null);
  }, [selectedFile]);

  // 内容就绪后滚动到语义命中的目标行。
  useEffect(() => {
    if (scrollToLine === null || activeTab !== "content" || !content) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-line="${scrollToLine}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    setScrollToLine(null);
  }, [scrollToLine, activeTab, content]);

  // 内容预览：内容与 blame 共用。
  useEffect(() => {
    if (!currentPath || !selectedFile) return;
    if (activeTab !== "content" && activeTab !== "blame") return;
    if (content || contentLoading) return;
    setContentLoading(true);
    gitService
      .getFileContent(currentPath, selectedFile)
      .then((data) => {
        setContent((prev) => (prev ? prev : data));
      })
      .catch((e) => {
        console.error(e);
        setContentError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setContentLoading(false));
  }, [activeTab, selectedFile, currentPath, content, contentLoading]);

  // 文件历史。
  useEffect(() => {
    if (!currentPath || !selectedFile || activeTab !== "history") return;
    if (history || historyLoading) return;
    setHistoryLoading(true);
    gitService
      .getFileHistory(currentPath, selectedFile)
      .then((data) => setHistory((prev) => prev ?? data))
      .catch((e) => {
        console.error(e);
        setHistoryError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setHistoryLoading(false));
  }, [activeTab, selectedFile, currentPath, history, historyLoading]);

  // blame 行归属。
  useEffect(() => {
    if (!currentPath || !selectedFile || activeTab !== "blame") return;
    if (blame || blameLoading) return;
    setBlameLoading(true);
    gitService
      .getFileBlame(currentPath, selectedFile)
      .then((data) => setBlame((prev) => prev ?? data))
      .catch((e) => {
        console.error(e);
        setBlameError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBlameLoading(false));
  }, [activeTab, selectedFile, currentPath, blame, blameLoading]);

  // 历史详情 diff。
  useEffect(() => {
    if (!currentPath || !selectedFile || !historyHash) return;
    setHistoryDiffLoading(true);
    gitService
      .getCommitFileDiff(currentPath, historyHash, selectedFile)
      .then(setHistoryDiff)
      .catch((e) => {
        console.error(e);
        setHistoryDiff([]);
      })
      .finally(() => setHistoryDiffLoading(false));
  }, [historyHash, selectedFile, currentPath]);

  const searchResults = useMemo(() => {
    if (!q || !allFiles) return null;
    const matched = allFiles.filter((f) => f.toLowerCase().includes(q));
    return {
      shown: matched.slice(0, SEARCH_RESULT_LIMIT),
      total: matched.length,
    };
  }, [q, allFiles]);

  if (!currentPath) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t("files.openRepoHint")}
      </div>
    );
  }

  const renderRows = (dir: string, depth: number): React.ReactNode => {
    const entries = entriesByDir[dir];
    if (entries === null) {
      return (
        <div
          key={`${dir}:loading`}
          className="flex items-center gap-2 px-3 py-1.5 text-text-muted"
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <SpinnerIcon size={12} />
        </div>
      );
    }
    if (entries === undefined) return null;

    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const isSelected = entry.kind === "file" && selectedFile === entry.path;
      return (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() =>
              entry.kind === "dir"
                ? handleToggleDir(entry)
                : setSelectedFile(entry.path)
            }
            title={entry.path}
            className={clsx(
              "w-full flex items-center gap-1.5 pr-3 py-1.5 rounded text-left text-sm transition-colors",
              isSelected
                ? "bg-bg-hover text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-expanded={entry.kind === "dir" ? isOpen : undefined}
          >
            <span className="shrink-0 w-3.5 flex justify-center text-text-muted">
              {entry.kind === "dir" &&
                (isOpen ? (
                  <ChevronDownIcon size={12} />
                ) : (
                  <ChevronRightIcon size={12} />
                ))}
            </span>
            {entry.kind === "dir" ? (
              <FolderIcon size={14} className="shrink-0 text-text-muted" />
            ) : (
              <FileEditIcon size={14} className="shrink-0 text-text-muted" />
            )}
            <span className="flex-1 truncate">{entry.name}</span>
          </button>
          {entry.kind === "dir" && isOpen && renderRows(entry.path, depth + 1)}
        </div>
      );
    });
  };

  // 语义命中跳转：切到内容页并滚动到目标行。
  const openHit = (hit: CodeSearchHit) => {
    setSelectedFile(hit.path);
    setActiveTab("content");
    setScrollToLine(hit.start_line);
  };

  const contentLines = content?.content ? content.content.split("\n") : [];
  // Git LFS 指针文件：正文以固定版本头开始，真实内容由 lfs smudge 还原。
  const isLfsPointer =
    content?.content.startsWith("version https://git-lfs") ?? false;
  const visibleLines = showAllLines
    ? contentLines
    : contentLines.slice(0, CONTENT_LINE_LIMIT);

  // blame 连续同提交的行合并为一组，组首行显示归属信息。
  const blameGroups: {
    key: string;
    start: number;
    info: BlameLine | null;
    lines: string[];
  }[] = [];
  if (content && blame) {
    const blameByLine = new Map(blame.map((b) => [b.line, b]));
    contentLines.forEach((text, idx) => {
      const lineNo = idx + 1;
      const info = blameByLine.get(lineNo) ?? null;
      const prev = blameGroups[blameGroups.length - 1];
      if (prev && info && prev.info?.commit_hash === info.commit_hash) {
        prev.lines.push(text);
      } else {
        blameGroups.push({
          key: `l${lineNo}`,
          start: lineNo,
          info,
          lines: [text],
        });
      }
    });
  }

  const tabs: { id: FileTab; label: string; icon: typeof FileEditIcon }[] = [
    { id: "content", label: t("files.tabContent"), icon: FileEditIcon },
    { id: "history", label: t("files.tabHistory"), icon: HistoryIcon },
    { id: "blame", label: t("files.tabBlame"), icon: GitCommitIcon },
  ];

  return (
    <div className="flex h-full">
      {/* 左侧：文件树 / 搜索 */}
      <div className="w-72 border-r border-border flex flex-col overflow-hidden">
        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-base font-semibold flex-1">
            {t("files.title")}
          </span>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={treeRefreshing}
            aria-busy={treeRefreshing}
            className="btn-ghost"
            title={t("files.refresh")}
            aria-label={t("files.refresh")}
          >
            {treeRefreshing ? (
              <SpinnerIcon size={16} />
            ) : (
              <RefreshIcon size={16} />
            )}
          </button>
        </div>

        <div className="px-3 py-2.5 border-b border-border">
          <div className="relative">
            <SearchIcon
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.search")}
              className="input text-xs py-1.5 pl-7 w-full"
            />
          </div>
          {q && (
            <div className="mt-2 flex gap-1" role="tablist">
              {(["name", "semantic"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={searchMode === mode}
                  onClick={() => setSearchMode(mode)}
                  className={clsx(
                    "px-2 py-1 rounded text-2xs transition-colors",
                    searchMode === mode
                      ? "bg-bg-hover text-text-primary"
                      : "text-text-muted hover:text-text-secondary hover:bg-bg-hover",
                  )}
                >
                  {mode === "name" ? t("files.modeName") : t("files.modeSemantic")}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto py-1.5 px-2">
          {treeError && (
            <div className="px-2 py-1.5 text-xs text-danger break-all">
              {treeError}
            </div>
          )}
          {q ? (
            searchMode === "semantic" ? (
              <>
                {semanticLoading && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-muted">
                    <SpinnerIcon size={12} />
                    {t("common.loading")}
                  </div>
                )}
                {semanticError && (
                  <div className="px-2 py-1.5 text-xs text-danger break-all">
                    {semanticError}
                    <div className="mt-1 text-text-muted">
                      {t("files.semanticErrorHint")}
                    </div>
                  </div>
                )}
                {semanticHits && semanticHits.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-text-muted">
                    {t("common.noResults")}
                  </div>
                )}
                {semanticHits?.map((hit) => (
                  <button
                    key={`${hit.path}:${hit.start_line}`}
                    type="button"
                    onClick={() => openHit(hit)}
                    title={hit.path}
                    className={clsx(
                      "w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-hover",
                      selectedFile === hit.path && "bg-bg-hover",
                    )}
                  >
                    <span className="block truncate text-xs text-text-primary">
                      {hit.path}
                      <span className="ml-1 text-2xs text-text-muted">
                        :{hit.start_line}-{hit.end_line} ·{" "}
                        {Math.round(hit.score * 100)}%
                      </span>
                    </span>
                    <span className="mt-0.5 block text-2xs leading-4 text-text-secondary line-clamp-3 whitespace-pre-wrap break-all">
                      {hit.text.trim().slice(0, 160)}
                    </span>
                  </button>
                ))}
              </>
            ) : searchResults === null ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-text-muted text-xs">
                {allFilesLoading && <SpinnerIcon size={12} />}
                {t("files.searching")}
              </div>
            ) : (
              <>
                <div className="px-2 py-1.5 text-xs text-text-muted">
                  {t("files.searchCount", {
                    shown: searchResults.shown.length,
                    total: searchResults.total,
                  })}
                </div>
                {searchResults.shown.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setSelectedFile(path)}
                    title={path}
                    className={clsx(
                      "w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-xs transition-colors",
                      selectedFile === path
                        ? "bg-bg-hover text-text-primary"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
                    )}
                  >
                    <FileEditIcon
                      size={12}
                      className="shrink-0 text-text-muted"
                    />
                    <span className="truncate">{path}</span>
                  </button>
                ))}
                {searchResults.total > searchResults.shown.length && (
                  <div className="px-2 py-1.5 text-2xs text-text-muted">
                    {t("files.searchTruncated", { limit: SEARCH_RESULT_LIMIT })}
                  </div>
                )}
              </>
            )
          ) : (
            <>
              {renderRows(ROOT_KEY, 0)}
              {entriesByDir[ROOT_KEY]?.some((e) => e.truncated) && (
                <div className="px-2 py-1.5 text-2xs text-text-muted">
                  {t("files.treeTruncated")}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 右侧：选中文件的内容 / 历史 / blame */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            <div className="flex items-center border-b border-border">
              <div className="flex-1 min-w-0 px-4 py-2">
                <span
                  className="block text-sm font-medium truncate"
                  title={selectedFile}
                >
                  {selectedFile}
                </span>
              </div>
              <div className="flex border-l border-border">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={clsx(
                        "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
                        isActive
                          ? "text-text-primary border-accent"
                          : "text-text-muted hover:text-text-secondary border-transparent hover:bg-bg-hover",
                      )}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {activeTab === "content" && (
                <div className="p-4">
                  {contentLoading && (
                    <div className="flex items-center gap-2 text-text-muted text-sm">
                      <SpinnerIcon size={14} />
                      {t("files.loading")}
                    </div>
                  )}
                  {contentError && (
                    <div className="text-sm text-danger break-all">
                      {contentError}
                    </div>
                  )}
                  {content?.is_binary && (
                    <div className="text-sm text-text-muted">
                      {t("files.binaryFile")}
                    </div>
                  )}
                  {content && !content.is_binary && (
                    <>
                      {content.truncated && (
                        <div className="mb-3 rounded bg-bg-hover px-3 py-2 text-xs text-text-secondary">
                          {t("files.fileTruncated")}
                        </div>
                      )}
                      {isLfsPointer && (
                        <div className="mb-3 rounded bg-bg-hover px-3 py-2 text-xs text-text-secondary">
                          {t("files.lfsPointer")}
                        </div>
                      )}
                      {contentLines.length > CONTENT_LINE_LIMIT && (
                        <div className="mb-3 flex items-center gap-3 rounded bg-bg-hover px-3 py-2 text-xs text-text-secondary">
                          <span>
                            {t("files.linesTruncated", {
                              shown: CONTENT_LINE_LIMIT,
                              total: contentLines.length,
                            })}
                          </span>
                          {!showAllLines && (
                            <button
                              type="button"
                              onClick={() => setShowAllLines(true)}
                              className="text-accent hover:underline"
                            >
                              {t("files.showAll")}
                            </button>
                          )}
                        </div>
                      )}
                      <pre className="text-xs leading-5 font-mono">
                        {visibleLines.map((line, idx) => (
                          <div
                            key={idx}
                            className="flex hover:bg-bg-hover"
                            data-line={idx + 1}
                          >
                            <span className="w-12 shrink-0 select-none pr-3 text-right text-text-muted">
                              {idx + 1}
                            </span>
                            <span className="whitespace-pre-wrap break-all flex-1">
                              {line || " "}
                            </span>
                          </div>
                        ))}
                      </pre>
                    </>
                  )}
                </div>
              )}

              {activeTab === "history" && (
                <div className="p-4">
                  {historyLoading && (
                    <div className="flex items-center gap-2 text-text-muted text-sm">
                      <SpinnerIcon size={14} />
                      {t("files.loading")}
                    </div>
                  )}
                  {historyError && (
                    <div className="text-sm text-danger break-all">
                      {historyError}
                    </div>
                  )}
                  {history && history.length === 0 && (
                    <div className="text-sm text-text-muted">
                      {t("files.noHistory")}
                    </div>
                  )}
                  {history && history.length > 0 && (
                    <div className="space-y-1.5">
                      {history.map((entry) => (
                        <div key={entry.hash}>
                          <button
                            type="button"
                            onClick={() =>
                              setHistoryHash((prev) =>
                                prev === entry.hash ? null : entry.hash,
                              )
                            }
                            aria-expanded={historyHash === entry.hash}
                            className={clsx(
                              "w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors",
                              historyHash === entry.hash
                                ? "bg-bg-hover"
                                : "hover:bg-bg-hover",
                            )}
                          >
                            {historyHash === entry.hash ? (
                              <ChevronDownIcon
                                size={13}
                                className="shrink-0 text-text-muted"
                              />
                            ) : (
                              <ChevronRightIcon
                                size={13}
                                className="shrink-0 text-text-muted"
                              />
                            )}
                            <span className="font-mono text-xs text-accent shrink-0">
                              {entry.short_hash}
                            </span>
                            <span className="text-sm text-text-primary truncate flex-1">
                              {entry.message}
                            </span>
                            <span className="text-xs text-text-muted shrink-0">
                              {entry.author} · {formatTime(entry.timestamp)}
                            </span>
                          </button>
                          {historyHash === entry.hash && (
                            <div className="mt-1 mb-2 pl-6">
                              {historyDiffLoading && (
                                <div className="flex items-center gap-2 text-text-muted text-xs py-2">
                                  <SpinnerIcon size={12} />
                                  {t("files.loading")}
                                </div>
                              )}
                              {historyDiff && historyDiff.length === 0 && (
                                <div className="text-xs text-text-muted py-2">
                                  {t("files.noFileDiff")}
                                </div>
                              )}
                              {historyDiff && historyDiff.length > 0 && (
                                <DiffViewer
                                  diffs={historyDiff}
                                  mode="view"
                                  defaultCollapsed
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "blame" && (
                <div className="p-4">
                  {blameLoading && (
                    <div className="flex items-center gap-2 text-text-muted text-sm">
                      <SpinnerIcon size={14} />
                      {t("files.loading")}
                    </div>
                  )}
                  {blameError && (
                    <div className="text-sm text-danger break-all">
                      {blameError}
                    </div>
                  )}
                  {blame && !contentLoading && content?.is_binary && (
                    <div className="text-sm text-text-muted">
                      {t("files.binaryFile")}
                    </div>
                  )}
                  {blame && blame.length === 0 && (
                    <div className="text-sm text-text-muted">
                      {t("files.blameUnavailable")}
                    </div>
                  )}
                  {blameGroups.length > 0 && (
                    <pre className="text-xs leading-5 font-mono">
                      {blameGroups.map((group) => (
                        <div key={group.key}>
                          {group.info && (
                            <div
                              className="flex gap-3 px-2 bg-bg-hover border-y border-border-subtle"
                              title={`${group.info.summary} (${group.info.author})`}
                            >
                              <span className="font-mono text-accent shrink-0 cursor-pointer">
                                {group.info.short_hash}
                              </span>
                              <span className="text-text-secondary shrink-0 truncate max-w-40">
                                {group.info.author}
                              </span>
                              <span className="text-text-muted shrink-0">
                                {formatTime(group.info.timestamp)}
                              </span>
                              <span className="text-text-muted truncate">
                                {group.info.summary}
                              </span>
                            </div>
                          )}
                          {group.lines.map((line, idx) => {
                            const lineNo = group.start + idx;
                            return (
                              <div
                                key={`${group.key}-${idx}`}
                                className="flex hover:bg-bg-hover"
                                data-line={lineNo}
                              >
                                <span className="w-12 shrink-0 select-none pr-3 text-right text-text-muted">
                                  {lineNo}
                                </span>
                                <span className="whitespace-pre-wrap break-all flex-1">
                                  {line || " "}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {t("files.selectFile")}
          </div>
        )}
      </div>
    </div>
  );
}
