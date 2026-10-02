module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globals: { 'ts-jest': { tsconfig: { esModuleInterop: true, strict: true, module: 'commonjs', target: 'ES2020' } } },
};
