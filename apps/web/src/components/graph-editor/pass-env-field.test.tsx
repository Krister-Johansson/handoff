import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PassEnvField } from "./pass-env-field";

test("names typed with commas or spaces are saved as a list on blur", () => {
  const onChange = vi.fn();
  render(<PassEnvField id="env" value={[]} onChange={onChange} />);
  const input = screen.getByLabelText("Environment variables");
  fireEvent.change(input, { target: { value: "APP_TEST_DB, FEATURE_X  REDIS_URL" } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith(["APP_TEST_DB", "FEATURE_X", "REDIS_URL"]);
});

test("a worker secret is refused with the reason and not saved", () => {
  const onChange = vi.fn();
  render(<PassEnvField id="env" value={[]} onChange={onChange} />);
  const input = screen.getByLabelText("Environment variables");
  fireEvent.change(input, { target: { value: "GITHUB_TOKEN" } });
  fireEvent.blur(input);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText(/GITHUB_TOKEN is one of handoff's own secrets/)).toBeInTheDocument();
});

test("clearing the field saves an empty list", () => {
  const onChange = vi.fn();
  render(<PassEnvField id="env" value={["A"]} onChange={onChange} />);
  const input = screen.getByLabelText("Environment variables");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith([]);
});
