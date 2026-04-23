import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageSwitch } from "../../src/components/LanguageSwitch";

describe("LanguageSwitch", () => {
  it("renders current language label", () => {
    render(<LanguageSwitch value="en" onChange={vi.fn()} />);
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("opens dropdown on button click", () => {
    render(<LanguageSwitch value="en" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("calls onChange when a different language is selected", () => {
    const onChange = vi.fn();
    render(<LanguageSwitch value="en" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    // Click on the Vietnamese option
    const viOption = screen.getByText("Tiếng Việt");
    fireEvent.click(viOption);
    expect(onChange).toHaveBeenCalledWith("vi");
  });

  it("closes dropdown after selection", () => {
    render(<LanguageSwitch value="en" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const viOption = screen.getByText("Tiếng Việt");
    fireEvent.click(viOption);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks current language as selected in the list", () => {
    render(<LanguageSwitch value="vi" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const selected = screen.getAllByRole("option").find(
      (el) => el.getAttribute("aria-selected") === "true"
    );
    expect(selected).toBeDefined();
  });
});
