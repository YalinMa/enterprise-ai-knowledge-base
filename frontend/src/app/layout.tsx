import { Suspense } from "react";
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "知源 · 企业 AI 知识库",
  description: "上传企业资料，基于 RAG 的可溯源 AI 问答",
};

// 所有页面都是读取 URL（usePathname / useParams）的客户端组件，
// 用 Suspense 包裹后静态外壳可以预渲染，URL 相关部分在运行时流式补齐。
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex h-full overflow-hidden">
        <Suspense fallback={<aside className="w-[60px] shrink-0 lg:w-[232px] border-r border-zinc-200/80 bg-white" />}>
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
