import type { NextConfig } from "next";
import path from "node:path";
import withPWA from "next-pwa";

const dev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // 显式声明追踪根目录，避免 Next.js 16 在 monorepo/多 lockfile 场景下产生警告
  outputFileTracingRoot: path.join(__dirname),
  // 仅在生产构建时启用静态导出，开发模式关闭以支持 HMR 热更新
  ...(dev ? {} : { output: "export" }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withPWA({
  dest: "public",
  disable: dev,
  register: true,
  skipWaiting: true,
})(nextConfig);
