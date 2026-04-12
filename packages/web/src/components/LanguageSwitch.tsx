interface Props {
  value: "vi" | "en";
  onChange: (lang: "vi" | "en") => void;
}

export function LanguageSwitch({ value, onChange }: Props) {
  return (
    <div className="lang-switch" role="group" aria-label="Language switch">
      <button
        className={`lang-switch-btn ${value === "vi" ? "active" : ""}`}
        onClick={() => onChange("vi")}
        aria-pressed={value === "vi"}
      >
        VI
      </button>
      <button
        className={`lang-switch-btn ${value === "en" ? "active" : ""}`}
        onClick={() => onChange("en")}
        aria-pressed={value === "en"}
      >
        EN
      </button>
    </div>
  );
}