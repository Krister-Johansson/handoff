import type { CodegenConfig } from "@graphql-codegen/cli";

/** Types for our GitHub GraphQL operations, generated from the vendored copy of GitHub's published schema (scripts/refresh-schema.sh updates it). Run `pnpm codegen`. */
const config: CodegenConfig = {
  schema: "src/schema/schema.docs.graphql",
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
        scalars: { URI: "string", GitObjectID: "string", DateTime: "string", Date: "string", HTML: "string" },
      },
    },
  },
};

export default config;
