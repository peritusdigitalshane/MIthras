// PDF rendering for monthly/weekly customer reports.
//
// Uses pdf-lib via the npm: specifier. Built-in StandardFonts work without
// any file I/O — important because the Supabase edge-runtime sandbox blocks
// Deno.readFileSync, which is what pdfkit calls at bootstrap.

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, RGB } from "npm:pdf-lib@1.17.1";

type Summary = Record<string, unknown>;

// Palette — keep in sync with the HTML report styles.
const C = {
    teal:  rgb(0,    0.769, 0.671), // #00C4AB
    ink:   rgb(0.058, 0.090, 0.165), // #0f172a
    muted: rgb(0.392, 0.455, 0.545), // #64748b
    rule:  rgb(0.886, 0.910, 0.941), // #e2e8f0
    rule2: rgb(0.973, 0.980, 0.988), // #f8fafc
    red:   rgb(0.863, 0.149, 0.149), // #dc2626
    green: rgb(0.020, 0.588, 0.412), // #059669
    amber: rgb(0.851, 0.471, 0.020), // #d97706
    bgExec: rgb(0.941, 0.992, 0.980), // #f0fdfa
};

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - 2 * MARGIN;

function s(v: unknown): string {
    return v === null || v === undefined ? "" : String(v);
}
function num(v: unknown): number {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
}

function capitalise(t: string): string {
    if (!t) return t;
    return t[0].toUpperCase() + t.slice(1);
}

function periodLabel(start: string, end: string): string {
    const a = new Date(start);
    const b = new Date(end);
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    return `${fmt(a)} – ${fmt(b)}`;
}

