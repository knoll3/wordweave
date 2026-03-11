import React from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

const ElementSearch: React.FC<Props> = ({ value, onChange }) => {
  return (
    <input
      className="input search-input"
      type="text"
      placeholder="Search items…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

export default ElementSearch;
