// In-product Standard Operating Procedures.
//
// Lives as markdown files under src/content/sops/<audience>/<slug>.md with
// simple `---key: value---` frontmatter. Vite inlines them at build time;
// the help page renders the catalogue + the body with react-markdown.
//
// Adding a new SOP = drop a new .md file. No DB migration, no rebuild
// pipeline — Vite's glob import picks it up on the next bundle.

export type SopAudience =
  | "peritus_super_admin"
  | "soc_operator"
  | "distributor"
  | "partner"
  | "customer_admin"
  | "customer_member"
  | "home_user";

export interface SopMeta {
  slug: string;
  audience: SopAudience;
  title: string;
  description: string;
  order: number;
  estimatedMinutes: number;
  updatedAt: string;
  tags: string[];
}

export interface Sop extends SopMeta {
  content: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { data: {}, content: raw };
  const [, header, body] = match;
  const data: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*"?([^"]*)"?\s*$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, content: body };
}

const rawModules = import.meta.glob<string>("/src/content/sops/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function slugAndAudienceFromPath(path: string): { audience: SopAudience; slug: string } {
  // /src/content/sops/<audience>/<slug>.md
  const parts = path.split("/");
  const audience = parts[parts.length - 2] as SopAudience;
  const slug = (parts[parts.length - 1] ?? "").replace(/\.md$/, "");
  return { audience, slug };
}

const SOPS: Sop[] = Object.entries(rawModules)
  .map(([path, raw]) => {
    const { data, content } = parseFrontmatter(raw);
    const { audience, slug } = slugAndAudienceFromPath(path);
    return {
      slug,
      audience: (data.audience as SopAudience) || audience,
      title: data.title ?? slug,
      description: data.description ?? "",
      order: Number(data.order ?? 99),
      estimatedMinutes: Number(data.estimated_minutes ?? 5),
      updatedAt: data.updated_at ?? "",
      tags: (data.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      content: content.trim(),
    };
  })
  .sort((a, b) => {
    if (a.audience !== b.audience) return a.audience.localeCompare(b.audience);
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

export const AUDIENCE_LABELS: Record<SopAudience, string> = {
  peritus_super_admin: "Peritus operator",
  soc_operator:        "SOC analyst",
  distributor:         "Distributor",
  partner:             "Reseller partner",
  customer_admin:      "Customer admin",
  customer_member:     "Customer member",
  home_user:           "Home user",
};

export const AUDIENCE_DESCRIPTIONS: Record<SopAudience, string> = {
  peritus_super_admin: "Channel + platform operations — distributors, credits, billing, AI budgets.",
  soc_operator:        "24/7 SOC workflows — triage, response, incident review.",
  distributor:         "Manage your reseller channel and credit pool.",
  partner:             "Run customer organisations, deploy agents, review incidents.",
  customer_admin:      "Endpoint security workflows for IT admins.",
  customer_member:     "Read-only access to threats, reports, and posture.",
  home_user:           "Mithras Personal — installation, blocks, billing.",
};

export function listSops(audience?: SopAudience): SopMeta[] {
  const filtered = audience ? SOPS.filter((s) => s.audience === audience) : SOPS;
  return filtered.map(({ content: _c, ...meta }) => meta);
}

export function getSop(audience: SopAudience, slug: string): Sop | undefined {
  return SOPS.find((s) => s.audience === audience && s.slug === slug);
}

export function audienceCounts(): Record<SopAudience, number> {
  const out = {} as Record<SopAudience, number>;
  for (const a of Object.keys(AUDIENCE_LABELS) as SopAudience[]) out[a] = 0;
  for (const s of SOPS) out[s.audience] = (out[s.audience] ?? 0) + 1;
  return out;
}

export function searchSops(query: string, audience?: SopAudience): SopMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return listSops(audience);
  return listSops(audience).filter((s) =>
    s.title.toLowerCase().includes(q)
    || s.description.toLowerCase().includes(q)
    || s.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
