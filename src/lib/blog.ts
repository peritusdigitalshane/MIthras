// Browser-safe markdown blog post loader.
//
// Posts live as `.md` files under src/content/blog/ with simple
// `---key: value---` frontmatter (no nested objects). Vite inlines them as
// raw strings at build time, we parse the frontmatter ourselves with a tiny
// regex, and the rest is markdown rendered downstream by react-markdown.
//
// Why not gray-matter: it pulls in Node's `buffer` module which doesn't exist
// in the browser. Our frontmatter shape is fixed and trivial — a hand-rolled
// parser is ~20 lines and ships zero polyfills.

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author?: string;
  category?: string;
  readingMinutes: number;
  image?: string;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

interface ParsedFrontmatter {
  data: Record<string, string>;
  content: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): ParsedFrontmatter {
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

// Eagerly inline every markdown post at build time. Vite turns this into a
// content-addressed bundle, so the posts ship as static strings — no runtime
// fetch, no CMS, no extra deploys.
const rawModules = import.meta.glob<string>("/src/content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function slugFromPath(path: string): string {
  const file = path.split("/").pop() ?? "";
  return file.replace(/\.md$/, "");
}

function readingMinutesFor(markdown: string): number {
  // ~225 wpm is the conservative web-reading average — good enough as an
  // estimate for visitors deciding whether to read a piece.
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 225));
}

const POSTS: BlogPost[] = Object.entries(rawModules)
  .map(([path, raw]) => {
    const { data, content } = parseFrontmatter(raw);
    return {
      slug: slugFromPath(path),
      title: data.title ?? "Untitled",
      description: data.description ?? "",
      publishedAt: data.publishedAt ?? "",
      updatedAt: data.updatedAt || undefined,
      author: data.author || undefined,
      category: data.category || undefined,
      readingMinutes: readingMinutesFor(content),
      image: data.image || undefined,
      content,
    };
  })
  // Newest first by publishedAt (ISO date strings sort lexicographically).
  .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1));

export function listPosts(): BlogPostMeta[] {
  return POSTS.map(({ content: _content, ...meta }) => meta);
}

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
