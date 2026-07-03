/**
 * Global "Learn" library. Lessons are authored as markdown files (with YAML
 * frontmatter) under `content/learn/<category>/<slug>.md` and rendered by the
 * `/learn` routes. Content is versioned in the repo — editing a lesson is a
 * commit + deploy, no database involved.
 *
 * Frontmatter shape (all optional except `title`):
 *   title: string      — lesson title
 *   summary: string    — short blurb shown on the index cards
 *   order: number      — sort order within a category (defaults to 999)
 *   youtubeId: string  — unlisted YouTube video id, embedded above the body
 *   categoryLabel: str — human label for the category (defaults to a prettified
 *                        version of the folder name)
 *   categoryOrder: num — sort order for the category itself (defaults to 999)
 */

import { promises as fs } from "fs";
import path from "path";
import { parse } from "@/lib/serialization";

const LEARN_ROOT = path.join(process.cwd(), "content", "learn");

export type Lesson = {
  category: string;
  categoryLabel: string;
  categoryOrder: number;
  slug: string;
  title: string;
  summary: string;
  order: number;
  youtubeId: string | null;
  body: string;
};

export type LessonCategory = {
  category: string;
  label: string;
  order: number;
  lessons: Lesson[];
};

const prettify = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const toNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

async function readLessonFile(
  category: string,
  fileName: string,
): Promise<Lesson> {
  const slug = fileName.replace(/\.mdx?$/, "");
  const raw = await fs.readFile(
    path.join(LEARN_ROOT, category, fileName),
    "utf8",
  );
  const parsed = parse(raw, { format: "yaml-frontmatter" }) as Record<
    string,
    unknown
  >;

  return {
    category,
    categoryLabel: toStringOrNull(parsed.categoryLabel) ?? prettify(category),
    categoryOrder: toNumber(parsed.categoryOrder, 999),
    slug,
    title: toStringOrNull(parsed.title) ?? prettify(slug),
    summary: toStringOrNull(parsed.summary) ?? "",
    order: toNumber(parsed.order, 999),
    youtubeId: toStringOrNull(parsed.youtubeId),
    body: typeof parsed.body === "string" ? parsed.body : "",
  };
}

/** Read every lesson across every category, unsorted. Returns [] if no content. */
async function readAllLessons(): Promise<Lesson[]> {
  let categoryDirs: string[];
  try {
    const entries = await fs.readdir(LEARN_ROOT, { withFileTypes: true });
    categoryDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No content/learn directory yet — treat as an empty library.
    return [];
  }

  const lessons: Lesson[] = [];
  for (const category of categoryDirs) {
    const files = await fs.readdir(path.join(LEARN_ROOT, category));
    for (const file of files) {
      if (!/\.mdx?$/.test(file)) continue;
      lessons.push(await readLessonFile(category, file));
    }
  }
  return lessons;
}

/** All lessons grouped by category, categories and lessons both sorted. */
export async function getLessonCategories(): Promise<LessonCategory[]> {
  const lessons = await readAllLessons();
  const byCategory = new Map<string, LessonCategory>();

  for (const lesson of lessons) {
    let group = byCategory.get(lesson.category);
    if (!group) {
      group = {
        category: lesson.category,
        label: lesson.categoryLabel,
        order: lesson.categoryOrder,
        lessons: [],
      };
      byCategory.set(lesson.category, group);
    }
    group.lessons.push(lesson);
  }

  const categories = Array.from(byCategory.values());
  categories.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  for (const group of categories) {
    group.lessons.sort(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title),
    );
  }
  return categories;
}

/** A single lesson, or null if not found. */
export async function getLesson(
  category: string,
  slug: string,
): Promise<Lesson | null> {
  for (const ext of ["md", "mdx"]) {
    try {
      return await readLessonFile(category, `${slug}.${ext}`);
    } catch {
      // try next extension
    }
  }
  return null;
}

/** Flat list of {category, slug} for static params / prev-next navigation. */
export async function getAllLessonRefs(): Promise<
  { category: string; slug: string }[]
> {
  const lessons = await readAllLessons();
  return lessons.map(({ category, slug }) => ({ category, slug }));
}
