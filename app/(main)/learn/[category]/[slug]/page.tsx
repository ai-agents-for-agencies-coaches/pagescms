import { LessonDetail } from "@/components/learn/lesson-detail";
import { getLesson, getLessonCategories } from "@/lib/learn";

type Params = { category: string; slug: string };

export async function generateStaticParams() {
  const categories = await getLessonCategories();
  return categories.flatMap((c) =>
    c.lessons.map((l) => ({ category: c.category, slug: l.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category, slug } = await params;
  const lesson = await getLesson(category, slug);
  return { title: lesson ? `${lesson.title} · Learn` : "Learn" };
}

export default async function LessonPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category, slug } = await params;
  return <LessonDetail basePath="/learn" category={category} slug={slug} />;
}
