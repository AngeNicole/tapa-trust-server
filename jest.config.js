module.exports = {
  testEnvironment: 'node',
  // Creates + migrates the isolated test database once before the suite runs.
  globalSetup: '<rootDir>/tests/globalSetup.js',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 20000,
};
