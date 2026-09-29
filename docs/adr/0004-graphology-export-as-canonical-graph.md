# 4. graphology export JSON is the canonical graph

Date: 2026-09-29. Status: accepted.

## Decision

A graph is stored as graphology's serialized export (`attributes`, `options`, `nodes[{key, attributes}]`, `edges[{key, source, target, attributes}]`) in `graph_versions.document`, validated by `GraphDocumentSchema` and `compileGraph` before save. The engine and the editor both load it into graphology. React Flow is a view derived through `toReactFlow` and written back through `fromReactFlow`. Runs pin a graph version.

## Consequences

Validation (reachability, cycles only through loop edges, join rules) runs identically in the editor and the engine. Editing a graph never changes an in-flight run.
