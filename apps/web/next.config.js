/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shared"],
  experimental: {
    // Roster screenshots are shrunk in the browser first, but several of them
    // together still pass the 1MB default.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

module.exports = nextConfig;