function safeText(t: string): string {
    // pdf-lib's default StandardFont (Helvetica) is WinAnsi only — characters
    // outside that range throw. Strip them to '?' so reports never fail on
    // exotic input (we don't accept rich text from customers anyway).
    return t.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

interface Ctx {
    pdf:  PDFDocument;
    page: PDFPage;
    font: PDFFont;
    bold: PDFFont;
    y:    number;
    pageNum: number;
}

function ensurePage(ctx: Ctx, neededH = 60): Ctx {
    if (ctx.y - neededH > MARGIN + 30) return ctx;
    ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
    ctx.y    = PAGE_H - MARGIN;
    ctx.pageNum++;
    return ctx;
}

function drawText(ctx: Ctx, text: string, opts: {
    x?: number; y?: number; size?: number; color?: RGB; bold?: boolean; maxWidth?: number; align?: "left" | "right";
} = {}) {
    const t = safeText(text);
    const font = opts.bold ? ctx.bold : ctx.font;
    const size = opts.size ?? 10;
    const color = opts.color ?? C.ink;
    const x = opts.x ?? MARGIN;
    const y = opts.y ?? ctx.y;
    let drawX = x;
    if (opts.align === "right" && opts.maxWidth) {
        const w = font.widthOfTextAtSize(t, size);
        drawX = x + (opts.maxWidth - w);
    }
    ctx.page.drawText(t, { x: drawX, y, size, font, color });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = safeText(text).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
        const trial = cur ? cur + " " + word : word;
        const w = font.widthOfTextAtSize(trial, size);
        if (w > maxWidth && cur) {
            lines.push(cur);
            cur = word;
        } else {
            cur = trial;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function drawWrappedText(ctx: Ctx, text: string, opts: {
    x?: number; size?: number; color?: RGB; bold?: boolean; maxWidth: number; lineGap?: number;
}): number {
    const t = safeText(text);
    const font = opts.bold ? ctx.bold : ctx.font;
    const size = opts.size ?? 10;
    const color = opts.color ?? C.ink;
    const x = opts.x ?? MARGIN;
    const gap = opts.lineGap ?? 2;
    const lines = wrapText(t, font, size, opts.maxWidth);
    const lineH = size + gap;
    let y = ctx.y;
    for (const line of lines) {
        if (y - lineH < MARGIN + 30) {
            ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
            ctx.pageNum++;
            y = PAGE_H - MARGIN;
        }
        ctx.page.drawText(line, { x, y, size, font, color });
        y -= lineH;
    }
    ctx.y = y;
    return lines.length * lineH;
}

function rule(ctx: Ctx, x1: number, x2: number, y: number, color = C.rule, thickness = 1) {
    ctx.page.drawLine({
        start: { x: x1, y }, end: { x: x2, y },
        thickness, color,
    });
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; strokeW?: number } = {}) {
    ctx.page.drawRectangle({
        x, y, width: w, height: h,
        color: opts.fill, borderColor: opts.stroke, borderWidth: opts.strokeW ?? (opts.stroke ? 1 : 0),
    });
}

function header(ctx: Ctx, orgName: string, kind: string, periodStart: string, periodEnd: string) {
    drawText(ctx, "MITHRAS", { x: MARGIN, y: PAGE_H - MARGIN - 6, size: 22, color: C.teal, bold: true });
    drawText(ctx,
        `${orgName}  -  ${capitalise(kind)} security report  -  ${periodLabel(periodStart, periodEnd)}`,
        { x: MARGIN, y: PAGE_H - MARGIN - 28, size: 9.5, color: C.muted },
    );
    rule(ctx, MARGIN, MARGIN + CONTENT_W, PAGE_H - MARGIN - 42);
    ctx.y = PAGE_H - MARGIN - 60;
}

function sectionTitle(ctx: Ctx, title: string) {
    ctx = ensurePage(ctx, 50);
    ctx.y -= 6;
    drawText(ctx, title, { y: ctx.y, size: 13, color: C.ink, bold: true });
    ctx.y -= 18;
}

function execBlock(ctx: Ctx, execText: string | null) {
    if (!execText) return;
    const t = safeText(execText);
    const innerW = CONTENT_W - 28;
    const lines = wrapText(t, ctx.font, 10, innerW);
    const blockH = 28 + lines.length * 12 + 12;
    ctx = ensurePage(ctx, blockH + 10);
    const blockY = ctx.y - blockH;
    rect(ctx, MARGIN, blockY, CONTENT_W, blockH, { fill: C.bgExec });
    rect(ctx, MARGIN, blockY, 4, blockH, { fill: C.teal });
    drawText(ctx, "AI EXECUTIVE SUMMARY", {
        x: MARGIN + 18, y: ctx.y - 18, size: 8.5, color: rgb(0, 0.537, 0.482), bold: true,
    });
    let y = ctx.y - 34;
    for (const line of lines) {
        ctx.page.drawText(line, { x: MARGIN + 18, y, size: 10, font: ctx.font, color: C.ink });
        y -= 12;
    }
    ctx.y = blockY - 14;
}

interface KPI { label: string; value: string; tone?: "ok" | "alert" | "warn"; }

function kpiGrid(ctx: Ctx, items: KPI[]) {
    const cols = 4, gap = 12;
    const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
    const cellH = 64;
    const rows = Math.ceil(items.length / cols);
    const totalH = rows * cellH + (rows - 1) * gap;
    ctx = ensurePage(ctx, totalH + 8);

    items.forEach((item, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = MARGIN + col * (cellW + gap);
        const y = ctx.y - (row * (cellH + gap)) - cellH;
        rect(ctx, x, y, cellW, cellH, { stroke: C.rule, strokeW: 1 });
        drawText(ctx, item.label.toUpperCase(), {
            x: x + 12, y: y + cellH - 16, size: 8, color: C.muted,
        });
        const color = item.tone === "alert" ? C.red : item.tone === "warn" ? C.amber : item.tone === "ok" ? C.green : C.ink;
        drawText(ctx, item.value, {
            x: x + 12, y: y + 16, size: 18, color, bold: true,
        });
    });
    ctx.y -= totalH + 16;
}

interface Col { label: string; key: string; width: number; right?: boolean; }

function tableHeader(ctx: Ctx, columns: Col[], y: number) {
    const h = 22;
    rect(ctx, MARGIN, y - h, CONTENT_W, h, { fill: C.rule2 });
    let x = MARGIN;
    for (const c of columns) {
        const w = c.width;
        ctx.page.drawText(safeText(c.label.toUpperCase()), {
            x: x + 8 + (c.right ? w - 16 - ctx.bold.widthOfTextAtSize(c.label.toUpperCase(), 8.5) : 0),
            y: y - 14, size: 8.5, font: ctx.bold,
            color: rgb(0.278, 0.337, 0.412),
        });
        x += w;
    }
    return y - h;
}

function table(ctx: Ctx, columns: Col[], rows: Record<string, unknown>[]) {
    if (rows.length === 0) {
        ctx = ensurePage(ctx, 30);
        drawText(ctx, "None for this period.", {
            x: MARGIN, y: ctx.y, size: 10, color: C.muted,
        });
        ctx.y -= 18;
        return;
    }

    const rowH = 20;
    ctx = ensurePage(ctx, 60);
    ctx.y = tableHeader(ctx, columns, ctx.y);

    for (const r of rows) {
        if (ctx.y - rowH < MARGIN + 30) {
            ctx = ensurePage(ctx, 60);
            ctx.y = tableHeader(ctx, columns, ctx.y);
        }
        let x = MARGIN;
        const rowY = ctx.y - rowH;
        for (const c of columns) {
            const raw = r[c.key];
            const text = raw === null || raw === undefined ? "" : String(raw);
            const tone =
                c.key === "severity"
                    ? text === "critical" || text === "Severe" ? C.red
                        : text === "high" || text === "High" ? C.amber
                        : text === "Moderate" || text === "moderate" ? C.amber
                        : C.ink
                    : C.ink;
            const truncated = truncateToWidth(safeText(text), ctx.font, 9.5, c.width - 16);
            const drawAtX = c.right
                ? x + c.width - 8 - ctx.font.widthOfTextAtSize(truncated, 9.5)
                : x + 8;
            ctx.page.drawText(truncated, {
                x: drawAtX, y: rowY + 6, size: 9.5, font: ctx.font, color: tone,
            });
            x += c.width;
        }
        rule(ctx, MARGIN, MARGIN + CONTENT_W, rowY, C.rule, 0.5);
        ctx.y = rowY;
    }
    ctx.y -= 14;
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const candidate = text.slice(0, mid) + "...";
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid + 1;
        else hi = mid;
    }
    return text.slice(0, Math.max(0, lo - 1)) + "...";
}

function footers(ctx: Ctx) {
    const pages = ctx.pdf.getPages();
    const total = pages.length;
    pages.forEach((p, idx) => {
        const y = MARGIN - 14;
        p.drawLine({
            start: { x: MARGIN, y: y + 14 }, end: { x: MARGIN + CONTENT_W, y: y + 14 },
            thickness: 1, color: C.rule,
        });
        p.drawText(safeText("Generated by Mithras Threat Defence. For live data, sign in at the SOC console."), {
            x: MARGIN, y, size: 8.5, font: ctx.font, color: C.muted,
        });
        const pageLabel = `Page ${idx + 1} of ${total}`;
        const w = ctx.font.widthOfTextAtSize(pageLabel, 8.5);
        p.drawText(pageLabel, {
            x: MARGIN + CONTENT_W - w, y, size: 8.5, font: ctx.font, color: C.muted,
        });
    });
}

export async function buildReportPdf(
    orgName: string,
    summary: Summary,
    kind: string,
    execSummary: string | null,
): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${orgName} ${kind} security report`);
    pdf.setAuthor("Mithras Threat Defence");
    pdf.setSubject("Security posture summary");
    pdf.setCreator("Mithras Threat Defence");
    pdf.setCreationDate(new Date());

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let ctx: Ctx = {
        pdf,
        page: pdf.addPage([PAGE_W, PAGE_H]),
        font, bold,
        y: PAGE_H - MARGIN,
        pageNum: 1,
    };

    const periodStart = s(summary.period_start);
    const periodEnd   = s(summary.period_end);

    header(ctx, orgName, kind, periodStart, periodEnd);

    execBlock(ctx, execSummary);

    sectionTitle(ctx, "At a glance");

    const threatsInPeriod  = num(summary.threats_in_period);
    const threatsSevere    = num(summary.threats_severe);
    const incidentsOpenNow = num(summary.incidents_open_now);
    const vulnsCritical    = num(summary.vulns_critical);

    kpiGrid(ctx, [
        { label: "Endpoints",          value: num(summary.endpoints_total).toLocaleString() },
        { label: "Online now",         value: num(summary.endpoints_online).toLocaleString(), tone: "ok" },
        { label: "Threats this period",value: threatsInPeriod.toLocaleString(),
          tone: threatsInPeriod > 0 ? "alert" : "ok" },
        { label: "Severe threats",     value: threatsSevere.toLocaleString(),
          tone: threatsSevere > 0 ? "alert" : "ok" },

        { label: "Incidents opened",   value: num(summary.incidents_opened).toLocaleString() },
        { label: "Incidents resolved", value: num(summary.incidents_resolved).toLocaleString(), tone: "ok" },
        { label: "Open right now",     value: incidentsOpenNow.toLocaleString(),
          tone: incidentsOpenNow > 0 ? "alert" : "ok" },
        { label: "Critical vulns",     value: vulnsCritical.toLocaleString(),
          tone: vulnsCritical > 0 ? "alert" : "ok" },

        { label: "Open vulns (total)", value: num(summary.vulns_open).toLocaleString() },
    ]);

    sectionTitle(ctx, "Incidents in this period");
    const incidents = Array.isArray(summary.top_incidents) ? (summary.top_incidents as Record<string, unknown>[]) : [];
    table(ctx,
        [
            { label: "Opened",   key: "opened",   width: 110 },
            { label: "Severity", key: "severity", width: 70  },
            { label: "Title",    key: "title",    width: 245 },
            { label: "Status",   key: "status",   width: 70  },
        ],
        incidents.map((i) => ({
            opened:   new Date(s(i.opened_at)).toLocaleString("en-AU"),
            severity: s(i.severity),
            title:    s(i.title),
            status:   s(i.status),
        })),
    );

    sectionTitle(ctx, "Top software in fleet");
    const topSoftware = Array.isArray(summary.top_software) ? (summary.top_software as Record<string, unknown>[]) : [];
    table(ctx,
        [
            { label: "Application", key: "name",  width: 380 },
            { label: "Installs",    key: "count", width: 115, right: true },
        ],
        topSoftware.slice(0, 10).map((r) => ({
            name:  s(r.name),
            count: num(r.count).toLocaleString(),
        })),
    );

    footers(ctx);
    return await pdf.save();
}
