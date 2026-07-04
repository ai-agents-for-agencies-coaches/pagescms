import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { getLesson, getLessonCategories } from "@/lib/learn";
import { cn } from "@/lib/utils";

/**
 * A single lesson, rendered both at `/learn/...` and `/[owner]/[repo]/learn/...`.
 * `basePath` prefixes every internal link (sidebar, prev/next, and the
 * authored `/learn/...` cross-links inside the markdown body).
 */
export async function LessonDetail({
  basePath,
  category,
  slug,
}: {
  basePath: string;
  category: string;
  slug: string;
}) {
  const [lesson, categories] = await Promise.all([
    getLesson(category, slug),
    getLessonCategories(),
  ]);

  if (!lesson) notFound();

  // Trusted, in-repo authored content — no external/user input — so rendering
  // the markdown directly is safe.
  let html = await marked.parse(lesson.body, { gfm: true });

  // Lessons author cross-links as absolute `/learn/...` paths. When rendered
  // under a repo-scoped base, rewrite them so they stay inside the portal.
  if (basePath !== "/learn") {
    html = html.replace(/href="\/learn(?=[/"])/g, `href="${basePath}`);
  }

  // Flatten for prev/next across the whole library, in display order.
  const ordered = categories.flatMap((c) => c.lessons);
  const index = ordered.findIndex(
    (l) => l.category === category && l.slug === slug,
  );
  const prev = index > 0 ? ordered[index - 1] : null;
  const next =
    index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  return (
    <div className="max-w-screen-xl mx-auto p-4 md:p-6">
      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        {/* Lesson sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
          <Link
            href={basePath}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All lessons
          </Link>
          <nav className="space-y-4">
            {categories.map((c) => (
              <div key={c.category} className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </div>
                <ul className="space-y-0.5">
                  {c.lessons.map((l) => {
                    const active = l.category === category && l.slug === slug;
                    return (
                      <li key={l.slug}>
                        <Link
                          href={`${basePath}/${l.category}/${l.slug}`}
                          className={cn(
                            "block rounded-md px-2 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          )}
                        >
                          {l.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <article className="min-w-0 space-y-6">
          <header className="space-y-1">
            <div className="text-sm text-muted-foreground">
              {lesson.categoryLabel}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {lesson.title}
            </h1>
          </header>

          {lesson.youtubeId && (
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
              <iframe
                className="h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${lesson.youtubeId}`}
                title={lesson.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {lesson.body.trim() && (
            <div
              className="prose prose-neutral max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {/* Prev / next */}
          <nav className="flex items-stretch justify-between gap-4 border-t pt-6">
            {prev ? (
              <Link
                href={`${basePath}/${prev.category}/${prev.slug}`}
                className="group flex max-w-[45%] items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`${basePath}/${next.category}/${next.slug}`}
                className="group flex max-w-[45%] items-center gap-2 text-right text-sm text-muted-foreground hover:text-foreground"
              >
                <span className="truncate">{next.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </div>
    </div>
  );
}
