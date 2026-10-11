export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return formatDateTime(iso).slice(0, 10);
}

export function formatMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

/** 引用位置描述：第 2 页 · 三、差旅费用标准 > 3.2 住宿标准 */
export function locationLabel(page: number | null | undefined, section: string | null | undefined) {
  const parts: string[] = [];
  if (page) parts.push(`第 ${page} 页`);
  if (section) {
    // 章节路径的第一级通常是文档标题，展示时省略
    const segs = section.split(" > ");
    parts.push(segs.length > 1 ? segs.slice(1).join(" › ") : segs[0]);
  }
  return parts.join(" · ");
}
