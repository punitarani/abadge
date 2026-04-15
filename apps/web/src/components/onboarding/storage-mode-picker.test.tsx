import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StorageModePicker } from "./storage-mode-picker";

afterEach(() => {
  cleanup();
});

describe("StorageModePicker", () => {
  test("renders both options as role=radio", () => {
    render(<StorageModePicker value="zero_knowledge" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
  });

  test("aria-checked=true on the matching value, false on the other", () => {
    render(<StorageModePicker value="zero_knowledge" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    const smRadio = radios[1] as HTMLElement;
    expect(zkRadio.getAttribute("aria-checked")).toBe("true");
    expect(smRadio.getAttribute("aria-checked")).toBe("false");
  });

  test("aria-checked=true on server_managed when that is the value", () => {
    render(<StorageModePicker value="server_managed" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    const smRadio = radios[1] as HTMLElement;
    expect(zkRadio.getAttribute("aria-checked")).toBe("false");
    expect(smRadio.getAttribute("aria-checked")).toBe("true");
  });

  test("selected card has tabIndex=0, unselected has tabIndex=-1 (roving tabindex)", () => {
    render(<StorageModePicker value="zero_knowledge" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    const smRadio = radios[1] as HTMLElement;
    expect(zkRadio.getAttribute("tabindex")).toBe("0");
    expect(smRadio.getAttribute("tabindex")).toBe("-1");
  });

  test("ArrowDown from zero_knowledge calls onChange with server_managed", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    fireEvent.keyDown(zkRadio, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("server_managed");
  });

  test("ArrowUp from server_managed calls onChange with zero_knowledge", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="server_managed" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const smRadio = radios[1] as HTMLElement;
    fireEvent.keyDown(smRadio, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("zero_knowledge");
  });

  test("clicking an unselected card calls onChange with that value", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const smRadio = radios[1] as HTMLElement;
    fireEvent.click(smRadio);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("server_managed");
  });

  test("clicking already-selected card still calls onChange (idempotent)", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    fireEvent.click(zkRadio);
    expect(onChange).toHaveBeenCalledWith("zero_knowledge");
  });

  test("Space key on focused card calls onChange", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    fireEvent.keyDown(zkRadio, { key: " " });
    expect(onChange).toHaveBeenCalledWith("zero_knowledge");
  });

  test("ArrowRight wraps from server_managed back to zero_knowledge", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="server_managed" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const smRadio = radios[1] as HTMLElement;
    fireEvent.keyDown(smRadio, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("zero_knowledge");
  });

  test("Home key moves to zero_knowledge regardless of current selection", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="server_managed" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const smRadio = radios[1] as HTMLElement;
    fireEvent.keyDown(smRadio, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("zero_knowledge");
  });

  test("End key moves to server_managed regardless of current selection", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    fireEvent.keyDown(zkRadio, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("server_managed");
  });

  test("disabled prop sets aria-disabled and swallows click", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} disabled />);
    const radios = screen.getAllByRole("radio");
    const smRadio = radios[1] as HTMLElement;
    expect(smRadio.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(smRadio);
    expect(onChange).toHaveBeenCalledTimes(0);
  });

  test("disabled prop swallows ArrowDown keyboard event", () => {
    const onChange = mock(() => {});
    render(<StorageModePicker value="zero_knowledge" onChange={onChange} disabled />);
    const radios = screen.getAllByRole("radio");
    const zkRadio = radios[0] as HTMLElement;
    fireEvent.keyDown(zkRadio, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(0);
  });
});
