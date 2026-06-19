import { useRef, type KeyboardEvent } from "react";

export interface TabDef {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}

/**
 * An accessible, roving-focus tablist (WAI-ARIA tabs pattern). Only the active
 * tab is in the tab order; Arrow/Home/End move selection and DOM focus together.
 * Clicking a tab selects it. The owning view supplies `panel-<id>` regions.
 */
export function Tabs({ tabs, active, onChange }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === active),
  );

  function select(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.id);
    refs.current[index]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = activeIndex;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (activeIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (activeIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    select(next);
  }

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Admin sections"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`tab ${selected ? "tab--active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
