import { useState, useRef, useEffect } from "react";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "../lib/i18n";

interface Props {
  value: AppLanguage;
  onChange: (lang: AppLanguage) => void;
}

const LANG_FLAGS: Record<AppLanguage, string> = {
  en: "🇺🇸",
  vi: "🇻🇳",
  ja: "🇯🇵",
  ko: "🇰🇷",
  zh: "🇨🇳",
  fr: "🇫🇷",
  de: "🇩🇪",
  es: "🇪🇸",
  th: "🇹🇭",
};

export function LanguageSwitch({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === value)!;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleSelect(lang: AppLanguage) {
    onChange(lang);
    setOpen(false);
  }

  return (
    <div className="lang-switch-dropdown" ref={ref}>
      <button
        className="lang-switch-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.name}
      >
        <span className="lang-switch-flag">{LANG_FLAGS[value]}</span>
        <span className="lang-switch-label">{current.nativeName}</span>
        <span className="lang-switch-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <ul
          className="lang-switch-menu"
          role="listbox"
          aria-label="Select language"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <li
              key={lang.code}
              role="option"
              aria-selected={lang.code === value}
              className={`lang-switch-option ${lang.code === value ? "active" : ""}`}
              onClick={() => handleSelect(lang.code)}
            >
              <span className="lang-switch-flag">{LANG_FLAGS[lang.code]}</span>
              <span className="lang-switch-option-native">{lang.nativeName}</span>
              <span className="lang-switch-option-name">{lang.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
