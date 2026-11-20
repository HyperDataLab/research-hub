"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  id?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

const POPUP_GAP = 6;
const POPUP_MAX_HEIGHT = 260;

export function Dropdown({ id, value, options, onChange, disabled = false, className = "", ariaLabel }: DropdownProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - POPUP_GAP;
    const above = rect.top - POPUP_GAP;
    const placement = below >= Math.min(POPUP_MAX_HEIGHT, 180) || below >= above ? "bottom" : "top";
    const available = Math.max(80, Math.min(POPUP_MAX_HEIGHT, placement === "bottom" ? below : above));
    setPosition({
      top: placement === "bottom" ? rect.bottom + POPUP_GAP : rect.top - POPUP_GAP,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
      maxHeight: available,
      placement,
    });
  }, []);

  const openMenu = useCallback((initialIndex = selectedIndex) => {
    const fallbackIndex = enabledIndices[0] ?? -1;
    const nextIndex = initialIndex >= 0 && !options[initialIndex]?.disabled ? initialIndex : fallbackIndex;
    setActiveIndex(nextIndex);
    setOpen(true);
    updatePosition();
  }, [enabledIndices, options, selectedIndex, updatePosition]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const selectOption = useCallback((option: DropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
    triggerRef.current?.focus();
  }, [closeMenu, onChange]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !listboxRef.current?.contains(target)) closeMenu();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [closeMenu, open, updatePosition]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listboxRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  function moveActive(direction: 1 | -1) {
    if (!enabledIndices.length) return;
    const current = enabledIndices.indexOf(activeIndex);
    const next = current < 0 ? (direction > 0 ? 0 : enabledIndices.length - 1) : (current + direction + enabledIndices.length) % enabledIndices.length;
    setActiveIndex(enabledIndices[next]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(event.key === "ArrowDown" ? selectedIndex : selectedIndex >= 0 ? selectedIndex : enabledIndices.length - 1);
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? enabledIndices[0] ?? -1 : enabledIndices.at(-1) ?? -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) selectOption(options[activeIndex]);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const search = `${typeaheadRef.current}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current = search;
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ""; }, 600);
      const match = enabledIndices.find((index) => options[index].label.toLocaleLowerCase().startsWith(search));
      if (match !== undefined) {
        event.preventDefault();
        setActiveIndex(match);
        if (!open) openMenu(match);
      }
    }
  }

  const popup = open && position && typeof document !== "undefined" ? createPortal(
    <div
      id={listboxId}
      ref={listboxRef}
      className={`hub-dropdown-menu${position.placement === "top" ? " opens-up" : ""}`}
      role="listbox"
      aria-label={ariaLabel}
      style={{ left: position.left, top: position.placement === "bottom" ? position.top : undefined, bottom: position.placement === "top" ? window.innerHeight - position.top : undefined, width: position.width, maxHeight: position.maxHeight }}
    >
      {options.map((option, index) => (
        <div
          key={option.value}
          id={`${listboxId}-option-${index}`}
          data-option-index={index}
          className={`hub-dropdown-option${index === selectedIndex ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
          role="option"
          aria-selected={index === selectedIndex}
          aria-disabled={option.disabled || undefined}
          onMouseEnter={() => !option.disabled && setActiveIndex(index)}
          onClick={() => selectOption(option)}
        >
          <span>{option.label}</span>
          {index === selectedIndex && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.2 3 3 6-6" /></svg>}
        </div>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`hub-dropdown ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="hub-dropdown-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span className={!selectedOption ? "is-placeholder" : undefined}>{selectedOption?.label ?? "Chọn"}</span>
        <svg className="hub-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4 4.5-4" /></svg>
      </button>
      {popup}
    </div>
  );
}
