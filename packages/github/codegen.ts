import type { CodegenConfig } from "@graphql-codegen/cli";

/** Types for our GitHub GraphQL operations, generated from GitHub's published schema. Run `pnpm codegen`. */
const config: CodegenConfig = {
  schema: "node_modules/@octokit/graphql-schema/schema.graphql",
  documents: ["src/queries/**/*.graphql"],
  generates: {
    "./src/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        documentMode: "string",
        useTypeImports: true,
        emitLegacyCommonJSImports: false,
        enumsAsTypes: true,
        avoidOptionals: false,
        scalars: { URI: "string", GitObjectID: "string", DateTime: "string", HTML: "string" },
      },
    },
  },
};

export default config;
