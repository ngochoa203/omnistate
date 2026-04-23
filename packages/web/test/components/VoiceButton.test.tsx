import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceButton } from "../../src/components/VoiceButton";

const defaultProps = {
  state: "idle" as const,
  duration: 0,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onCancel: vi.fn(),
};

describe("VoiceButton", () => {
  it("renders mic button in idle state", () => {
    render(<VoiceButton {...defaultProps} />);
    expect(screen.getByTitle("Record voice command")).toBeInTheDocument();
  });

  it("calls onStart when idle button is clicked", () => {
    const onStart = vi.fn();
    render(<VoiceButton {...defaultProps} onStart={onStart} />);
    fireEvent.click(screen.getByTitle("Record voice command"));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("idle button is disabled when disabled prop is true", () => {
    render(<VoiceButton {...defaultProps} disabled={true} />);
    const btn = screen.getByTitle("Record voice command");
    expect(btn).toBeDisabled();
  });

  it("renders stop + cancel buttons in recording state", () => {
    render(
      <VoiceButton {...defaultProps} state="recording" duration={5000} />
    );
    expect(screen.getByTitle("Stop and transcribe")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel")).toBeInTheDocument();
  });

  it("calls onStop when stop button is clicked", () => {
    const onStop = vi.fn();
    render(
      <VoiceButton {...defaultProps} state="recording" onStop={onStop} duration={0} />
    );
    fireEvent.click(screen.getByTitle("Stop and transcribe"));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <VoiceButton {...defaultProps} state="recording" onCancel={onCancel} duration={0} />
    );
    fireEvent.click(screen.getByTitle("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders disabled spinner in transcribing state", () => {
    render(<VoiceButton {...defaultProps} state="transcribing" />);
    const btn = screen.getByTitle("Transcribing...");
    expect(btn).toBeDisabled();
  });

  it("formats duration correctly in recording state", () => {
    render(
      <VoiceButton {...defaultProps} state="recording" duration={65000} />
    );
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });
});
