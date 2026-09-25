/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The simulator runs in Web Workers and talks to itself over Blob URLs.
  // We never need cross-origin isolation, so nothing exotic here.
  // Vercel-optimized: standalone output not needed (Vercel handles it), but we keep headers.
  experimental: {
    // Keep for future optimization; safe on Vercel
    optimizePackageImports: ['lucide-react', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  images: {
    // Allow Firebase Storage and generic HTTPS images
    remotePatterns: [
      { protocol: 'https', hostname: '**.firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
