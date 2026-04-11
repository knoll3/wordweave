import React, { useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onFocusChange?: (isFocused: boolean) => void;
}

const ElementSearch: React.FC<Props> = ({ value, onChange, onFocusChange }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function selectAllText() {
    const input = inputRef.current;
    if (!input) return;
    window.requestAnimationFrame(() => {
      input.select();
    });
  }

  return (
    <div className="search-input-wrap">
      <input
        ref={inputRef}
        className="input search-input"
        type="search"
        name="wordweave-search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="search"
        placeholder="Search items…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            inputRef.current?.blur();
            window.scrollTo(0, 0);
          }
        }}
        onFocus={() => {
          onFocusChange?.(true);
          selectAllText();
        }}
        onBlur={() => {
          window.setTimeout(() => onFocusChange?.(false), 120);
        }}
        onClick={selectAllText}
      />
      {value ? (
        <button
          type="button"
          className="search-clear-button"
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            onChange("");
            inputRef.current?.blur();
            window.scrollTo(0, 0);
          }}
          aria-label="Clear search"
          title="Clear search"
        >
          ×
        </button>
      ) : null}
    </div>
  );
};

export default ElementSearch;
