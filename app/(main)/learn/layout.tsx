import { MainRootLayout } from "../main-root-layout";

/**
 * The Learn section is global (not repo-scoped), so it reuses the same top-level
 * chrome as the projects home page rather than the repo sidebar. Auth + the
 * UserProvider are already supplied by the parent (main) layout.
 */
export default function LearnLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <MainRootLayout>{children}</MainRootLayout>;
}
