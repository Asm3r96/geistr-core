import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectDropdownProps {
  /** Accessible label for the trigger button. */
  label: string;
  /** Currently selected value. */
  value: string;
  /** Available options. */
  options: SelectOption[];
  /** Called when the user selects an option. */
  onChange: (value: string) => void;
}

/**
 * A styled dropdown that replaces the native `<select>` element.
 * Matches the design system popover styling (same as the model picker).
 */
export function SelectDropdown({ label, value, options, onChange }: SelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleSelect = useCallback(
    (option: SelectOption) => {
      onChange(option.value);
      setIsOpen(false);
    },
    [onChange],
  );

  return (
    <div className="selectDropdownAnchor" ref={anchorRef}>
      <button
        className="selectDropdownTrigger"
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen ? (
        <div className="selectDropdownMenu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selectDropdownItem selected" : "selectDropdownItem"}
              onClick={() => handleSelect(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
