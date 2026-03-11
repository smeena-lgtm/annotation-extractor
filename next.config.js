/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdf.js worker needs special handling
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
