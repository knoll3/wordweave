import React, { useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

const ElementSearch: React.FC<Props> = ({ value, onChange }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function moveCursorToEnd() {
    const input = inputRef.current;
    if (!input) return;
    const end = input.value.length;
    window.requestAnimationFrame(() => {
      input.setSelectionRange(end, end);
    });
  }

  return (
    <div className="search-input-wrap">
      <input
        ref={inputRef}
        className="input search-input"
        type="text"
        placeholder="Search items…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={moveCursorToEnd}
        onClick={moveCursorToEnd}
      />
      {value ? (
        <button
          type="button"
          className="search-clear-button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
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
