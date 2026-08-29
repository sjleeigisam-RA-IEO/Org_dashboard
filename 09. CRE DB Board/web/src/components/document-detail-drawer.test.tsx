import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentDetailDrawer } from "@/components/document-detail-drawer";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = "";
});

describe("DocumentDetailDrawer", () => {
  it("traps keyboard focus and restores body scrolling", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));

    const view = render(<DocumentDetailDrawer documentId="doc-1" fallbackTitle="근거 문서" onClose={onClose}/>);
    const close = screen.getByRole("button", { name: "상세 닫기" });

    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
