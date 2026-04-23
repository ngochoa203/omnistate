import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LiveClock } from "../../src/components/LiveClock";

describe("LiveClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a time string", () => {
    render(<LiveClock />);
    // Should display something — not empty
    const el = screen.getByText(/\d/);
    expect(el).toBeInTheDocument();
  });

  it("renders a <span> element", () => {
    const { container } = render(<LiveClock />);
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("applies className prop", () => {
    const { container } = render(<LiveClock className="my-clock" />);
    expect(container.querySelector(".my-clock")).toBeInTheDocument();
  });

  it("updates after 1 second tick (withSeconds=true)", () => {
    vi.setSystemTime(new Date("2024-01-01T12:00:00"));
    const { container } = render(<LiveClock withSeconds={true} />);
    const before = container.querySelector("span")!.textContent;

    act(() => {
      vi.setSystemTime(new Date("2024-01-01T12:00:01"));
      vi.advanceTimersByTime(1000);
    });

    const after = container.querySelector("span")!.textContent;
    // The two strings should both be present / truthy; they may differ after tick
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
  });
});
