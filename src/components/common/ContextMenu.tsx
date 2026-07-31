import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

export interface MenuItem {
  type?: "item" | "separator";
  label?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuContextValue {
  show: (e: React.MouseEvent | MouseEvent, items: MenuItem[]) => void;
  hide: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

/**
 * 全局右键菜单 Provider：
 * - 在整个应用窗口内禁用 webview 默认右键菜单（刷新 / 检查元素等）
 * - 任意组件通过 `useContextMenu().show(event, items)` 弹出程序专属菜单
 * - 点击菜单项或空白处后自动关闭；Esc 也可关闭
 */
export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    items: [],
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hide = useCallback(() => {
    setMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const show = useCallback(
    (e: React.MouseEvent | MouseEvent, items: MenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      const x = "clientX" in e ? e.clientX : 0;
      const y = "clientY" in e ? e.clientY : 0;
      setMenu({ open: true, x, y, items });
    },
    [],
  );

  // 全局禁用浏览器默认右键菜单。即使没有调用 show()，也屏蔽 webview 自带的菜单。
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // 在输入框/文本域内允许原生上下文菜单（便于系统的复制/粘贴/拼写检查）
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;
      if (isEditable) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handler, true);
    return () => window.removeEventListener("contextmenu", handler, true);
  }, []);

  // 点击外部 / Esc 关闭菜单
  useEffect(() => {
    if (!menu.open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onScroll = () => hide();
    // 用 capture 阶段，确保在子元素的 onClick 之前关闭外层菜单
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu.open, hide]);

  // 边界检测：若菜单超出视口则回缩
  const adjustedPos = (() => {
    if (!menu.open) return { x: menu.x, y: menu.y };
    const estWidth = 200;
    const estHeight = menu.items.length * 32 + 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = menu.x + estWidth > vw ? Math.max(0, vw - estWidth - 4) : menu.x;
    const y = menu.y + estHeight > vh ? Math.max(0, vh - estHeight - 4) : menu.y;
    return { x, y };
  })();

  return (
    <ContextMenuContext.Provider value={{ show, hide }}>
      {children}
      {menu.open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[9999] min-w-[180px] py-1 bg-bg-surface border border-border rounded-md shadow-xl shadow-black/40"
            style={{
              left: adjustedPos.x,
              top: adjustedPos.y,
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {menu.items.map((item, idx) => {
              if (item.type === "separator") {
                return (
                  <div
                    key={`sep-${idx}`}
                    className="my-1 h-px bg-border-subtle"
                    aria-hidden="true"
                  />
                );
              }
              return (
                <button
                  key={`item-${idx}`}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    hide();
                    item.onClick?.();
                  }}
                  className={clsx(
                    "flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-sm transition-colors",
                    "focus:outline-none focus:bg-bg-hover",
                    item.disabled
                      ? "text-text-muted cursor-not-allowed"
                      : item.danger
                        ? "text-danger hover:bg-danger/10"
                        : "text-text-primary hover:bg-bg-hover",
                  )}
                >
                  {item.icon && (
                    <span className="shrink-0 inline-flex w-4 h-4 items-center justify-center">
                      {item.icon}
                    </span>
                  )}
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return ctx;
}
