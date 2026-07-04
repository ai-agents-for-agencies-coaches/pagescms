import { LessonsIndex } from "@/components/learn/lessons-index";

export const metadata = { title: "Learn" };

export default function LearnIndexPage() {
  return <LessonsIndex basePath="/learn" />;
}
