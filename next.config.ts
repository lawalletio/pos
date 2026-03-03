import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
