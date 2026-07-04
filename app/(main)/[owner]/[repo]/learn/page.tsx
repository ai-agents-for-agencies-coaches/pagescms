import { LessonsIndex } from "@/components/learn/lessons-index";

export const metadata = { title: "Learn" };

export default async function RepoLearnIndexPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return <LessonsIndex basePath={`/${owner}/${repo}/learn`} />;
}
