const path = require("path");
const { lstatSync, readdirSync } = require("fs");

const namespace = "@proxima-one";
// get listing of packages in mono repo
const basePath = path.resolve(__dirname, "packages");
const packages = readdirSync(basePath).filter((name) =>
  lstatSync(path.join(basePath, name)).isDirectory()
);

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": "ts-jest"
  },
  globals: {
    "ts-jest": {
      //tsconfig: path.resolve("./tsconfig.json")
    }
  },
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec|e2e))\\.[jt]sx?$",
  moduleFileExtensions: [
    "ts",
    "tsx",
    "js",
    "jsx",
    "json",
    "node"
  ],
  moduleNameMapper: {
    "^.+\\.(css|less|scss)$": "babel-jest",
    // automatically generated list of our packages from packages directory.
    // will tell jest where to find source code for ${namespace}/ packages, it points to the src instead of dist.
    ...packages.reduce(
      (acc, name) => ({
        ...acc,
        [`${namespace}/${name}$`]: path.resolve(basePath, `${name}/src`),
      }),
      {}
    ),
  },
  modulePathIgnorePatterns: [
    ...packages.reduce(
      (acc, name) => [...acc, path.resolve(basePath, `${name}/dist`)],
      []
    ),
  ],
};

//throw new Error(JSON.stringify(module.exports.moduleNameMapper));
