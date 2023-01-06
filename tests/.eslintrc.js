module.exports = {
  env: {
    node: true,
    mocha: true,
  },
  extends: "airbnb-base",
  plugins: [
    "mocha"
  ],
  rules: {
    "mocha/no-exclusive-tests": "error",
    "max-len": 0,
    "no-unused-expressions": 0,
    "func-names": 0,
    "prefer-arrow-callback": 0,
    "object-curly-newline": 0,
  }
}
