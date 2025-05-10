// postcss.config.cjs
module.exports = {
  plugins: [
    require('tailwindcss'),   // ← use the v3 plugin that lives in the core pkg
    require('autoprefixer'),
  ],
};
