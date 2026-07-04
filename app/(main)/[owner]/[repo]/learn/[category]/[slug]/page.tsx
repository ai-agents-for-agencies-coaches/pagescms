import { LessonDetail } from "@/components/learn/lesson-detail";
import { getLesson } from "@/lib/learn";

type Params = {
  owner: string;
  repo: string;
  category: string;
  slug: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category, slug } = await params;
  const lesson = await getLesson(category, slug);
  return { title: lesson ? `${lesson.title} · Learn` : "Learn" };
}

export default async function RepoLessonPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo, category, slug } = await params;
  return (
    <LessonDetail
      basePath={`/${owner}/${repo}/learn`}
      category={category}
      slug={slug}
    />
  );
}
