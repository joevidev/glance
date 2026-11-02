import type { NextConfig } from "next"

const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  transpilePackages: ["@glance/ui"],
}

export default config
