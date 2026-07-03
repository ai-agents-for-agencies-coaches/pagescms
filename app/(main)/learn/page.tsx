import Link from "next/link";
import { GraduationCap, PlayCircle } from "lucide-react";
import { getLessonCategories } from "@/lib/learn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const metadata = { title: "Learn" };

export default async function LearnIndexPage() {
  const categories = await getLessonCategories();
  const lessonCount = categories.reduce((n, c) => n + c.lessons.length, 0);

  return (
    <div className="max-w-screen-lg mx-auto p-4 md:p-6 space-y-8">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GraduationCap className="h-6 w-6" />
          Learn
        </h1>
        <p className="text-muted-foreground">
          Guides and walkthroughs for getting the most out of your dashboard.
        </p>
      </div>

      {lessonCount === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No lessons yet</EmptyTitle>
            <EmptyDescription>
              Add markdown files under <code>content/learn/</code> to publish
              lessons here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        categories.map((category) => (
          <section key={category.category} className="space-y-4">
            <h2 className="text-lg font-medium tracking-tight">
              {category.label}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {category.lessons.map((lesson) => (
                <Link
                  key={lesson.slug}
                  href={`/learn/${category.category}/${lesson.slug}`}
                  className="group"
                >
                  <Card className="h-full transition-colors group-hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="flex items-start gap-2 text-base">
                        {lesson.youtubeId && (
                          <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span>{lesson.title}</span>
                      </CardTitle>
                      {lesson.summary && (
                        <CardDescription>{lesson.summary}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {lesson.youtubeId ? "Video + guide" : "Guide"}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
