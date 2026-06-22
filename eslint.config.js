// eslint.config.js
module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/out/**"
    ]
  },
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off"
    }
  }
];
