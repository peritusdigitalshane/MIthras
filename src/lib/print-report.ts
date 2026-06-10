// Safe print-to-PDF helper.
//
// The previous implementation interpolated `report_title` and the rendered
// HTML into a template literal that was passed to `document.write()`. That
// pattern is XSS-exploitable: a hostname or org name controlled by an agent
// (which is technically a third-party device) could escape the <title> tag
// and execute script in the popup window with same-origin access to
// localStorage and cookies.
//
// This helper rebuilds the popup DOM via createElement / textContent and
// uses cloneNode(true) on the already-rendered React subtree, so no string
// interpolation crosses the HTML parser. The popup is `noopener,noreferrer`
// and we void `window.opener` for belt-and-braces.

const PRINT_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1a1a1a; }
    .report-header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e5e5e5; }
    .report-title { font-size: 28px; font-weight: bold; margin-bottom: 8px; }
    .report-subtitle { color: #666; font-size: 14px; }
    .section { margin-bottom: 32px; page-break-inside: avoid; }
    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
    .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .metric-card { background: #f8f8f8; padding: 16px; border-radius: 8px; }
    .metric-value { font-size: 32px; font-weight: bold; color: #0066cc; }
    .metric-label { color: #666; font-size: 12px; text-transform: uppercase; }
    .table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .table th, .table td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e5e5; }
    .table th { background: #f8f8f8; font-weight: 600; }
    .status-implemented { color: #16a34a; }
    .status-partial { color: #ca8a04; }
    .status-not_implemented { color: #dc2626; }
    .progress-bar { height: 8px; background: #e5e5e5; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #0066cc; }
    @media print { body { padding: 20px; } .section { page-break-inside: avoid; } }
`;

export type PrintError = "no_content" | "popup_blocked";

/**
 * Open a popup, copy a DOM node into it, set its title safely, and print.
 * Returns `null` on success or an error code the caller can toast.
 */
export function printReport(opts: { contentElementId: string; title: string }): PrintError | null {
    const printContent = document.getElementById(opts.contentElementId);
    if (!printContent) return "no_content";

    // noopener prevents the popup from manipulating us via window.opener.
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return "popup_blocked";

    try {
        // Title via the property setter — never via string-interpolated HTML.
        printWindow.document.title = String(opts.title ?? "Mithras Report");

        // Build the document by appending typed nodes. No innerHTML, no
        // document.write. The CSS is a static string constant — no user input
        // crosses the parser.
        const styleEl = printWindow.document.createElement("style");
        styleEl.appendChild(printWindow.document.createTextNode(PRINT_STYLES));
        printWindow.document.head.appendChild(styleEl);

        // cloneNode on the already-rendered React tree: this copies trusted DOM
        // nodes that React itself produced via JSX (which auto-escapes). No
        // string-to-HTML parsing occurs in the destination document.
        const clone = printContent.cloneNode(true) as Element;
        // Drop the source id to avoid duplication if the popup is re-opened.
        clone.removeAttribute("id");
        printWindow.document.body.appendChild(clone);

        // Some browsers need a tick to lay out the cloned tree before print().
        setTimeout(() => {
            try {
                printWindow.print();
                printWindow.close();
            } catch {
                // The user may have closed the popup before print fired.
            }
        }, 250);

        return null;
    } catch {
        try { printWindow.close(); } catch { /* ignore */ }
        return "no_content";
    }
}
