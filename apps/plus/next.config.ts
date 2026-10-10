import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    transpilePackages: ["@meldrift/ai", "@meldrift/core", "@meldrift/ui", "@meldrift/board-data"],
    serverExternalPackages: ["sql.js"],
    basePath: process.env.PLUS_STANDALONE === "true" ? undefined : "/plus",
    turbopack: {
        root: path.resolve(process.cwd(), "../.."),
    },
    allowedDevOrigins: ['192.168.1.238', 'macbookpro.tail82cf40.ts.net'],
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "res.cloudinary.com",
            },
        ],
    }
};

export default nextConfig;
